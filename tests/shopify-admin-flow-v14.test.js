'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const saved={SHOPIFY_STORE_DOMAIN:process.env.SHOPIFY_STORE_DOMAIN,SHOPIFY_CLIENT_ID:process.env.SHOPIFY_CLIENT_ID,SHOPIFY_CLIENT_SECRET:process.env.SHOPIFY_CLIENT_SECRET,SHOPIFY_ADMIN_TOKEN:process.env.SHOPIFY_ADMIN_TOKEN};
process.env.SHOPIFY_STORE_DOMAIN='demo-store.myshopify.com';process.env.SHOPIFY_CLIENT_ID='test-id';process.env.SHOPIFY_CLIENT_SECRET='test-secret';delete process.env.SHOPIFY_ADMIN_TOKEN;
const catalog=require('../shopify-catalog');
for(const [k,v] of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
function setup(){const db=new DatabaseSync(':memory:');db.exec(`PRAGMA foreign_keys=ON;CREATE TABLE products(id INTEGER PRIMARY KEY,sku TEXT UNIQUE NOT NULL,barcode TEXT UNIQUE,name TEXT,brand TEXT,category TEXT,variant TEXT,cost_paisa INTEGER DEFAULT 0,price_paisa INTEGER,sale_price_paisa INTEGER,threshold INTEGER DEFAULT 5,is_active INTEGER DEFAULT 1,image_path TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE stock(product_id INTEGER,location_id INTEGER,qty INTEGER DEFAULT 0,PRIMARY KEY(product_id,location_id));CREATE TABLE price_history(id INTEGER PRIMARY KEY,product_id INTEGER,old_price_paisa INTEGER,new_price_paisa INTEGER,user_id INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP);CREATE TABLE audit_logs(id INTEGER PRIMARY KEY,user_id INTEGER,action TEXT,target TEXT,reason TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);catalog.install(db);return db;}
test('Dev Dashboard credentials -> Admin GraphQL preview -> import, with no stock overwrite',async()=>{
 const old=global.fetch;let tokenRequests=0,graphRequests=0;
 global.fetch=async(url,options)=>{
  if(String(url).endsWith('/admin/oauth/access_token')){tokenRequests++;assert.equal(new URLSearchParams(options.body).get('client_secret'),'test-secret');return {ok:true,status:200,headers:new Headers(),json:async()=>({access_token:'test-access-token',scope:'read_products',expires_in:86399})};}
  if(String(url).endsWith('/admin/api/2026-10/graphql.json')){graphRequests++;assert.equal(options.headers['X-Shopify-Access-Token'],'test-access-token');return {ok:true,status:200,headers:new Headers(),text:async()=>JSON.stringify({data:{products:{pageInfo:{hasNextPage:false,endCursor:null},nodes:[{id:'gid://shopify/Product/123',title:'FLEXICO Watch',handle:'flexico-watch',productType:'Watch',vendor:'FLEXICO',descriptionHtml:'Watch description',tags:['Watch'],featuredImage:{url:'https://cdn.shopify.com/fixture.png'},variants:{pageInfo:{hasNextPage:false},nodes:[{id:'gid://shopify/ProductVariant/999',title:'Classic',sku:'FX-W999',barcode:'999',price:'12999.00',compareAtPrice:'15999.00',availableForSale:true,selectedOptions:[{name:'Dial',value:'Black'}]}]}}]}}})};}
  throw Error('unexpected endpoint '+url);
 };
 const db=setup();try{
  const handle=catalog.create(db),url=p=>new URL('http://localhost'+p),user={role:'admin',id:1};
  let r=await handle({method:'GET'},url('/api/catalog/status'),user);assert.equal(r.body.adminAuthMode,'client-credentials');
  r=await handle({method:'POST'},url('/api/catalog/preview'),user);assert.equal(r.status,200);assert.equal(r.body.preview.variants,1);assert.equal(r.body.preview.examples[0].price_paisa,1299900);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM products').get().n,0);
  r=await handle({method:'POST'},url('/api/catalog/import'),user);assert.equal(r.status,200);assert.equal(r.body.created,1);
  assert.equal(db.prepare('SELECT price_paisa FROM products LIMIT 1').get().price_paisa,1599900);
  assert.equal(db.prepare('SELECT sale_price_paisa FROM products LIMIT 1').get().sale_price_paisa,1299900);
  assert.equal(db.prepare('SELECT qty FROM stock LIMIT 1').get().qty,0);
  assert.equal(tokenRequests,1);assert.equal(graphRequests,2);
 }finally{db.close();global.fetch=old;}
});
