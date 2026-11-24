'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const net=require('node:net');const http=require('node:http');const {spawn}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'..');
async function port(){return await new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});}
async function start(db,env={}){const p=await port(),child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:p,FLEXICO_DB:db,...env},stdio:['ignore','pipe','pipe']});let log='';child.stderr.on('data',x=>log+=x);child.stdout.on('data',x=>log+=x);
 const base=`http://127.0.0.1:${p}`;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/bootstrap')).ok)break;}catch{}await new Promise(r=>setTimeout(r,30));if(i===99)throw Error(log||'timeout');}
 return {base,async stop(){child.kill();await new Promise(r=>child.once('exit',r));},log:()=>log};}
test('v1 customer receivables: manager gated credit sale, partial collection, retry safety and cloud state',async t=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'fx-v1-'));t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
 let app=await start(path.join(tmp,'db.sqlite'));t.after(()=>app.stop());let cookie='';
 async function api(route,method='GET',data,expected=200){const response=await fetch(app.base+'/api'+route,{method,headers:{...(cookie?{cookie}:{}),...(data!==undefined?{'content-type':'application/json'}:{})},body:data===undefined?undefined:JSON.stringify(data)});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];const obj=await response.json();assert.equal(response.status,expected,`${route}: ${JSON.stringify(obj)}`);return obj;}
 await api('/setup','POST',{username:'owner',password:'x-Strong-Pass-012345',demo:true},201);
 const customer=(await api('/customers','POST',{name:'Credit tester',phone:'03000000001'},201)).id;
 const product=(await api('/products')).products.find(p=>p.sku==='FX-ZEN-001');
 const baseSale={client_request_id:'credit-001',sale_type:'layaway',customer_id:customer,items:[{product_id:product.id,qty:1}],discount_type:'fixed',discount_value:'0',payments:[{method:'Cash',amount:'100.00'}]};
 await api('/sales','POST',baseSale,403);
 const settings=(await api('/settings')).settings;await api('/settings','PATCH',{...settings,customer_credit_enabled:true});
 const created=await api('/sales','POST',baseSale,201);
 assert.equal(created.sale.status,'CREDIT_PENDING');assert.ok(created.sale.due_paisa>0);
 assert.equal((await api('/receivables')).receivables.length,1);
 await api('/pro/shifts','POST',{opening:'0',notes:'testing'},201);
 const amount='50.00',payload={amount,method:'Cash',collection_id:'collect-001'};
 const first=await api(`/receivables/${created.sale.id}/collect`,'POST',payload);assert.equal(first.due_paisa,created.sale.due_paisa-5000);
 const repeat=await api(`/receivables/${created.sale.id}/collect`,'POST',payload);assert.equal(repeat.duplicate,true);
 await api(`/receivables/${created.sale.id}/collect`,'POST',{...payload,amount:'60.00'},409);
 const closed=await api('/pro/shifts');const active=closed.current;
 const shift=await api(`/pro/shifts/${active.id}/close`,'POST',{counted:'50.00',notes:'collection test'});
 assert.equal(shift.expected,5000,'Prior sale cash must not be reassigned to a later cash shift');
 const snap=require('../ops-snapshot').snapshot;
 const db=new DatabaseSync(path.join(tmp,'db.sqlite'),{readOnly:true});const state=snap(db,4);assert.equal(state.statistics.outstanding_paisa,first.due_paisa);assert.equal(state.statistics.sales_count,1);db.close();
 assert.ok((await api('/sync/status')).ops_pending>=1);
});
test('v1 operational snapshots upload and recover from cloud failure',async t=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'fx-snapshot-'));t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
 const uploads=[];let failures=1;
 const cloud=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;
  if(req.url!=='/v1/events'||req.headers.authorization!=='Bearer test-v1-token')return res.writeHead(401).end();
  const data=JSON.parse(body);uploads.push(...data.events);res.writeHead(failures-- >0?503:200,{'content-type':'application/json'});
  res.end(JSON.stringify(failures>=0?{error:'offline'}:{acknowledged:data.events.map(e=>e.event_id)}));
 });const cp=await port();await new Promise(r=>cloud.listen(cp,'127.0.0.1',r));t.after(()=>cloud.close());
 const app=await start(path.join(tmp,'db.sqlite'),{FLEXICO_CLOUD_SYNC_URL:`http://127.0.0.1:${cp}/v1/events`,FLEXICO_ALLOW_HTTP_SYNC:'1',FLEXICO_CLOUD_TOKEN:'test-v1-token'});t.after(()=>app.stop());let cookie='';
 async function api(route,method='GET',body,status=200){const r=await fetch(app.base+'/api'+route,{method,headers:{...(cookie?{cookie}:{}),...(body!==undefined?{'content-type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];const j=await r.json();assert.equal(r.status,status,`${route} ${JSON.stringify(j)}`);return j;}
 await api('/setup','POST',{username:'admin',password:'Strong-Test-Pass1',demo:true},201);
 let status=await api('/sync/status');assert.ok(status.ops_pending>=1);
 status=await api('/sync/now','POST',{});assert.ok(status.ops_pending>=1);assert.match(status.last_error,/503/);
 status=await api('/sync/now','POST',{});assert.equal(status.ops_pending,0);
 assert.equal(uploads.length,2);assert.equal(uploads[0].event_id,uploads[1].event_id);
 assert.equal(uploads[1].event_type,'ops.snapshot');
 const snap=uploads[1].payload;assert.ok(snap.statistics.products_count>=6);assert.ok(snap.stock.length>0);
});
