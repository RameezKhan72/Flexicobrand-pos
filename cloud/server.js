'use strict';
// Cloud sales-mirror receiver. Deploy behind HTTPS on a managed host.
// Only mirror_events + mirror_sales are stored. Stock/master data sync is a later phase.
const http=require('node:http');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {Pool}=require('pg');
const PORT=Number(process.env.PORT||4117);
const HOST=process.env.HOST||'0.0.0.0';
const DATABASE_URL=process.env.DATABASE_URL||'';
const CLOUD_SYNC_TOKEN=process.env.CLOUD_SYNC_TOKEN||'';
const STORE_ID=process.env.CLOUD_STORE_ID||'flexico-main';
if(!DATABASE_URL) throw Error('DATABASE_URL is required.');
if(CLOUD_SYNC_TOKEN.length<32) throw Error('CLOUD_SYNC_TOKEN must contain at least 32 random characters.');
if(!/^[a-z0-9][a-z0-9_-]{1,63}$/i.test(STORE_ID)) throw Error('Invalid CLOUD_STORE_ID.');
const owner=require('./owner').install({pool:lazyPool(),storeId:STORE_ID});
function lazyPool(){return {query:(...args)=>pool.query(...args)}}
const pool=new Pool({connectionString:DATABASE_URL,max:10,connectionTimeoutMillis:8000,
  idleTimeoutMillis:30000,statement_timeout:15000});
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function fault(message,status=400){const e=Error(message);e.status=status;return e;}
function response(res,status,obj){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'});res.end(JSON.stringify(obj));}
function authenticate(req){
 const auth=req.headers.authorization||'';
 if(!auth.startsWith('Bearer '))throw fault('Unauthorized.',401);
 const a=crypto.createHash('sha256').update(auth.slice(7)).digest();
 const b=crypto.createHash('sha256').update(CLOUD_SYNC_TOKEN).digest();
 if(!crypto.timingSafeEqual(a,b))throw fault('Unauthorized.',401);
}
function jsonRequest(req){return new Promise((resolve,reject)=>{
 let body='';let oversized=false;
 req.on('data',chunk=>{body+=chunk;if(body.length>1024*1024){oversized=true;reject(fault('Payload too large.',413));req.destroy();}});
 req.on('end',()=>{if(oversized)return;try{resolve(JSON.parse(body));}catch{reject(fault('Invalid JSON.'));}});
 req.on('error',reject);
});}
function checkMoney(v,name){if(!Number.isSafeInteger(v)||v<0||v>100_000_000_000)throw fault(`Invalid ${name}.`);}
function checkSale(p){
 if(!p||typeof p!=='object'||Array.isArray(p))throw fault('Missing sale payload.');
 for(const k of ['local_sale_id','total_paisa','paid_paisa','due_paisa','tax_paisa','tendered_paisa','change_paisa'])checkMoney(p[k],k);
 if(p.local_sale_id<1 || p.paid_paisa+p.due_paisa!==p.total_paisa || p.tendered_paisa-p.paid_paisa!==p.change_paisa)
   throw fault('Invalid sale totals.');
 if(typeof p.receipt_no!=='string'||p.receipt_no.length<1||p.receipt_no.length>80)throw fault('Invalid receipt.');
 if(typeof p.cashier!=='string'||p.cashier.length>100 || typeof p.customer_name!=='string'||p.customer_name.length>200)throw fault('Invalid cashier/customer.');
 if(!Array.isArray(p.items)||p.items.length<1||p.items.length>100||!Array.isArray(p.payments)||p.payments.length>10)throw fault('Invalid item/payment lines.');
 for(const i of p.items) {if(typeof i.sku!=='string'||i.sku.length>100||!Number.isSafeInteger(i.qty)||i.qty<1)throw fault('Invalid sale item.');checkMoney(i.line_total_paisa,'item total');}
 for(const x of p.payments){if(typeof x.method!=='string'||x.method.length>40)throw fault('Invalid payment method.');checkMoney(x.amount_paisa,'payment amount');checkMoney(x.tendered_paisa,'tendered amount');}
 if(!Number.isFinite(Date.parse(String(p.created_at).replace(' ','T')+'Z')))throw fault('Invalid sale date.');
 return p;
}
function checkOps(p){
 if(!p||!Number.isSafeInteger(p.version)||p.version<=0||typeof p.captured_at!=='string')throw fault('Invalid operational snapshot.');
 if(!p.statistics||typeof p.statistics!=='object'||Array.isArray(p.statistics))throw fault('Invalid operational summary.');
 for(const [k,v] of Object.entries(p.statistics)){if(!/^[a-z_]+$/.test(k)||!Number.isSafeInteger(v)||v<0)throw fault('Invalid snapshot metric.');}
 for(const key of ['stock','recent_cod','recent_returns'])if(!Array.isArray(p[key])||p[key].length>200)throw fault('Invalid snapshot list.');
 if(JSON.stringify(p).length>700000)throw fault('Operational snapshot exceeds size limit.',413);
 return p;
}
async function ingest(body){
 if(!body||body.store_id!==STORE_ID||!uuid.test(body.device_id)||!Array.isArray(body.events)||body.events.length<1||body.events.length>25)
   throw fault('Invalid sync batch.');
 const seen=new Set(),normalized=[];
 for(const e of body.events){
  if(!e||!uuid.test(e.event_id)||seen.has(e.event_id)||e.schema_version!==1||!['sale.created','ops.snapshot'].includes(e.event_type))throw fault('Invalid or repeated event.');
  seen.add(e.event_id);
  const payload=e.event_type==='sale.created'?checkSale(e.payload):checkOps(e.payload);
  const hash=crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  normalized.push({...e,payload,hash});
 }
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('INSERT INTO mirror_device_registration(store_id,device_id) VALUES($1,$2) ON CONFLICT(store_id) DO NOTHING',[STORE_ID,body.device_id]);
  const claimed=await client.query('SELECT device_id FROM mirror_device_registration WHERE store_id=$1 FOR UPDATE',[STORE_ID]);
  if(claimed.rows[0]?.device_id!==body.device_id)throw fault('This store is already paired with a different local device. Resolve pairing with the administrator.',409);
  for(const e of normalized){
   const inserted=await client.query(`INSERT INTO mirror_events(store_id,device_id,event_id,event_type,payload_sha256,payload)
    VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(store_id,event_id) DO NOTHING RETURNING event_id`,
    [STORE_ID,body.device_id,e.event_id,e.event_type,e.hash,JSON.stringify(e.payload)]);
   if(!inserted.rowCount){
     const old=await client.query('SELECT payload_sha256,device_id FROM mirror_events WHERE store_id=$1 AND event_id=$2', [STORE_ID,e.event_id]);
     if(old.rows[0]?.payload_sha256!==e.hash||old.rows[0]?.device_id!==body.device_id)
       throw fault('Event ID was already used with different content.',409);
     continue;
   }
   if(e.event_type==='ops.snapshot'){
     const p=e.payload;
     await client.query(`INSERT INTO mirror_ops(store_id,device_id,version,payload)
       VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(store_id,device_id)
       DO UPDATE SET version=EXCLUDED.version,payload=EXCLUDED.payload,updated_at=now()
       WHERE mirror_ops.version<EXCLUDED.version`,[STORE_ID,body.device_id,p.version,JSON.stringify(p)]);
     continue;
   }
   const s=e.payload;
   await client.query(`INSERT INTO mirror_sales(store_id,device_id,event_id,local_sale_id,receipt_no,created_at,sale_type,status,
     cashier,customer_name,total_paisa,paid_paisa,due_paisa,tax_paisa,items,payments)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb)`,
    [STORE_ID,body.device_id,e.event_id,s.local_sale_id,s.receipt_no,new Date(s.created_at.replace(' ','T')+'Z').toISOString(),
     s.sale_type,s.status,s.cashier,s.customer_name,s.total_paisa,s.paid_paisa,s.due_paisa,s.tax_paisa,
     JSON.stringify(s.items),JSON.stringify(s.payments)]);
  }
  await client.query('COMMIT');
  return {acknowledged:normalized.map(e=>e.event_id)};
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
const server=http.createServer(async(req,res)=>{
 try{
  const route=(req.url||'').split('?')[0];
  if(req.method==='GET'&&route==='/healthz'){
    await pool.query('SELECT 1');return response(res,200,{ok:true,service:'flexico-cloud-owner-mirror'});
  }
  if(await owner.handle(req,res,route))return;
  authenticate(req);
  if(req.method==='POST'&&route==='/v1/events')return response(res,200,await ingest(await jsonRequest(req)));
  if(req.method==='GET'&&route==='/v1/dashboard'){
   const summary=await pool.query(`SELECT COUNT(*)::int AS sales,COALESCE(SUM(total_paisa),0)::text AS revenue_paisa,
    COALESCE(SUM(paid_paisa),0)::text AS collected_paisa,COALESCE(SUM(due_paisa),0)::text AS due_at_sale_paisa,
    MAX(mirrored_at) AS last_mirrored_at FROM mirror_sales WHERE store_id=$1`,[STORE_ID]);
   return response(res,200,{mode:'sales-mirror-only',note:'Not net of returns or subsequent COD payments. Not master stock.',...summary.rows[0]});
  }
  if(req.method==='GET'&&route==='/v1/sales'){
   const result=await pool.query(`SELECT receipt_no,device_id,local_sale_id,created_at,sale_type,status,cashier,customer_name,
       total_paisa::text,paid_paisa::text,due_paisa::text FROM mirror_sales WHERE store_id=$1
       ORDER BY created_at DESC,event_id DESC LIMIT 100`,[STORE_ID]);
   return response(res,200,{sales:result.rows});
  }
  throw fault('Not found.',404);
 }catch(e){
  if(e.status)return response(res,e.status,{error:e.message});
  console.error('[cloud mirror]',e);return response(res,500,{error:'Cloud server error.'});
 }
});
if(require.main===module){
 (async()=>{
  await pool.query(fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8'));
  server.listen(PORT,HOST,()=>console.log(`Flexico sales mirror on ${HOST}:${PORT} (deploy behind HTTPS)`));
 })().catch(e=>{console.error('Cloud startup failed:',e.message);process.exitCode=1;pool.end();});
}
process.on('SIGTERM',()=>{server.close(()=>pool.end());});
module.exports={server,ingest};
