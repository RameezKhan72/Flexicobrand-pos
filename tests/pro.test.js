'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const net=require('node:net');const {spawn}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..');const wait=ms=>new Promise(r=>setTimeout(r,ms));
const port=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
test('Professional local workflows: PO, shifts, warranty, promotions, returns, store credit, COD, backups, permissions',async t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'flexico-pro-'));const p=await port();const base=`http://127.0.0.1:${p}`;
 const server=spawn(process.execPath,['server.js'],{cwd:ROOT,env:{...process.env,PORT:String(p),FLEXICO_DB:path.join(folder,'pos.sqlite')},stdio:['ignore','pipe','pipe']});
 let output='';server.stdout.on('data',b=>output+=b);server.stderr.on('data',b=>output+=b);
 t.after(async()=>{server.kill();await new Promise(r=>{if(server.exitCode!==null||server.signalCode!==null)return r();server.once('exit',r);setTimeout(r,1000);});fs.rmSync(folder,{recursive:true,force:true});});
 for(let i=0;i<120;i++){if(server.exitCode!==null)throw Error(output);try{if((await fetch(base+'/api/bootstrap')).ok)break;}catch{}await wait(40);if(i===119)throw Error('Server did not start: '+output);}
 let cookie='';async function req(endpoint,method='GET',body,expected=200){const headers={};if(cookie)headers.cookie=cookie;if(body!==undefined)headers['Content-Type']='application/json';const r=await fetch(base+'/api'+endpoint,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const result=await r.json();assert.equal(r.status,expected,`${endpoint}: ${JSON.stringify(result)}`);if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return result;}
 const m=n=>(n/100).toFixed(2);
 await req('/setup','POST',{username:'root',password:'LongSecurePassword99!',demo:true},201);
 const products=(await req('/products')).products, watch=products.find(x=>x.sku==='FX-ZEN-001');
 const customer=(await req('/customers','POST',{name:'Customer for tests',phone:'03009999999'},201)).id;
 // supplier and purchase order
 const supplier=(await req('/pro/suppliers','POST',{name:'Watch Manufacturer',phone:'0511111111',city:'Islamabad'},201)).id;
 const purchase=(await req('/pro/purchases','POST',{supplier_id:supplier,shipping:'500.00',items:[{product_id:watch.id,qty:4,unit_cost:'5000.00'}]},201)).order;
 assert.match(purchase.number,/^PO-/);assert.equal((await req('/pro/purchases')).orders.length,1);
 const stockBefore=(await req('/products')).products.find(x=>x.id===watch.id).warehouse_qty;
 await req(`/pro/purchases/${purchase.id}/receive`,'POST',{location_id:2});
 assert.equal((await req('/products')).products.find(x=>x.id===watch.id).warehouse_qty,stockBefore+4);
 await req(`/pro/purchases/${purchase.id}/receive`,'POST',{location_id:2},400);
 const partialPayment=await req(`/pro/purchases/${purchase.id}/pay`,'POST',{amount:'9000.00',method:'Bank Transfer',reference:'SUPPLIER-TXN-01'},201);
 assert.equal(partialPayment.balance_paisa,1150000);
 assert.equal((await req(`/pro/purchases/${purchase.id}`)).order.paid_paisa,900000);
 await req(`/pro/purchases/${purchase.id}/pay`,'POST',{amount:'999999.00',method:'Cash'},400);
 // cash shift and discount coupon
 const held=(await req('/pro/holds','POST',{title:'Customer fitting',items:[{id:watch.id,qty:1}],saleType:'in_store',customerId:'',discountType:'fixed',discountValue:'0',notes:''},201)).id;
 assert.equal((await req('/pro/holds')).bills[0].payload.items[0].id,watch.id);
 await req('/pro/holds/'+held,'DELETE');
 assert.equal((await req('/pro/holds')).bills.length,0);
 const sh=(await req('/pro/shifts','POST',{opening:'1000.00'},201)).id;
 assert.equal((await req('/pro/shifts')).current.id,sh);
 await req('/pro/promotions','POST',{code:'WATCH10',kind:'percent',value:'10',minimum:'100',usage_limit:3},201);
 const discounted=(await req('/pro/promo-check?code=WATCH10&subtotal='+m(watch.price_paisa))).discount_paisa;
 assert.equal(discounted,Math.round(watch.price_paisa*.1));
 const total=watch.price_paisa-discounted;
 const sale=(await req('/sales','POST',{client_request_id:'pro-sale-1',sale_type:'in_store',customer_id:customer,items:[{product_id:watch.id,qty:1}],discount_type:'fixed',discount_value:'0',coupon_code:'WATCH10',payments:[{method:'Cash',amount:m(total)}]},201)).sale;
 assert.equal(sale.shift_id,sh);assert.equal(sale.discount_paisa,discounted);
 assert.equal(sale.warranties.length,1);
 const warr=(await req('/pro/warranties')).warranties.find(w=>w.receipt_no===sale.receipt_no);
 assert.ok(warr);await req('/pro/warranties/'+warr.id,'PATCH',{serial_no:'SN-TEST-001'});
 const claim=(await req('/pro/claims','POST',{warranty_id:warr.id,issue:'Watch hands stopping frequently'},201)).id;
 await req('/pro/claims/'+claim,'PATCH',{status:'INSPECTED',resolution:'Needs service'});
 assert.equal((await req('/pro/claims')).claims[0].status,'INSPECTED');
 // return -> quarantine + store-credit -> redeem only once
 const current=(await req('/pro/returns/sale/'+sale.id)).items[0];
 const returnResult=await req('/pro/returns','POST',{sale_id:sale.id,items:[{sale_item_id:current.id,qty:1}],refund_method:'Store Credit',reason:'Customer requested exchange'},201);
 assert.equal(returnResult.refund_paisa,total);
 const balance=(await req('/pro/customer-credits')).credits.find(c=>c.id===customer).balance_paisa;
 assert.equal(balance,total);
 assert.equal((await req('/pro/returns/sale/'+sale.id)).items[0].returnable_qty,0);
 await req('/pro/returns','POST',{sale_id:sale.id,items:[{sale_item_id:current.id,qty:1}],refund_method:'Store Credit',reason:'Duplicate'},400);
 assert.equal((await req('/pro/warranties')).warranties.find(w=>w.id===warr.id).status,'RETURNED');
 const redeem=(await req('/sales','POST',{client_request_id:'redeem-1',sale_type:'in_store',customer_id:customer,items:[{product_id:watch.id,qty:1}],payments:[{method:'Store Credit',amount:m(total)},{method:'Cash',amount:m(watch.price_paisa-total)}]},201)).sale;
 assert.equal(redeem.status,'PAID');
 assert.equal((await req('/pro/customer-credits')).credits.find(c=>c.id===customer).balance_paisa,0);
 await req('/sales','POST',{client_request_id:'redeem-2',sale_type:'in_store',customer_id:customer,items:[{product_id:watch.id,qty:1}],payments:[{method:'Store Credit',amount:'100.00'},{method:'Cash',amount:m(watch.price_paisa-10000)}]},400);
 // COD manual order and remittance
 const codAdvance=Math.ceil(watch.price_paisa*.1);
 const cod=(await req('/sales','POST',{client_request_id:'pro-cod-1',sale_type:'delivery_cod',customer_id:customer,items:[{product_id:watch.id,qty:1}],payments:[{method:'Cash',amount:m(codAdvance)}]},201)).sale;
 const orders=(await req('/pro/orders')).orders;assert.ok(orders.some(x=>x.sale_id===cod.id));
 await req(`/pro/orders/${cod.id}`,'PATCH',{verified:true,status:'DISPATCHED',courier:'Leopard',tracking:'LP1234'});
 await req(`/pro/orders/${cod.id}/collect`,'POST',{amount:m(cod.due_paisa),reference:'REF1234'});
 assert.equal((await req('/sales/'+cod.id)).sale.due_paisa,0);
 // stock count
 const c=(await req('/pro/stock-counts','POST',{location_id:2,notes:'Count test'},201)).id;
 const items=(await req('/pro/stock-counts/'+c)).items;
 const adjust=items.map(x=>({product_id:x.product_id,counted_qty:x.expected_qty+(x.product_id===watch.id?-1:0)}));
 const result=await req(`/pro/stock-counts/${c}/finalize`,'POST',{items:adjust});assert.equal(result.changed,1);
 // close shift and verify no negative totals
 const shiftClose=await req(`/pro/shifts/${sh}/close`,'POST',{counted:'1000.00',notes:'Testing'});assert.ok(Number.isInteger(shiftClose.expected));
 const backups=await req('/pro/backups','POST',{});assert.ok(backups.size>1000);
 assert.equal((await req('/pro/backups')).backups.length>0,true);
 assert.equal((await req('/pro/audit')).logs.some(x=>x.action==='RETURN_COMPLETE'),true);
 // Auth boundaries
 await req('/users','POST',{username:'cashier',password:'cashierPassword12345',role:'cashier'},201);
 await req('/logout','POST',{});await req('/login','POST',{username:'cashier',password:'cashierPassword12345'});
 await req('/pro/promotions','POST',{code:'BADPROMO',kind:'percent',value:'10'},403);
 await req('/pro/returns','POST',{sale_id:sale.id,reason:'No',refund_method:'Cash',items:[{sale_item_id:current.id,qty:1}]},403);
 await req('/pro/orders');await req('/pro/shifts');
});
