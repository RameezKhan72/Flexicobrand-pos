'use strict';
/**
 * FLEXICO encrypted offsite snapshot helper. No third-party dependency.
 * v1 format: scrypt + AES-256-GCM over gzip(JSON DB snapshot + optional local uploads).
 * No automatic restore into live files; restore creates a NEW DIRECTORY for review.
 * The SQLite online backup() API gives a consistent snapshot with WAL enabled.
 */
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const zlib=require('node:zlib');
const {DatabaseSync,backup}=require('node:sqlite');
const ROOT=path.resolve(__dirname,'..');
const MAGIC=Buffer.from('FLEXICO-VAULT-1\0','utf8');
const MAX_SIZE=200*1024*1024; // Guard memory for this small-store utility.
function sha(input){return crypto.createHash('sha256').update(input).digest('hex');}
function passCheck(password){if(typeof password!=='string'||password.length<12)throw Error('Passphrase must contain at least 12 characters.');}
function relativeUpload(root,full){
 const rel=path.relative(root,full).split(path.sep).join('/');
 if(!rel||rel.startsWith('../')||rel.includes('/../')||rel.startsWith('/')||rel.includes('\\'))throw Error('Unsafe upload path.');
 return rel;
}
function collectUploads(dir){
 const output=[];
 if(!fs.existsSync(dir))return output;
 function walk(base){for(const entry of fs.readdirSync(base,{withFileTypes:true})){
  const full=path.join(base,entry.name);
  if(entry.isDirectory())walk(full);
  else if(entry.isFile()){
    const stat=fs.lstatSync(full);
    if(stat.isSymbolicLink())throw Error('Symbolic upload is not allowed.');
    output.push({rel:relativeUpload(dir,full),length:stat.size,full});
  }
 }}
 walk(dir);return output;
}
function parseVault(data,passphrase){
 passCheck(passphrase);
 if(!Buffer.isBuffer(data)||data.length<MAGIC.length+16+12+16+1||!data.subarray(0,MAGIC.length).equals(MAGIC))throw Error('Not a FLEXICO vault file.');
 let at=MAGIC.length;
 const salt=data.subarray(at,at+=16),iv=data.subarray(at,at+=12),tag=data.subarray(at,at+=16),encrypted=data.subarray(at);
 let decoded;
 try{
  const cipher=crypto.createDecipheriv('aes-256-gcm',crypto.scryptSync(passphrase,salt,32),iv);
  cipher.setAuthTag(tag); decoded=Buffer.concat([cipher.update(encrypted),cipher.final()]);
 }catch{throw Error('Cannot decrypt vault: incorrect passphrase or damaged file.');}
 let obj;
 try{obj=JSON.parse(zlib.gunzipSync(decoded,{maxOutputLength:MAX_SIZE*2}).toString('utf8'));}catch{throw Error('Vault payload is malformed or damaged.');}
 if(!obj||obj.schema!==1||typeof obj.sqlite_b64!=='string'||!Array.isArray(obj.uploads)||obj.uploads.length>50000)throw Error('Vault schema not supported.');
 const db=Buffer.from(obj.sqlite_b64,'base64');
 if(sha(db)!==obj.sqlite_sha256)throw Error('Database content checksum failed.');
 let size=db.length;
 const uploads=obj.uploads.map(e=>{
  if(!e||typeof e.path!=='string'||!e.path||e.path.startsWith('/')||e.path.includes('\\')||e.path.split('/').some(s=>s==='..'||s===''||s==='.')||typeof e.content_b64!=='string')throw Error('Invalid path inside vault.');
  const value=Buffer.from(e.content_b64,'base64');size+=value.length;
  if(size>MAX_SIZE||sha(value)!==e.sha256)throw Error('Upload checksum or size failed.');
  return {path:e.path,data:value};
 });
 return {db,uploads,createdAt:obj.created_at,sha256:obj.sqlite_sha256};
}
async function createVault({dbPath=path.join(ROOT,'data','flexico.sqlite'),uploadDir=path.join(ROOT,'public','uploads'),outfile,password}){
 passCheck(password);
 if(!outfile)throw Error('Output vault filename required.');
 if(!fs.existsSync(dbPath))throw Error('SQLite database does not exist: '+dbPath);
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'flexico-vault-'));
 let handle;
 try{
  handle=new DatabaseSync(dbPath,{readOnly:true});
  await backup(handle,path.join(tmp,'snapshot.sqlite'));
  handle.close();handle=null;
  const snapshot=fs.readFileSync(path.join(tmp,'snapshot.sqlite'));
  const list=collectUploads(uploadDir);
  if(snapshot.length+list.reduce((n,x)=>n+x.length,0)>MAX_SIZE)throw Error('Database + uploads exceed 200 MB vault limit. Use managed backup storage.');
  const verify=new DatabaseSync(path.join(tmp,'snapshot.sqlite'),{readOnly:true});
  try{if(verify.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('Snapshot failed SQLite integrity check.');}finally{verify.close();}
  const uploaded=list.map(e=>{const data=fs.readFileSync(e.full);return {path:e.rel,sha256:sha(data),content_b64:data.toString('base64')};});
  const body={schema:1,created_at:new Date().toISOString(),sqlite_sha256:sha(snapshot),sqlite_b64:snapshot.toString('base64'),uploads:uploaded};
  const salt=crypto.randomBytes(16),iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv('aes-256-gcm',crypto.scryptSync(password,salt,32),iv);
  const payload=zlib.gzipSync(Buffer.from(JSON.stringify(body)),{level:6});
  const encrypted=Buffer.concat([cipher.update(payload),cipher.final()]);
  const output=Buffer.concat([MAGIC,salt,iv,cipher.getAuthTag(),encrypted]);
  // Do not overwrite a vault at the same name accidentally.
  fs.writeFileSync(outfile,output,{flag:'wx',mode:0o600});
  return {file:outfile,bytes:output.length,uploadCount:uploaded.length,sqliteSha256:body.sqlite_sha256};
 }finally{handle?.close();fs.rmSync(tmp,{recursive:true,force:true});}
}
function checkVault({vault,password}){
 const result=parseVault(fs.readFileSync(vault),password);
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'flexico-vault-check-'));
 try{
  const f=path.join(tmp,'db.sqlite');fs.writeFileSync(f,result.db);
  const db=new DatabaseSync(f,{readOnly:true});
  try{if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Decrypted SQLite integrity check failed.');}finally{db.close();}
  return {createdAt:result.createdAt,uploadCount:result.uploads.length,sqliteSha256:result.sha256};
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
}
function restoreVault({vault,password,destination}){
 if(!destination||fs.existsSync(destination))throw Error('Restore destination must be a NEW, nonexistent folder. Never overwrite a running POS.');
 const result=parseVault(fs.readFileSync(vault),password);
 // Full database check occurs before any output is written.
 checkVault({vault,password});
 fs.mkdirSync(path.join(destination,'data'),{recursive:true,mode:0o700});
 fs.mkdirSync(path.join(destination,'public','uploads'),{recursive:true,mode:0o700});
 fs.writeFileSync(path.join(destination,'data','flexico.sqlite'),result.db,{flag:'wx',mode:0o600});
 for(const file of result.uploads){const name=path.join(destination,'public','uploads',...file.path.split('/'));fs.mkdirSync(path.dirname(name),{recursive:true});fs.writeFileSync(name,file.data,{flag:'wx',mode:0o600});}
 return {destination,uploadCount:result.uploads.length};
}
async function cli(){
 const [cmd,a,b]=process.argv.slice(2);
 const password=process.env.FLEXICO_BACKUP_PASSPHRASE;
 if(!password)throw Error('Set FLEXICO_BACKUP_PASSPHRASE securely in your local terminal first. Do not send it through chat.');
 if(cmd==='create'){
  const filename=path.resolve(a||path.join(ROOT,'data','backups',`flexico-${new Date().toISOString().slice(0,10)}-${Date.now()}.fxvault`));
  fs.mkdirSync(path.dirname(filename),{recursive:true});
  console.log(JSON.stringify(await createVault({outfile:filename,password}),null,2));
 }else if(cmd==='verify') console.log(JSON.stringify(checkVault({vault:path.resolve(a),password}),null,2));
 else if(cmd==='restore')console.log(JSON.stringify(restoreVault({vault:path.resolve(a),destination:path.resolve(b)}),null,2));
 else throw Error('Usage: node tools/secure-vault.js create [output.fxvault] | verify input.fxvault | restore input.fxvault NEW_DIRECTORY');
}
if(require.main===module)cli().catch(e=>{console.error('FLEXICO VAULT ERROR:',e.message);process.exitCode=1;});
module.exports={createVault,checkVault,restoreVault};
