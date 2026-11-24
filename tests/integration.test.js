'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
test('Full local POS flow: setup, stock, checkout, duplicate, COD, permissions and reports',async t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'flexico-test-'));
 const port=await freePort();const base=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['server.js'],{cwd:ROOT,env:{...process.env,PORT:String(port),FLEXICO_DB:path.join(folder,'db.sqlite')},stdio:['ignore','pipe','pipe']});
 let out='';child.stdout.on('data',x=>{out+=x;});child.stderr.on('data',x=>{out+=x;});
 t.after(async()=>{child.kill();await new Promise(r=>{if(child.exitCode!==null||child.signalCode!==null)return r();child.on('exit',r);setTimeout(r,2000);});fs.rmSync(folder,{recursive:true,force:true});});
 for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('Server exited: '+out);try{const r=await fetch(base+'/api/bootstrap');if(r.ok)break;}catch{}await wait(40);if(i===99)throw Error('Server startup timeout: '+out);}
 let cookie='';
 async function call(route,method='GET',body,expected=200){const headers={};if(cookie)headers.cookie=cookie;if(body!==undefined)headers['content-type']='application/json';const res=await fetch(base+'/api'+route,{method,headers,body:body!==undefined?JSON.stringify(body):undefined,redirect:'manual'});const data=await res.json();assert.equal(res.status,expected,route+' error: '+JSON.stringify(data));const session=res.headers.get('set-cookie');if(session)cookie=session.split(';')[0];return data;}
 const bootstrap=await call('/bootstrap');assert.equal(bootstrap.setupRequired,true);
 await call('/setup','POST',{username:'admin',password:'TestStrongPassword123!',store_name:'Flexico QA',demo:true},201);
 assert.equal((await call('/bootstrap')).setupRequired,false);
 const products=(await call('/products')).products;
 assert.equal(products.length,6);assert.equal(products[0].store_qty>0,true);
 const item=products.find(p=>p.sku==='FX-ZEN-001');assert.ok(item);
 const initialQty=item.store_qty;
 // A bank/payment reference is required and a partial in-store payment must fail.
 await call('/sales','POST',{client_request_id:'partial-should-fail',sale_type:'in_store',items:[{product_id:item.id,qty:1}],discount_value:'0',payments:[{method:'Cash',amount:'1'}]},400);
 await call('/stock/adjust','POST',{product_id:item.id,location_id:1,delta:3,reason:'Integration test receiving'});
 let after=(await call('/products')).products.find(p=>p.id===item.id);assert.equal(after.store_qty,initialQty+3);
 const total=Number(item.price_paisa);
 const key='checkout-request-1';
 const bill={client_request_id:key,sale_type:'in_store',items:[{product_id:item.id,qty:2}],discount_type:'fixed',discount_value:'0',payments:[{method:'Cash',amount:(total*2/100).toFixed(2)}]};
 const sale=(await call('/sales','POST',bill,201)).sale;
 assert.equal(sale.total_paisa,total*2);assert.equal(sale.status,'PAID');assert.equal(sale.items[0].qty,2);assert.match(sale.receipt_no,/^FX-\d{8}-\d{5}$/);
 const dup=await call('/sales','POST',bill);assert.equal(dup.duplicate,true);assert.equal(dup.sale.id,sale.id);
 after=(await call('/products')).products.find(p=>p.id===item.id);assert.equal(after.store_qty,initialQty+1);
 const fail=await call('/sales','POST',{client_request_id:'oversell',sale_type:'in_store',items:[{product_id:item.id,qty:500}],payments:[{method:'Cash',amount:(total*500/100).toFixed(2)}]},400);assert.match(fail.error,/only|stock/i);
 const customer=await call('/customers','POST',{name:'Tester',phone:'03001234567',city:'Islamabad'},201);
 await call('/sales','POST',{client_request_id:'cod-insufficient',sale_type:'delivery_cod',customer_id:customer.id,items:[{product_id:item.id,qty:1}],payments:[{method:'Cash',amount:'1.00'}]},400);
 const cod=(await call('/sales','POST',{client_request_id:'cod-ok',sale_type:'delivery_cod',customer_id:customer.id,items:[{product_id:item.id,qty:1}],payments:[{method:'Cash',amount:(Math.ceil(total*.10)/100).toFixed(2)}]},201)).sale;
 assert.equal(cod.status,'COD_PENDING');assert.equal(cod.due_paisa,total-Math.ceil(total*.1));
 const sales=(await call('/sales')).sales;assert.equal(sales.length,2);
 assert.equal((await call('/sales/'+sale.id)).sale.id,sale.id);
 const dashboard=(await call('/dashboard'));assert.ok(dashboard.stats.revenue>=total*3);
 const report=(await call('/reports')).report;assert.equal(report.count,2);
 await call('/users','POST',{username:'cashier1',password:'CashierTestPassword22',role:'cashier'},201);
 await call('/logout','POST',{});
 await call('/login','POST',{username:'cashier1',password:'CashierTestPassword22'});
 await call('/reports','GET',undefined,403);
 await call('/stock/adjust','POST',{product_id:item.id,location_id:1,delta:1,reason:'Unauthorized'},403);
 await call('/products','GET');
 const staticFile=await fetch(base+'/app.js');assert.equal(staticFile.status,200);assert.match(await staticFile.text(),/Complete Sale & Receipt/);
});
