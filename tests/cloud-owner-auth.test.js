'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const http=require('node:http');const {install}=require('../cloud/owner');
test('Cloud owner portal separates credentials from sync bearer, login, cookie and read-only data',async()=>{
 process.env.CLOUD_OWNER_USERNAME='verified-owner';process.env.CLOUD_OWNER_PASSWORD='StrongUniqueOwnerPass#_2026';
 const sessions=new Map(),pool={async query(sql,params=[]){
  if(sql.startsWith('INSERT INTO owner_sessions')){sessions.set(params[0],true);return {rowCount:1,rows:[]};}
  if(sql.startsWith('DELETE FROM owner_sessions')){sessions.delete(params[0]);return {rowCount:1,rows:[]};}
  if(sql.startsWith('SELECT 1 FROM owner_sessions'))return {rowCount:sessions.has(params[0])?1:0,rows:[]};
  if(sql.includes('FROM mirror_ops'))return {rowCount:0,rows:[]};
  if(sql.includes('FROM mirror_sales'))return {rows:[],rowCount:0};
  throw Error('Unexpected DB query: '+sql);
 }};
 const owner=install({pool,storeId:'flexico-main'});
 const server=http.createServer(async(req,res)=>{try{await owner.handle(req,res,(req.url||'').split('?')[0]);}catch(e){res.writeHead(500);res.end(e.message);}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const base='http://127.0.0.1:'+server.address().port;
  let res=await fetch(base+'/owner/api/dashboard');assert.equal(res.status,401);
  res=await fetch(base+'/owner/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'verified-owner',password:'wrongpass'})});assert.equal(res.status,401);
  res=await fetch(base+'/owner/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'verified-owner',password:'StrongUniqueOwnerPass#_2026'})});assert.equal(res.status,200);
  const cookie=res.headers.get('set-cookie').split(';')[0];assert.match(res.headers.get('set-cookie'),/HttpOnly.*SameSite=Strict/);
  res=await fetch(base+'/owner/api/dashboard',{headers:{cookie}});assert.equal(res.status,200);let body=await res.json();assert.equal(body.mode,'read-only-single-store');assert.equal(body.snapshot,null);
  assert.equal(JSON.stringify(body).includes(process.env.CLOUD_OWNER_PASSWORD),false);
  res=await fetch(base+'/owner/api/logout',{method:'POST',headers:{cookie,'content-type':'application/json'},body:'{}'});assert.equal(res.status,200);
  res=await fetch(base+'/owner/api/dashboard',{headers:{cookie}});assert.equal(res.status,401);
 }finally{await new Promise(r=>server.close(r));}
});
