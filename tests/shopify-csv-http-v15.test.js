'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const net=require('node:net');const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
async function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
test('real POS HTTP: Shopify CSV preview/import and repeat, no stock overwritten',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'flexico-csv-http-'));const port=await freePort();const base='http://127.0.0.1:'+port;
 const proc=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:String(port),FLEXICO_DB:path.join(dir,'db.sqlite'),HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
 let log='';proc.stderr.on('data',d=>log+=d);t.after(async()=>{proc.kill('SIGTERM');await new Promise(r=>{if(proc.exitCode!==null||proc.signalCode!==null)return r();proc.once('exit',r);setTimeout(r,1500);});fs.rmSync(dir,{recursive:true,force:true});});
 for(let i=0;i<90;i++){if(proc.exitCode!==null)throw Error(log);try{const r=await fetch(base+'/api/bootstrap');if(r.status===200)break;}catch{}await new Promise(r=>setTimeout(r,45));if(i===89)throw Error('No server: '+log);}
 let cookie='';async function api(route,method='GET',payload,expected=200){const r=await fetch(base+'/api'+route,{method,headers:{...(cookie?{cookie}:{}),...(payload?{'content-type':'application/json'}:{})},body:payload?JSON.stringify(payload):undefined});const obj=await r.json();assert.equal(r.status,expected,JSON.stringify(obj));const set=r.headers.get('set-cookie');if(set)cookie=set.split(';')[0];return obj;}
 await api('/setup','POST',{username:'admin',password:'StrongPwdSomeTime2026!',store_name:'FLEXICO',demo:false},201);
 const csv='Handle,Title,Vendor,Type,Published,Option1 Name,Option1 Value,Variant SKU,Variant Price,Variant Compare At Price,Status\nnew-watch,FLEXICO Gold Watch,FLEXICO,Watches,TRUE,Dial,Blue,FX-BLUE,8999.00,11999.00,active\nnew-watch,,,,,,Black,FX-BLACK,9999.00,11999.00,\n';
 let r=await api('/catalog/csv-preview','POST',{csv});assert.equal(r.preview.variants,2);assert.equal(r.preview.new,2);
 r=await api('/catalog/csv-import','POST',{csv});assert.equal(r.created,2);
 let prods=(await api('/products')).products;const blue=prods.find(x=>x.sku==='FX-BLUE');assert.ok(blue);assert.equal(blue.sale_price_paisa,899900);assert.equal(blue.price_paisa,1199900);assert.equal(blue.store_qty,0);
 await api('/stock/adjust','POST',{product_id:blue.id,location_id:1,delta:5,reason:'Physical stock count'});
 r=await api('/catalog/csv-import','POST',{csv});assert.equal(r.created,0);assert.equal(r.updated,2);
 prods=(await api('/products')).products;assert.equal(prods.find(x=>x.id===blue.id).store_qty,5);
 const status=await api('/catalog/status');assert.equal(status.shopifyVariants,2);
 await api('/catalog/csv-import','POST',{csv:'Handle,Title\nfoo,bar'},400);
});
