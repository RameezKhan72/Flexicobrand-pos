'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
async function request(base,url,method='GET',body=null,cookie=''){
 const resp=await fetch(base+url,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});
 const result=await resp.json();return {status:resp.status,body:result,cookie:resp.headers.get('set-cookie')};
}
test('HTTP catalogue preview, import and safe repeat import',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fx-cat-test-'));const db=path.join(dir,'test.sqlite');const port=32000+Math.floor(Math.random()*1000);const url='http://127.0.0.1:'+port;
 const child=spawn(process.execPath,['-r',path.join(__dirname,'catalogue-fetch-fixture.cjs'),'server.js'],{cwd:root,env:{...process.env,PORT:String(port),FLEXICO_DB:db,HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
 try{
  let ready=false;for(let i=0;i<80;i++){try{const r=await request(url,'/api/bootstrap');if(r.status===200){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,70));}assert.equal(ready,true,'server failed to start');
  let r=await request(url,'/api/setup','POST',{username:'owner',password:'Example!Password.321',store_name:'Flexico Watches',demo:false});assert.equal(r.status,201,r.body.error);
  const cookie=r.cookie.split(';')[0];
  r=await request(url,'/api/catalog/preview','POST',{},cookie);assert.equal(r.status,200,r.body.error);assert.equal(r.body.preview.variants,2);
  r=await request(url,'/api/catalog/import','POST',{},cookie);assert.equal(r.status,200,r.body.error);assert.equal(r.body.created,2);
  r=await request(url,'/api/products','GET',null,cookie);assert.equal(r.status,200);let p=r.body.products.find(x=>x.shopify_variant_id==='781');assert.equal(p.sale_price_paisa,899900);assert.equal(p.price_paisa,2000000);assert.equal(p.store_qty,0);
  let adjust=await request(url,'/api/stock/adjust','POST',{product_id:p.id,location_id:1,delta:8,reason:'physical count'},cookie);assert.equal(adjust.status,200,adjust.body.error);
  r=await request(url,'/api/catalog/import','POST',{},cookie);assert.equal(r.body.created,0);assert.equal(r.body.updated,2);
  r=await request(url,'/api/products','GET',null,cookie);p=r.body.products.find(x=>x.shopify_variant_id==='781');assert.equal(p.store_qty,8);
  r=await request(url,'/api/catalog/status','GET',null,cookie);assert.equal(r.body.shopifyVariants,2);
 }finally{
  child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(resolve,2000);});
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
