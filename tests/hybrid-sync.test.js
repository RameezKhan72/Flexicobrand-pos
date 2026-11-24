'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const net=require('node:net');
const {spawn}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const ROOT=path.resolve(__dirname,'..');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
async function startPOS(dbPath, env={}){
 const port=await freePort(),base=`http://127.0.0.1:${port}`;
 let log='';
 const child=spawn(process.execPath,['server.js'],{cwd:ROOT,env:{...process.env,PORT:String(port),FLEXICO_DB:dbPath,...env},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',chunk=>log+=chunk);child.stderr.on('data',chunk=>log+=chunk);
 for(let n=0;n<100;n++){if(child.exitCode!==null)throw Error(`POS stopped: ${log}`);try{if((await fetch(base+'/api/bootstrap')).ok)break;}catch{}await pause(35);if(n===99)throw Error(`Not ready: ${log}`);}
 const close=async()=>{child.kill();await new Promise(r=>{if(child.exitCode!==null||child.signalCode!==null)return r();child.once('exit',r);setTimeout(r,2000);});};
 return {base,close,log:()=>log};
}
test('Hybrid: local sales queue survives network outage, retries, deduplicates, preserves prior sales',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'flexico-hybrid-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const dbPath=path.join(dir,'pos.sqlite');
 let child=await startPOS(dbPath);
 t.after(()=>child.close());
 let cookie='';
 async function call(route,method='GET',body,status=200){const h={};if(cookie)h.cookie=cookie;if(body!==undefined)h['content-type']='application/json';const res=await fetch(child.base+'/api'+route,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});const data=await res.json();assert.equal(res.status,status,`${route}: ${JSON.stringify(data)}`);if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];return data;}
 await call('/setup','POST',{username:'admin',password:'StrongHybridTest123!',demo:true},201);
 const product=(await call('/products')).products.find(x=>x.sku==='FX-ZEN-001');
 let sale=(await call('/sales','POST',{client_request_id:'offline-original-1',sale_type:'in_store',
  items:[{product_id:product.id,qty:1}],discount_type:'fixed',discount_value:'0',
  payments:[{method:'Cash',amount:(product.price_paisa/100).toFixed(2)}]},201)).sale;
 const off=await call('/sync/status');
 assert.equal(off.configured,false);assert.equal(off.pending,1);assert.equal(off.synced,0);
 await call('/sales','POST',{client_request_id:'offline-original-1',sale_type:'in_store',items:[],payments:[]});
 assert.equal((await call('/sync/status')).pending,1);
 await child.close();
 // Simulates cloud returning 503 once; retry occurs without creating another local sale.
 const events=new Map();let calls=0;
 const mock=http.createServer(async(req,res)=>{
  let buf='';for await(const chunk of req)buf+=chunk;
  if(req.url!=='/v1/events'||req.headers.authorization!=='Bearer local-hybrid-test-token'){
   res.writeHead(401);res.end(JSON.stringify({error:'Unauthorized'}));return;
  }
  calls++;
  const payload=JSON.parse(buf);
  assert.equal(payload.events.length,1);
  for(const event of payload.events){assert.equal(event.payload.receipt_no,sale.receipt_no);events.set(event.event_id,event.payload);}
  if(calls===1){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:'Temporary outage'}));return;}
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({acknowledged:payload.events.map(e=>e.event_id)}));
 });
 const mockPort=await freePort();await new Promise(r=>mock.listen(mockPort,'127.0.0.1',r));
 t.after(()=>mock.close());
 child=await startPOS(dbPath,{FLEXICO_CLOUD_SYNC_URL:`http://127.0.0.1:${mockPort}/v1/events`,
  FLEXICO_CLOUD_TOKEN:'local-hybrid-test-token',FLEXICO_ALLOW_HTTP_SYNC:'1'});
 let status=await call('/sync/status');assert.equal(status.pending,1);assert.equal(status.configured,true);
 status=await call('/sync/now','POST',{});assert.equal(status.pending,1);assert.match(status.last_error,/503/);
 status=await call('/sync/now','POST',{});assert.equal(status.pending,0);assert.equal(status.synced,1);
 assert.equal(events.size,1);assert.equal(calls,2);assert.ok(status.last_sync_at);
 await child.close();
 // Restart preserves install UUID, synced event state, and has no backfilled duplicates.
 child=await startPOS(dbPath);
 status=await call('/sync/status');assert.equal(status.total,1);assert.equal(status.pending,0);assert.equal(status.synced,1);
 const db=new DatabaseSync(dbPath,{readOnly:true});
 try {assert.equal(db.prepare('SELECT COUNT(*) n FROM sales').get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sync_outbox').get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sync_installation').get().n,1);
 }finally{db.close();}
});
