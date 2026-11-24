'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const catalog=require('../shopify-catalog');
const publicSample=[
 {id:111,title:'Flexico Zenior Date Just',handle:'zenior-date-just',body_html:'<p>40mm &amp; premium stainless steel</p>',vendor:'Flexico',product_type:'Quartz',tags:'Watches, Zenior',image:{src:'https://cdn.shopify.com/s/files/1/test.jpg'},options:[{name:'Dial'}],variants:[
 {id:901,sku:'FX-ZEN-WHT',barcode:'B901',title:'White Dial',option1:'White',price:'8999.00',compare_at_price:'20000.00',available:true},
 {id:902,sku:'FX-ZEN-BLK',barcode:'B902',title:'Black Dial',option1:'Black',price:'9999.00',compare_at_price:null,available:true}]},
 {id:112,title:'Flexico Gift Box',handle:'flexico-gift',body_html:'Gift box',vendor:'Flexico',product_type:'Gift Box',variants:[
 {id:903,sku:'',barcode:null,title:'Default Title',price:'15999.00',compare_at_price:'20000.00',available:false}]}];
function createDb(){const db=new DatabaseSync(':memory:');db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE products(id INTEGER PRIMARY KEY,sku TEXT UNIQUE NOT NULL,barcode TEXT UNIQUE,name TEXT,brand TEXT,category TEXT,variant TEXT,cost_paisa INTEGER DEFAULT 0,price_paisa INTEGER,sale_price_paisa INTEGER,threshold INTEGER DEFAULT 5,is_active INTEGER DEFAULT 1,image_path TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE stock(product_id INTEGER,location_id INTEGER,qty INTEGER DEFAULT 0,PRIMARY KEY(product_id,location_id));
 CREATE TABLE price_history(id INTEGER PRIMARY KEY,product_id INTEGER,old_price_paisa INTEGER,new_price_paisa INTEGER,user_id INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE audit_logs(id INTEGER PRIMARY KEY,user_id INTEGER,action TEXT,target TEXT,reason TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 `);catalog.install(db);return db;}
test('Shopify public feed maps exact variant pricing, options, images and description',()=>{
 const rows=catalog.publicRows(publicSample);assert.equal(rows.length,3);
 assert.equal(rows[0].price_paisa,899900);assert.equal(rows[0].compare_paisa,2000000);
 assert.match(rows[0].description,/40mm & premium/);assert.equal(rows[0].variant,'White Dial');
 assert.deepEqual(JSON.parse(rows[0].options),[{name:'Dial',value:'White'}]);
 assert.equal(rows[2].variant,'');assert.equal(rows[2].available,false);
 assert.equal(catalog.photoUrl('https://evil.com/image.jpg'),'');
});
test('Shopify importer is repeatable and never overwrites local stock',()=>{
 const db=createDb();const rows=catalog.publicRows(publicSample);
 const preview=catalog.importRows(db,rows,1,{dryRun:true});assert.equal(preview.new,3);
 const one=catalog.importRows(db,rows,1);assert.equal(one.created,3);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM products').get().n,3);
 const zen=db.prepare('SELECT * FROM products WHERE shopify_variant_id=?').get('901');
 assert.equal(zen.price_paisa,2000000);assert.equal(zen.sale_price_paisa,899900);
 assert.equal(db.prepare('SELECT qty FROM stock WHERE product_id=? AND location_id=1').get(zen.id).qty,0);
 db.prepare('UPDATE stock SET qty=22 WHERE product_id=? AND location_id=1').run(zen.id);
 rows[0].price_paisa=850000;const second=catalog.importRows(db,rows,1);
 assert.equal(second.created,0);assert.equal(second.updated,3);
 assert.equal(db.prepare('SELECT qty FROM stock WHERE product_id=? AND location_id=1').get(zen.id).qty,22);
 assert.equal(db.prepare('SELECT sale_price_paisa FROM products WHERE id=?').get(zen.id).sale_price_paisa,850000);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM products').get().n,3);db.close();
});
test('Local SKU collisions do not hijack manually-created products',()=>{
 const db=createDb();db.prepare('INSERT INTO products(sku,name,price_paisa) VALUES(?,?,?)').run('FX-ZEN-WHT','Existing store record',550000);
 const r=catalog.importRows(db,catalog.publicRows(publicSample),1);
 assert.equal(r.created,3);
 const local=db.prepare("SELECT * FROM products WHERE sku='FX-ZEN-WHT'").get();assert.equal(local.shopify_variant_id,null);
 const remote=db.prepare("SELECT * FROM products WHERE shopify_variant_id='901'").get();assert.equal(remote.sku,'SHOPIFY-901');
 db.close();
});
test('Admin feed price strings correctly convert PKR into paisa',()=>{
 const rows=catalog.adminRows([{id:'gid://shopify/Product/12',title:'Test Watch',vendor:'Flexico',productType:'Quartz',descriptionHtml:'Dial 40mm',featuredImage:{url:'https://cdn.shopify.com/watch.png'},tags:['Watch'],variants:{nodes:[{id:'gid://shopify/ProductVariant/88',title:'Blue',sku:'FX88',barcode:'08',price:'8999.00',compareAtPrice:'20000.00',availableForSale:true,selectedOptions:[{name:'Dial',value:'Blue'}]}]}}]);
 assert.equal(rows.length,1);assert.equal(rows[0].price_paisa,899900);assert.equal(rows[0].compare_paisa,2000000);
});
