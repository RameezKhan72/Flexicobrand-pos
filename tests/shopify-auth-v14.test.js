'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createAuth}=require('../shopify-auth');
function response(status,data){return {ok:status===200,status,async json(){return data}};}
test('Shopify Dev Dashboard client credentials authenticate, cache and refresh',async()=>{
 let now=1000000,calls=0;
 const auth=createAuth({shop:'sample-store.myshopify.com',clientId:'id',clientSecret:'secret',clock:()=>now,request:async(url,opts)=>{
  calls++;assert.equal(url,'https://sample-store.myshopify.com/admin/oauth/access_token');
  assert.equal(opts.method,'POST');assert.equal(opts.headers['Content-Type'],'application/x-www-form-urlencoded');
  assert.equal(new URLSearchParams(opts.body).get('grant_type'),'client_credentials');
  return response(200,{access_token:'token-'+calls,scope:'read_products',expires_in:86399});
 }});
 assert.equal(auth.ready,true);assert.equal(await auth.accessToken(),'token-1');
 assert.equal(await auth.accessToken(),'token-1');assert.equal(calls,1);
 now+=86400*1000;assert.equal(await auth.accessToken(),'token-2');assert.equal(calls,2);
});
test('Shopify authentication coalesces simultaneous token requests',async()=>{
 let calls=0;const auth=createAuth({shop:'sample-store.myshopify.com',clientId:'id',clientSecret:'secret',request:async()=>{calls++;await new Promise(r=>setTimeout(r,5));return response(200,{access_token:'shared',scope:'read_products',expires_in:1000})}});
 assert.deepEqual(await Promise.all([auth.accessToken(),auth.accessToken(),auth.accessToken()]),['shared','shared','shared']);assert.equal(calls,1);
});
test('Shopify token errors do not reveal credentials and can be retried',async()=>{
 let calls=0;const auth=createAuth({shop:'sample-store.myshopify.com',clientId:'id',clientSecret:'private-secret',request:async()=>{calls++;return calls===1?response(401,{}):response(200,{access_token:'ok',scope:'read_products',expires_in:1200})}});
 await assert.rejects(auth.accessToken(),/HTTP 401/);assert.equal(await auth.accessToken(),'ok');
 const missing=createAuth({shop:'sample-store.myshopify.com',clientId:'id',clientSecret:'secret',request:async()=>response(200,{access_token:'unsafe',scope:'write_products',expires_in:1200})});
 await assert.rejects(missing.accessToken(),/lacks read_products/);
});
test('Legacy token compatibility, missing settings and domain validation',async()=>{
 const legacy=createAuth({shop:'store.myshopify.com',legacyToken:'oldtoken'});assert.equal(await legacy.accessToken(),'oldtoken');
 assert.equal(createAuth({shop:'evil.net',legacyToken:'oldtoken'}).ready,false);
 await assert.rejects(createAuth({shop:'evil.net',legacyToken:'oldtoken'}).accessToken(),/SHOPIFY_STORE_DOMAIN/);
 await assert.rejects(createAuth({shop:'store.myshopify.com',clientId:'only'}).accessToken(),/Both SHOPIFY/);
});
