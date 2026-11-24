'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'flexico-mobile-'));
process.env.FLEXICO_DB=path.join(dir,'test.sqlite');
process.env.PORT='3147';
process.env.FLEXICO_ALLOWED_HOSTS='pos.example.test:3147';
process.env.FLEXICO_ALLOWED_ORIGINS='https://pos.example.test:3147';
process.env.FLEXICO_PUBLIC_HTTPS='true';
const {server,db}=require('../server');
let port;
const req=(urlPath, method='GET',host='localhost:3147',origin='',body=null,headers={})=>new Promise((resolve,reject)=>{
 const req=http.request({hostname:'127.0.0.1',port,path:urlPath,method,headers:{Host:host,...(origin?{Origin:origin}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers}},res=>{
  const parts=[];res.on('data',c=>parts.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(parts).toString()}));
 });req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
});
test('Mobile PWA assets, strict host/origin checks and HTTPS session cookie',async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 port=server.address().port;
 try{
  const manifest=await req('/manifest.webmanifest');
  assert.equal(manifest.status,200);
  assert.equal(JSON.parse(manifest.body).display,'standalone');
  const sw=await req('/sw.js');
  assert.equal(sw.status,200);
  assert.match(sw.body,/startsWith\('\/api\/'\)/);
  assert.match(sw.body,/Sales need a running Node\.js POS server/);
  assert.equal((await req('/icon-192.png')).status,200);
  assert.equal((await req('/icon-512.png')).status,200);
  assert.equal((await req('/','GET','pos.example.test:3147')).status,200);
  assert.equal((await req('/','GET','unexpected.test:3147')).status,403);
  const cross=await req('/api/login','POST','pos.example.test:3147','https://evil.example',{username:'admin',password:'test'});
  assert.equal(cross.status,403);
  const wrongFetchSite=await req('/api/login','POST','pos.example.test:3147','https://pos.example.test:3147',{username:'admin',password:'test'},{'Sec-Fetch-Site':'cross-site'});
  assert.equal(wrongFetchSite.status,403);
  const setup=await req('/api/setup','POST','pos.example.test:3147','https://pos.example.test:3147',{username:'admin',password:'strongpassword123'});
  assert.equal(setup.status,201,setup.body);
  assert.match(setup.headers['set-cookie'][0],/; Secure/);
  assert.match(setup.headers['set-cookie'][0],/HttpOnly; SameSite=Strict/);
  const boot=await req('/api/bootstrap');
  assert.equal(boot.status,200);
  assert.equal(JSON.parse(boot.body).setupRequired,false);
  assert.match(boot.headers['cache-control'],/no-store/);
 }finally{
  await new Promise(resolve=>server.close(resolve));db.close();fs.rmSync(dir,{recursive:true,force:true});
 }
});
