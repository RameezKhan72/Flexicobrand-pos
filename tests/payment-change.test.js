'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const ROOT=path.resolve(__dirname,'..');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function freePort(){return new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});}
test('Change due: split payments, cash-only overpay, COD due, ledger and shifts',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'flexico-change-'));
 const port=await freePort();const dbPath=path.join(dir,'test.sqlite'),base=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['server.js'],{cwd:ROOT,env:{...process.env,PORT:String(port),FLEXICO_DB:dbPath},stdio:['ignore','pipe','pipe']});
 let log='';child.stdout.on('data',s=>log+=s);child.stderr.on('data',s=>log+=s);
 t.after(async()=>{child.kill();await new Promise(resolve=>{if(child.exitCode!==null||child.signalCode!==null)return resolve();child.once('exit',resolve);setTimeout(resolve,2000);});fs.rmSync(dir,{recursive:true,force:true});});
 for(let n=0;n<120;n++){if(child.exitCode!==null)throw Error('Server exited: '+log);try{if((await fetch(base+'/api/bootstrap')).ok)break;}catch{}await wait(30);if(n===119)throw Error('Server not ready: '+log);}
 let cookie='';
 async function call(url,method='GET',body,status=200){const headers={};if(cookie)headers.cookie=cookie;if(body!==undefined)headers['content-type']='application/json';const r=await fetch(base+'/api'+url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();assert.equal(r.status,status,`${url} ${JSON.stringify(data)}`);if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return data;}
 const fmt=p=>(p/100).toFixed(2);
 await call('/setup','POST',{username:'admin',password:'StrongTestPassword34!',demo:true},201);
 const item=(await call('/products')).products.find(p=>p.sku==='FX-ZEN-001');assert.ok(item);
 const total=item.price_paisa;
 const shift=(await call('/pro/shifts','POST',{opening:'1000.00'},201)).id;
 const bill=(key,type,payments,customer_id)=>({client_request_id:key,sale_type:type,customer_id,items:[{product_id:item.id,qty:1}],discount_type:'fixed',discount_value:'0',payments});
 // Scenario matching the user's screenshot: bank receives part, cash is tendered for entire bill.
 const bank=24491;
 const split=(await call('/sales','POST',bill('split-overpay','in_store',[{method:'Bank Transfer',amount:fmt(bank),reference:'TEST-24491'},{method:'Cash',amount:fmt(total)}]),201)).sale;
 assert.equal(split.tendered_paisa,total+bank);
 assert.equal(split.change_paisa,bank);
 assert.equal(split.paid_paisa,total);
 assert.equal(split.due_paisa,0);
 assert.equal(split.status,'PAID');
 assert.equal(split.payments.find(x=>x.method==='Cash').amount_paisa,total-bank);
 assert.equal(split.payments.find(x=>x.method==='Cash').tendered_paisa,total);
 assert.equal(split.payments.find(x=>x.method==='Bank Transfer').amount_paisa,bank);
 assert.equal((await call('/sales','POST',bill('split-overpay','in_store',[{method:'Cash',amount:'1.00'}]))).duplicate,true);
 const cashOnly=(await call('/sales','POST',bill('cash-only','in_store',[{method:'Cash',amount:fmt(total+100100)}]),201)).sale;
 assert.equal(cashOnly.tendered_paisa,total+100100);
 assert.equal(cashOnly.change_paisa,100100);
 assert.equal(cashOnly.payments[0].amount_paisa,total);
 assert.equal(cashOnly.payments[0].tendered_paisa,total+100100);
 // Multiple cash lines: return change from last cash row first; retained cash cannot go negative.
 const multi=(await call('/sales','POST',bill('multi-cash','in_store',[{method:'Cash',amount:'200.00'},{method:'Cash',amount:fmt(total+50000)}]),201)).sale;
 assert.equal(multi.change_paisa,70000);
 assert.equal(multi.payments.reduce((n,p)=>n+p.amount_paisa,0),total);
 assert.equal(multi.payments.reduce((n,p)=>n+p.tendered_paisa,0),total+70000);
 // Noncash must never manufacture cash change.
 await call('/sales','POST',bill('bad-bank','in_store',[{method:'Bank Transfer',amount:fmt(total+100),reference:'TEST'}]),400);
 await call('/sales','POST',bill('bad-noncash-plus-cash','in_store',[{method:'Card',amount:fmt(total+100)},{method:'Cash',amount:'100.00'}]),400);
 await call('/sales','POST',bill('partial-store','in_store',[{method:'Cash',amount:'100.00'}]),400);
 const customer=(await call('/customers','POST',{name:'Cash change test customer'},201)).id;
 const advance=Math.ceil(total*.1);
 const cod=(await call('/sales','POST',bill('cod-partial','delivery_cod',[{method:'Cash',amount:fmt(advance)}],customer),201)).sale;
 assert.equal(cod.change_paisa,0);assert.equal(cod.paid_paisa,advance);assert.equal(cod.due_paisa,total-advance);
 assert.equal(cod.status,'COD_PENDING');
 const codFull=(await call('/sales','POST',bill('cod-overpay','delivery_cod',[{method:'Cash',amount:fmt(total+10000)}],customer),201)).sale;
 assert.equal(codFull.change_paisa,10000);assert.equal(codFull.due_paisa,0);assert.equal(codFull.status,'PAID');
 const report=(await call('/reports')).report;
 assert.equal(report.collected,split.paid_paisa+cashOnly.paid_paisa+multi.paid_paisa+cod.paid_paisa+codFull.paid_paisa);
 // Cash drawer expects the *retained* cash; change handed back must NOT inflate drawer count.
 const cashKept=(total-bank)+total+total+advance+total;
 const closing=await call(`/pro/shifts/${shift}/close`,'POST',{counted:fmt(100000+cashKept)},200);
 assert.equal(closing.expected,100000+cashKept);
 assert.equal(closing.variance,0);
 const db=new DatabaseSync(dbPath,{readOnly:true});
 try {assert.equal(db.prepare('SELECT COUNT(*) AS c FROM sales').get().c,5);
  assert.equal(db.prepare("SELECT SUM(amount_paisa) AS a FROM payments WHERE method='Cash'").get().a,cashKept);
 } finally {db.close();}
});
