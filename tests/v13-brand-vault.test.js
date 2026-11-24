'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const net=require('node:net');const {spawn}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const {createVault,checkVault,restoreVault}=require('../tools/secure-vault');
const root=path.resolve(__dirname,'..');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise((ok,fail)=>{const s=net.createServer();s.on('error',fail);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>ok(p));});});
test('v1.3 real store identity, editable settings, cream-and-gold web shell',async t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'flexico-brand-'));
 const port=await freePort();const base=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:String(port),FLEXICO_DB:path.join(folder,'db.sqlite')},stdio:['ignore','pipe','pipe']});
 let log='';child.stderr.on('data',x=>log+=x);child.stdout.on('data',x=>log+=x);
 t.after(()=>{child.kill();fs.rmSync(folder,{recursive:true,force:true});});
 for(let i=0;i<100;i++){try{const r=await fetch(base+'/api/bootstrap');if(r.ok)break;}catch{}await wait(50);if(i===99)throw Error('No server: '+log);}
 let cookie='';async function call(route,method='GET',body,code=200){const r=await fetch(base+'/api'+route,{method,headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});assert.equal(r.status,code,route+': '+await r.clone().text());const c=r.headers.get('set-cookie');if(c)cookie=c.split(';')[0];return r.json();}
 const created=await call('/setup','POST',{username:'admin',password:'LongEnoughSecret122!',store_name:'FLEXICO'},201);
 assert.equal(created.settings.website,'https://www.flexicowatches.com');
 assert.equal(created.settings.email,'support@flexicowatches.com');
 assert.equal(created.settings.phone,'0315-9517966');
 assert.match(created.settings.address,/Gulberg Trade Center/);
 const settings=await call('/settings');assert.equal(settings.settings.store_name,'FLEXICO');
 const updated=await call('/settings','PATCH',{...settings.settings,store_name:'FLEXICO - Shop',phone:'0315-9517966',email:'support@flexicowatches.com',website:'https://www.flexicowatches.com'},200);
 assert.equal(updated.settings.store_name,'FLEXICO - Shop');
 assert.equal((await call('/me')).settings.website,'https://www.flexicowatches.com');
 const html=await fetch(base+'/');assert.match(await html.text(),/brand-cream\.css/);
 const css=await fetch(base+'/brand-cream.css');assert.equal(css.status,200);assert.match(await css.text(),/--page:#f0e3d0/);
 const js=await fetch(base+'/app.js');const text=await js.text();assert.match(text,/FRAGRANCES · ACCESSORIES/);assert.match(text,/cfg\.website/);
});
test('v1.3 encrypted vault can back up WAL DB and uploads, detect tampering, and restore to new folder',async t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'flexico-vault-test-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
 const original=path.join(folder,'pos.sqlite'),updir=path.join(folder,'uploads');fs.mkdirSync(updir);
 let db=new DatabaseSync(original);db.exec('PRAGMA journal_mode=WAL; CREATE TABLE orders(id INTEGER PRIMARY KEY, customer TEXT); INSERT INTO orders(customer) VALUES (\'Sensitive Client Details\');');db.close();
 fs.writeFileSync(path.join(updir,'image.png'),Buffer.from('TEST_IMAGE_BINARY_123'));
 const vault=path.join(folder,'backup.fxvault');const password='correct-horse-battery-staple';
 const result=await createVault({dbPath:original,uploadDir:updir,outfile:vault,password});
 assert.equal(result.uploadCount,1);assert.ok(result.bytes>100);
 const bytes=fs.readFileSync(vault);assert.equal(bytes.includes(Buffer.from('Sensitive Client Details')),false);
 assert.equal(checkVault({vault,password}).uploadCount,1);
 assert.throws(()=>checkVault({vault,password:'wrongpasswordxxxxxxxxx'}),/incorrect passphrase/);
 const invalid=path.join(folder,'tampered.fxvault');const wrong=Buffer.from(bytes);wrong[wrong.length-1]^=0x01;fs.writeFileSync(invalid,wrong);
 assert.throws(()=>checkVault({vault:invalid,password}),/damaged file/);
 const out=path.join(folder,'restore');assert.equal(restoreVault({vault,password,destination:out}).uploadCount,1);
 db=new DatabaseSync(path.join(out,'data','flexico.sqlite'),{readOnly:true});assert.equal(db.prepare('SELECT customer FROM orders').get().customer,'Sensitive Client Details');db.close();
 assert.equal(fs.readFileSync(path.join(out,'public','uploads','image.png'),'utf8'),'TEST_IMAGE_BINARY_123');
 assert.throws(()=>restoreVault({vault,password,destination:out}),/NEW, nonexistent/);
});
