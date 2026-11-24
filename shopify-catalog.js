'use strict';
// Shopify catalogue reader + safe repeatable variant importer.
// No inventory is invented: imported variants start with zero local stock.
const { URL } = require('node:url');
const fs=require('node:fs');
const path=require('node:path');
const csvModule=require('./shopify-csv');
const BASE = 'https://flexicowatches.com';
const SHOP = process.env.SHOPIFY_STORE_DOMAIN || '';
const ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN || '';
const auth=require('./shopify-auth').createAuth({shop:SHOP,clientId:process.env.SHOPIFY_CLIENT_ID,clientSecret:process.env.SHOPIFY_CLIENT_SECRET,legacyToken:ADMIN_TOKEN});
function clean(v,max=5000){return String(v??'').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/\s+/g,' ').trim().slice(0,max);}
function cents(v,admin=false){
 if(v===undefined||v===null||v==='')return null;
 // /products.json has decimal major-currency strings ("8999.00" PKR).
 // /products/<handle>.js / Liquid have integer minor-unit numbers; not used for bulk import.
 // GraphQL Admin returns decimal money strings as well.
 if(typeof v==='string'||admin){
  const str=String(v).trim();
  if(!/^\d+(\.\d{1,2})?$/.test(str))return null;
  const [whole,frac='']=str.split('.');
  const value=Number(whole)*100+Number(frac.padEnd(2,'0'));
  return Number.isSafeInteger(value)?value:null;
 }
 const n=Number(v);
 return Number.isSafeInteger(n)&&n>=0?n:null;
}

function photoUrl(url){
 if(!url)return '';
 try{const u=new URL(String(url));if(u.protocol!=='https:'||!(/(^|\.)cdn\.shopify\.com$|(^|\.)shopifycdn\.net$|^flexicowatches\.com$/i).test(u.hostname))return '';return u.href.slice(0,1600);}catch{return '';}
}
function publicRows(products){
 const rows=[];
 for(const p of products||[]){
  if(!p||!Array.isArray(p.variants)||!p.variants.length)throw Error('Shopify product missing variants');
  for(const v of p.variants){
   if(!v?.id)continue;
   const compare=cents(v.compare_at_price);
   const price=cents(v.price);
   if(price===null)throw Error('Invalid Shopify variant price: '+String(v.id));
   const image=p.images?.find(i=>String(i.id)===String(v.image_id))?.src || p.image?.src || p.images?.[0]?.src || '';
   const displayVariant=clean(v.title==='Default Title'?'':v.title,160);
   rows.push({external_id:String(v.id),shopify_product_id:String(p.id),sku:clean(v.sku,45),barcode:clean(v.barcode,80),
    name:clean(p.title,180),brand:clean(p.vendor||'Flexico',80),category:clean(p.product_type||'Watch',80),variant:displayVariant,
    price_paisa:price,compare_paisa:compare,description:clean(p.body_html,5000),tags:clean(p.tags,400),handle:clean(p.handle,180),
    image_url:photoUrl(image),available:v.available!==false,options:JSON.stringify(p.options?.map((o,i)=>({name:o.name,value:v['option'+(i+1)]}))||[]).slice(0,1600)});
  }
 }
 return rows;
}
function adminRows(products){
 const rows=[];
 for(const p of products||[]){
  const productId=String(p.id||'').split('/').pop();
  for(const v of p.variants?.nodes||[]){
   const price=cents(v.price,true);
   if(price===null)throw Error('Invalid Shopify variant price: '+String(v.id));
   const compare=cents(v.compareAtPrice,true);
   rows.push({external_id:String(v.id||'').split('/').pop(),shopify_product_id:productId,sku:clean(v.sku,45),barcode:clean(v.barcode,80),
    name:clean(p.title,180),brand:clean(p.vendor||'Flexico',80),category:clean(p.productType||'Watch',80),variant:clean(v.title==='Default Title'?'':v.title,160),
    price_paisa:price,compare_paisa:compare,description:clean(p.descriptionHtml,5000),tags:clean((p.tags||[]).join(', '),400),handle:clean(p.handle,180),
    image_url:photoUrl(v.image?.url||p.featuredImage?.url),available:v.availableForSale!==false,
    options:JSON.stringify((v.selectedOptions||[]).map(o=>({name:o.name,value:o.value}))).slice(0,1600)});
  }
 }
 return rows;
}
async function safeJson(url,options={},limit=12000000){
 const r=await fetch(url,{...options,signal:AbortSignal.timeout(25000),redirect:'error',headers:{Accept:'application/json',...options.headers}});
 if(!r.ok){const error=Error('Shopify returned HTTP '+r.status+'. Check connectivity and catalogue API permissions.');error.httpStatus=r.status;throw error;}
 const len=Number(r.headers.get('content-length')||0);if(len>limit)throw Error('Shopify response exceeds safety limit.');
 const text=await r.text();if(text.length>limit)throw Error('Shopify response too large.');
 try{return JSON.parse(text);}catch{throw Error('Shopify did not return JSON; use Admin API credentials if public catalogue access is blocked.');}
}
async function fetchPublic(){
 const rows=[];let pages=0;
 for(let page=1;page<=40;page++){
  const data=await safeJson(`${BASE}/products.json?limit=250&page=${page}`);
  if(!Array.isArray(data.products))throw Error('Shopify public product feed not available. Configure Admin API read_products access instead.');
  rows.push(...publicRows(data.products));pages++;
  if(data.products.length===0){if(!rows.length)throw Error('The website catalogue returned zero products. Check Shopify access.');return {rows,pages:pages-1,source:'Public storefront catalogue',warning:'Product availability is not physical store stock. Inventory quantities are NOT imported.'};}
 }
 throw Error('Catalogue exceeds 40 pages; stopped to avoid a partial import. Contact developer for pagination extension.');
}
async function fetchAdmin(){
 if(!/^[a-z0-9][a-z0-9.-]*\.myshopify\.com$/i.test(SHOP))throw Error('Set SHOPIFY_STORE_DOMAIN to the official *.myshopify.com address.');
 const rows=[];let cursor=null,pages=0;
 const query=`query Catalogue($cursor:String){products(first:100,after:$cursor,query:"status:active") {pageInfo {hasNextPage endCursor} nodes {id title handle vendor productType tags descriptionHtml featuredImage {url} variants(first:100){pageInfo{hasNextPage} nodes{id title sku barcode price compareAtPrice availableForSale image{url} selectedOptions{name value}}}}}}`;
 do{
  const apiUrl=`https://${SHOP}/admin/api/2026-10/graphql.json`;
  const body=JSON.stringify({query,variables:{cursor}});
  const load=async()=>safeJson(apiUrl,{method:'POST',headers:{'X-Shopify-Access-Token':await auth.accessToken(),'Content-Type':'application/json'},body});
  let data;
  try{data=await load();}catch(e){
   if(e.httpStatus===401&&auth.isAutomatic){auth.invalidate();data=await load();}
   else throw e;
  }
  if(data.errors?.length||data.data?.products===undefined)throw Error('Shopify GraphQL error: '+clean(data.errors?.[0]?.message||'Missing products',200));
  for(const p of data.data.products.nodes){if(p.variants?.pageInfo?.hasNextPage)throw Error(`Product ${p.title} has >100 variants; import paused rather than silently omit variants.`);}
  rows.push(...adminRows(data.data.products.nodes));pages++;
  const info=data.data.products.pageInfo;cursor=info.hasNextPage?info.endCursor:null;
  if(pages>=100&&cursor)throw Error('Shopify has >100 catalogue pages; stop to avoid incomplete import.');
 }while(cursor);
 return {rows,pages,source:'Shopify Admin API',warning:'Retail stock is unchanged; this import does not replace Shopify inventory reconciliation.'};
}
function install(db){
 const columns=new Set(db.prepare('PRAGMA table_info(products)').all().map(x=>x.name));
 const fields=[['shopify_variant_id','TEXT'],['shopify_product_id','TEXT'],['shopify_handle','TEXT'],['shopify_description','TEXT'],['shopify_tags','TEXT'],['shopify_options','TEXT'],['shopify_image_url','TEXT'],['shopify_compare_paisa','INTEGER'],['shopify_available','INTEGER'],['shopify_last_sync','TEXT']];
 for(const [key,type] of fields)if(!columns.has(key))db.exec(`ALTER TABLE products ADD COLUMN ${key} ${type}`);
 db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_shopify_variant_id ON products(shopify_variant_id) WHERE shopify_variant_id IS NOT NULL;
 CREATE TABLE IF NOT EXISTS catalogue_sync_runs(id INTEGER PRIMARY KEY,source TEXT NOT NULL,products_seen INTEGER NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL,skipped INTEGER NOT NULL,warnings TEXT NOT NULL DEFAULT '',run_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
}
function importRows(db,rows,userId,{dryRun=false}={}){
 if(!Array.isArray(rows)||rows.length>30000)throw Error('Too many product variants.');
 const unique=new Map();for(const row of rows){if(!row.external_id||!Number.isSafeInteger(row.price_paisa)||row.price_paisa<0)throw Error('Invalid Shopify row.');unique.set(String(row.external_id),row);}
 const deduped=[...unique.values()];
 if(dryRun){let existing=0;for(const row of deduped)if(db.prepare('SELECT id FROM products WHERE shopify_variant_id=?').get(row.external_id))existing++;return {variants:deduped.length,existing,new:deduped.length-existing,examples:deduped.slice(0,12).map(x=>({name:x.name,sku:x.sku,variant:x.variant,price_paisa:x.price_paisa,compare_paisa:x.compare_paisa}))};}
 const insert=db.prepare(`INSERT INTO products(sku,barcode,name,brand,category,variant,cost_paisa,price_paisa,sale_price_paisa,threshold,shopify_variant_id,shopify_product_id,shopify_handle,shopify_description,shopify_tags,shopify_options,shopify_image_url,shopify_compare_paisa,shopify_available,shopify_last_sync)
 VALUES(?,?,?,?,?,?,0,?,?,5,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`);
 const update=db.prepare(`UPDATE products SET sku=?,barcode=?,name=?,brand=?,category=?,variant=?,price_paisa=?,sale_price_paisa=?,shopify_product_id=?,shopify_handle=?,shopify_description=?,shopify_tags=?,shopify_options=?,shopify_image_url=?,shopify_compare_paisa=?,shopify_available=?,shopify_variant_id=?,shopify_last_sync=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`);
 const stats={created:0,updated:0,skipped:0,priceChanges:0,stockUntouched:true};
 db.exec('BEGIN IMMEDIATE');
 try{
  for(const row of deduped){
   // Keep Shopify SKU recognizable, but never hijack a local/manual product's SKU or barcode.
   const existing=db.prepare('SELECT id,sku,barcode,price_paisa,sale_price_paisa FROM products WHERE shopify_variant_id=?').get(row.external_id) ||
      // Match a prior Shopify CSV import when the real Admin API variant ID becomes available.
      (row.handle?db.prepare("SELECT id,sku,barcode,price_paisa,sale_price_paisa FROM products WHERE shopify_handle=? AND shopify_options=? AND shopify_variant_id LIKE 'CSV-%' LIMIT 1").get(row.handle,row.options):null);
   const compareValid=row.compare_paisa!==null && row.compare_paisa>row.price_paisa;
   const retail=compareValid?row.compare_paisa:row.price_paisa;
   const sale=compareValid?row.price_paisa:null;
   if(existing){
    const nextSku=row.sku && !db.prepare('SELECT id FROM products WHERE sku=? AND id!=?').get(row.sku,existing.id)?row.sku:existing.sku;
    const nextBarcode=row.barcode && !db.prepare('SELECT id FROM products WHERE barcode=? AND id!=?').get(row.barcode,existing.id)?row.barcode:existing.barcode;
    update.run(nextSku,nextBarcode,row.name,row.brand,row.category,row.variant,retail,sale,row.shopify_product_id,row.handle,row.description,row.tags,row.options,row.image_url,row.compare_paisa,row.available?1:0,row.external_id,existing.id);
    if(existing.price_paisa!==retail || existing.sale_price_paisa!==sale){db.prepare('INSERT INTO price_history(product_id,old_price_paisa,new_price_paisa,user_id) VALUES(?,?,?,?)').run(existing.id,existing.sale_price_paisa??existing.price_paisa,sale??retail,userId);stats.priceChanges++;}
    stats.updated++;continue;
   }
   let sku=row.sku||`SHOPIFY-${row.external_id}`;
   if(sku.length>45)sku='SHOPIFY-'+row.external_id;
   if(db.prepare('SELECT id FROM products WHERE sku=?').get(sku))sku='SHOPIFY-'+row.external_id;
   const barcode=row.barcode&&!db.prepare('SELECT id FROM products WHERE barcode=?').get(row.barcode)?row.barcode:null;
   const id=Number(insert.run(sku,barcode,row.name,row.brand,row.category,row.variant,retail,sale,row.external_id,row.shopify_product_id,row.handle,row.description,row.tags,row.options,row.image_url,row.compare_paisa,row.available?1:0).lastInsertRowid);
   db.prepare('INSERT INTO stock(product_id,location_id,qty) VALUES(?,1,0),(?,2,0)').run(id,id);
   db.prepare('INSERT INTO price_history(product_id,old_price_paisa,new_price_paisa,user_id) VALUES(?,NULL,?,?)').run(id,retail,userId);
   stats.created++;
  }
  db.prepare('INSERT INTO audit_logs(user_id,action,target,reason) VALUES(?,?,?,?)').run(userId,'SHOPIFY_CATALOGUE_IMPORT','products',`${stats.created} created, ${stats.updated} updated, 0 stock changes`);
  db.exec('COMMIT');return stats;
 }catch(e){db.exec('ROLLBACK');throw e;}
}
async function cacheImages(db,{limit=80}={}){
 const candidates=db.prepare("SELECT id,shopify_variant_id,shopify_image_url FROM products WHERE shopify_variant_id IS NOT NULL AND shopify_image_url IS NOT NULL AND shopify_image_url!='' AND (image_path IS NULL OR image_path='') ORDER BY id LIMIT ?").all(Math.min(80,Math.max(1,Number(limit)||80)));
 const directory=path.join(__dirname,'public','uploads','shopify');fs.mkdirSync(directory,{recursive:true});
 let cached=0,failed=0;
 async function download(row){
  try{
   const src=photoUrl(row.shopify_image_url);if(!src)throw Error('Untrusted image domain');
   const r=await fetch(src,{signal:AbortSignal.timeout(13000),redirect:'error'});if(!r.ok)throw Error('HTTP '+r.status);
   if(Number(r.headers.get('content-length')||0)>2000000)throw Error('Image too large');
   const contentType=(r.headers.get('content-type')||'').toLowerCase();
   const ext=contentType.includes('jpeg')?'jpg':contentType.includes('png')?'png':contentType.includes('webp')?'webp':null;
   if(!ext)throw Error('Unsupported image format');
   const arr=Buffer.from(await r.arrayBuffer());if(!arr.length||arr.length>2000000)throw Error('Image file too big');
   const id=String(row.shopify_variant_id).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,64);if(!id)throw Error('Invalid variant');
   const filename=`${id}.${ext}`;
   fs.writeFileSync(path.join(directory,filename),arr,{flag:'w'});
   db.prepare("UPDATE products SET image_path=? WHERE id=? AND (image_path IS NULL OR image_path='')").run('/uploads/shopify/'+filename,row.id);
   cached++;
  }catch{failed++;}
 }
 for(let i=0;i<candidates.length;i+=6)await Promise.all(candidates.slice(i,i+6).map(download));
 const remaining=db.prepare("SELECT COUNT(*) n FROM products WHERE shopify_variant_id IS NOT NULL AND shopify_image_url IS NOT NULL AND shopify_image_url!='' AND (image_path IS NULL OR image_path='')").get().n;
 return {cached,failed,remaining};
}
function create(db){
 return async function handle(req,url,user){
  if(!['/api/catalog/status','/api/catalog/preview','/api/catalog/import','/api/catalog/cache-images','/api/catalog/csv-preview','/api/catalog/csv-import'].includes(url.pathname))return null;
  if(!['admin','manager'].includes(user.role))return {status:403,body:{error:'Catalogue synchronization requires admin or manager role.'}};
  if(req.method==='GET'&&url.pathname==='/api/catalog/status'){
   const last=db.prepare('SELECT * FROM catalogue_sync_runs ORDER BY id DESC LIMIT 1').get()||null;
   const count=db.prepare('SELECT COUNT(*) n FROM products WHERE shopify_variant_id IS NOT NULL').get().n;
   const cachedImages=db.prepare("SELECT COUNT(*) n FROM products WHERE shopify_variant_id IS NOT NULL AND image_path IS NOT NULL AND image_path!=''").get().n;
   const uncachedImages=db.prepare("SELECT COUNT(*) n FROM products WHERE shopify_variant_id IS NOT NULL AND shopify_image_url IS NOT NULL AND shopify_image_url!='' AND (image_path IS NULL OR image_path='')").get().n;
   return {status:200,body:{last,shopifyVariants:count,cachedImages,uncachedImages,canAdmin:auth.ready,adminAuthMode:auth.isAutomatic?'client-credentials':ADMIN_TOKEN?'legacy-token':'public-only',website:BASE}};
  }
  if(req.method!=='POST')return {status:405,body:{error:'Method not allowed.'}};
  if(url.pathname==='/api/catalog/cache-images'){if(user.role!=='admin')return {status:403,body:{error:'Administrator only.'}};return {status:200,body:await cacheImages(db)};}
  if(url.pathname==='/api/catalog/csv-preview'||url.pathname==='/api/catalog/csv-import'){
   if(url.pathname.endsWith('import')&&user.role!=='admin')return {status:403,body:{error:'Only administrator can import products.'}};
   try{
    const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>20_000_000)throw Error('Upload exceeds 20 MB request limit.');chunks.push(chunk);}
    const csv=JSON.parse(Buffer.concat(chunks).toString('utf8')).csv;const parsed=csvModule.parseShopifyProductsCsv(csv);
    if(url.pathname.endsWith('preview'))return {status:200,body:{source:'Shopify Products CSV export',warnings:parsed.warnings,productsFound:parsed.productsFound,unpublished:parsed.unpublished,preview:importRows(db,parsed.rows,user.id,{dryRun:true})}};
    const stats=importRows(db,parsed.rows,user.id);
    db.prepare('INSERT INTO catalogue_sync_runs(source,products_seen,created,updated,skipped,warnings) VALUES(?,?,?,?,?,?)').run('Shopify Products CSV export',parsed.rows.length,stats.created,stats.updated,stats.skipped,parsed.warnings);
    return {status:200,body:{...stats,source:'Shopify Products CSV export',variants:parsed.rows.length,productsFound:parsed.productsFound,warnings:parsed.warnings}};
   }catch(e){return {status:400,body:{error:'Shopify CSV error: '+String(e.message||e).slice(0,280)}};}
  }
  let result;try{result=auth.ready?await fetchAdmin():await fetchPublic();}catch(e){return {status:502,body:{error:'Website catalogue unavailable: '+String(e.message||'Connection failed').slice(0,250)}};}
  if(url.pathname==='/api/catalog/preview')return {status:200,body:{source:result.source,pages:result.pages,warning:result.warning,preview:importRows(db,result.rows,user.id,{dryRun:true})}};
  if(user.role!=='admin')return {status:403,body:{error:'Only administrator can execute a catalogue import.'}};
  const stats=importRows(db,result.rows,user.id);
  db.prepare('INSERT INTO catalogue_sync_runs(source,products_seen,created,updated,skipped,warnings) VALUES(?,?,?,?,?,?)').run(result.source,result.rows.length,stats.created,stats.updated,stats.skipped,result.warning);
  return {status:200,body:{...stats,source:result.source,pages:result.pages,variants:result.rows.length,warning:result.warning}};
 }
}
module.exports={install,create,publicRows,adminRows,importRows,cents,photoUrl,cacheImages};
