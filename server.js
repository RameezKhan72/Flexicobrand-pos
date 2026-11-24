'use strict';
// Flexico POS Professional: local-first testing server. Node 22.13+ only; no npm packages.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const PORT = Number(process.env.PORT || 3147);
const HOST = process.env.HOST || '127.0.0.1';
// Additional hostnames must be explicitly configured before LAN / HTTPS proxy use.
// Leave this unset for the safer localhost-only default.
const ALLOWED_HOSTS = new Set([
 `localhost:${PORT}`, `127.0.0.1:${PORT}`,
 ...(process.env.FLEXICO_ALLOWED_HOSTS||'').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean)
]);
const ALLOWED_ORIGINS = new Set([
 `http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`,
 ...(process.env.FLEXICO_ALLOWED_ORIGINS||'').split(',').map(v=>v.trim()).filter(Boolean)
]);
const SECURE_COOKIE=process.env.FLEXICO_PUBLIC_HTTPS==='true';

const DB_PATH = process.env.FLEXICO_DB || path.join(__dirname, 'data', 'flexico.sqlite');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');

db.exec(`
 CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','manager','cashier','warehouse','support')),
  is_active INTEGER NOT NULL DEFAULT 1, failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 );
 CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL
 );
 CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS locations (id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY, sku TEXT NOT NULL UNIQUE, barcode TEXT UNIQUE, name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '', variant TEXT NOT NULL DEFAULT '',
  cost_paisa INTEGER NOT NULL DEFAULT 0 CHECK(cost_paisa>=0),
  price_paisa INTEGER NOT NULL CHECK(price_paisa>=0), sale_price_paisa INTEGER CHECK(sale_price_paisa>=0),
  threshold INTEGER NOT NULL DEFAULT 5, is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 );
 CREATE TABLE IF NOT EXISTS stock (
  product_id INTEGER NOT NULL REFERENCES products(id), location_id INTEGER NOT NULL REFERENCES locations(id),
  qty INTEGER NOT NULL DEFAULT 0 CHECK(qty>=0), PRIMARY KEY(product_id, location_id)
 );
 CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT UNIQUE, email TEXT, city TEXT, address TEXT,
  notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 );
 CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY, receipt_no TEXT UNIQUE, client_request_id TEXT UNIQUE NOT NULL,
  sale_type TEXT NOT NULL, customer_id INTEGER REFERENCES customers(id),
  subtotal_paisa INTEGER NOT NULL, discount_paisa INTEGER NOT NULL, tax_paisa INTEGER NOT NULL,
  total_paisa INTEGER NOT NULL, paid_paisa INTEGER NOT NULL, due_paisa INTEGER NOT NULL,
  status TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
  user_id INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 );
 CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL REFERENCES sales(id),
  product_id INTEGER NOT NULL REFERENCES products(id), sku TEXT NOT NULL, name TEXT NOT NULL,
  qty INTEGER NOT NULL, unit_price_paisa INTEGER NOT NULL, cost_paisa INTEGER NOT NULL,
  line_total_paisa INTEGER NOT NULL
 );
 CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL REFERENCES sales(id),
  method TEXT NOT NULL, amount_paisa INTEGER NOT NULL,
  reference TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 );
 CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id),
  location_id INTEGER NOT NULL REFERENCES locations(id), delta INTEGER NOT NULL,
  kind TEXT NOT NULL, reason TEXT NOT NULL, sale_id INTEGER REFERENCES sales(id),
  user_id INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 );
 CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id),
  old_price_paisa INTEGER, new_price_paisa INTEGER NOT NULL, user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 );
 CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), action TEXT NOT NULL,
  target TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 );
 CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at);
 CREATE INDEX IF NOT EXISTS idx_items_sale ON sale_items(sale_id);
 CREATE INDEX IF NOT EXISTS idx_stock_movement_created ON stock_movements(created_at);
`);
// v0.3 migration: record cash handed to cashier separately from net cash retained.
// Old paid_paisa and payment amount_paisa remain NET figures for reports and shifts.
for (const [table,column,ddl] of [
 ['sales','tendered_paisa','ALTER TABLE sales ADD COLUMN tendered_paisa INTEGER NOT NULL DEFAULT 0'],
 ['sales','change_paisa','ALTER TABLE sales ADD COLUMN change_paisa INTEGER NOT NULL DEFAULT 0'],
 ['payments','tendered_paisa','ALTER TABLE payments ADD COLUMN tendered_paisa INTEGER NOT NULL DEFAULT 0']
]) {
 if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name===column)) db.exec(ddl);
}
db.exec('UPDATE sales SET tendered_paisa=paid_paisa WHERE tendered_paisa=0 AND paid_paisa>0');
db.exec('UPDATE payments SET tendered_paisa=amount_paisa WHERE tendered_paisa=0 AND amount_paisa>0');
const settingDefaults = {
 store_name: 'FLEXICO', address: 'Office No. 4, 3rd Floor, Gulberg Trade Center, Gulberg Greens, Islamabad', phone: '0315-9517966',
 website: 'https://www.flexicowatches.com', email: 'support@flexicowatches.com',
 tax_rate_percent: '0', cashier_discount_percent: '10', receipt_prefix: 'FX',
 store_location_id: '1', currency: 'PKR', customer_credit_enabled:'false', receipt_footer: 'Thank you for shopping with Flexico!'
};
for (const [k, v] of Object.entries(settingDefaults)) db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)').run(k,v);
db.prepare("INSERT OR IGNORE INTO locations(id,code,name) VALUES(1,'STORE','Main store')").run();
db.prepare("INSERT OR IGNORE INTO locations(id,code,name) VALUES(2,'WAREHOUSE','Warehouse')").run();
db.exec(`CREATE TABLE IF NOT EXISTS receivable_collections(
 collection_id TEXT PRIMARY KEY, sale_id INTEGER NOT NULL REFERENCES sales(id),
 amount_paisa INTEGER NOT NULL CHECK(amount_paisa>0),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);`);
const proModule=require('./pro-server');
const hybridModule=require('./hybrid-sync');
const catalogueModule=require('./shopify-catalog');
proModule.install(db);
catalogueModule.install(db);
// v1 migration: attribute each payment to the shift in which CASH was actually received,
// rather than retroactively adding later customer collections to the sale's original shift.
if(!db.prepare('PRAGMA table_info(payments)').all().some(c=>c.name==='shift_id')){
 db.exec('ALTER TABLE payments ADD COLUMN shift_id INTEGER REFERENCES shifts(id)');
 db.exec(`UPDATE payments SET shift_id=(SELECT sh.id FROM shifts sh
  WHERE sh.user_id=(SELECT user_id FROM sales WHERE id=payments.sale_id)
  AND payments.created_at>=sh.opened_at AND payments.created_at<=COALESCE(sh.closed_at,CURRENT_TIMESTAMP)
  ORDER BY sh.id DESC LIMIT 1) WHERE shift_id IS NULL`);
}

function getSettings() {return Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(r=>[r.key,r.value]));}
function money(input, field='amount') {
 const s = String(input ?? '').trim();
 if (!/^\d+(\.\d{1,2})?$/.test(s)) throw bad(`${field} must be a non-negative PKR amount (up to 2 decimals).`);
 const [whole, frac=''] = s.split('.');
 const n = Number(whole)*100+Number(frac.padEnd(2,'0'));
 if (!Number.isSafeInteger(n) || n > 1_000_000_000_00) throw bad(`${field} is too large.`);
 return n;
}
function requiredString(v,label,max=160){
 if(typeof v!=='string' || !v.trim()) throw bad(`${label} is required.`);
 if(v.trim().length>max) throw bad(`${label} is too long.`);
 return v.trim();
}
function optString(v,max=200){return String(v ?? '').trim().slice(0,max);}
function bad(message,status=400){const e=new Error(message);e.status=status;return e;}
function nowIslamabadDate(date = new Date()) {return new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
function hashPassword(password){ const salt=crypto.randomBytes(16).toString('hex'); const digest=crypto.scryptSync(password,salt,64).toString('hex');return `scrypt:${salt}:${digest}`;}
function verifyPassword(password,encoded){
 const [type,salt,digest] = encoded.split(':'); if(type!=='scrypt')return false;
 const a=Buffer.from(digest,'hex'); const b=crypto.scryptSync(password,salt,64);
 return a.length===b.length && crypto.timingSafeEqual(a,b);
}
function audit(userId,action,target,reason=''){db.prepare('INSERT INTO audit_logs(user_id,action,target,reason) VALUES (?,?,?,?)').run(userId,action,target,reason);}
function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const v=fn(); db.exec('COMMIT');return v;}catch(err){db.exec('ROLLBACK');throw err;}}
function getUser(req) {
 const token=/(?:^|;\s*)flexico_session=([^;]+)/.exec(req.headers.cookie||'')?.[1];
 if(!token) return null;
 const hashed=crypto.createHash('sha256').update(token).digest('hex');
 const record=db.prepare(`SELECT u.id,u.username,u.role,u.is_active FROM sessions s
 JOIN users u ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?`).get(hashed,Date.now());
 return record&&record.is_active?record:null;
}
function requireRole(user,roles){if(!user)throw bad('Please log in first.',401);if(roles&&!roles.includes(user.role))throw bad('You do not have permission for this action.',403);}
function createSession(user, res) {
 const token=crypto.randomBytes(32).toString('hex');
 db.prepare('INSERT INTO sessions(user_id,token_hash,expires_at) VALUES(?,?,?)').run(user.id,crypto.createHash('sha256').update(token).digest('hex'),Date.now()+10*60*60*1000);
 res.setHeader('Set-Cookie',`flexico_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=36000${SECURE_COOKIE?'; Secure':''}`);
}
function respond(res,status,body){
 res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://cdn.shopify.com https://*.shopifycdn.net https://flexicowatches.com; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});
 res.end(JSON.stringify(body));
}
function parseBody(req){return new Promise((resolve,reject)=>{
 let text='';req.on('data',c=>{text+=c;if(text.length>1_000_000){reject(bad('Request body too large.',413));req.destroy();}});
 req.on('end',()=>{try{resolve(text?JSON.parse(text):{});}catch{reject(bad('Invalid JSON body.'));}});req.on('error',reject);
 });}
function productView(p){return {...p,image_path:p.image_path||p.shopify_image_url||'',price: (p.price_paisa/100).toFixed(2),cost:(p.cost_paisa/100).toFixed(2),
  sale_price:p.sale_price_paisa===null?null:(p.sale_price_paisa/100).toFixed(2),
  effective_price:((p.sale_price_paisa??p.price_paisa)/100).toFixed(2)};}
function productList(search='', includeArchived=false){
 const keyword=`%${search.trim()}%`;
 const filter=includeArchived?'':'AND p.is_active=1';
 return db.prepare(`SELECT p.*, COALESCE(SUM(CASE WHEN s.location_id=1 THEN s.qty ELSE 0 END),0) AS store_qty,
 COALESCE(SUM(CASE WHEN s.location_id=2 THEN s.qty ELSE 0 END),0) AS warehouse_qty
 FROM products p LEFT JOIN stock s ON s.product_id=p.id WHERE (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR p.brand LIKE ?) ${filter}
 GROUP BY p.id ORDER BY p.is_active DESC,p.name ASC LIMIT 10000`).all(keyword,keyword,keyword,keyword).map(productView);
}
function validateProduct(b,old=null){
 const sku=requiredString(b.sku,'SKU',45).toUpperCase();
 const name=requiredString(b.name,'Product name',180);
 const barcode=optString(b.barcode,80)||null;
 const cost=money(b.cost??'0','Cost');const price=money(b.price,'Retail price');
 const sale=(b.sale_price===null || b.sale_price===undefined || String(b.sale_price).trim()==='')?null:money(b.sale_price,'Sale price');
 const threshold=Number(b.threshold??5);
 if(!Number.isInteger(threshold)||threshold<0||threshold>100000) throw bad('Invalid low-stock threshold.');
 if(sale!==null&&sale>price)throw bad('Sale price cannot exceed retail price.');
 const warrantyMonths=Number(b.warranty_months??old?.warranty_months??12);
 if(!Number.isInteger(warrantyMonths)||warrantyMonths<0||warrantyMonths>120)throw bad('Warranty must be 0–120 months.');
 return {sku,name,barcode,brand:optString(b.brand,80),category:optString(b.category,80),variant:optString(b.variant,80),
  cost,price,sale,threshold,warrantyMonths};
}
function getSale(id){
 const sale=db.prepare(`SELECT s.*,u.username AS cashier,c.name AS customer_name,c.phone AS customer_phone
 FROM sales s LEFT JOIN users u ON u.id=s.user_id LEFT JOIN customers c ON c.id=s.customer_id WHERE s.id=?`).get(id);
 if(!sale)throw bad('Sale not found.',404);
 return {...sale,items:db.prepare('SELECT * FROM sale_items WHERE sale_id=? ORDER BY id').all(id),
  payments:db.prepare('SELECT * FROM payments WHERE sale_id=? ORDER BY id').all(id),
  warranties:db.prepare('SELECT w.* FROM warranties w JOIN sale_items si ON si.id=w.sale_item_id WHERE si.sale_id=?').all(id),settings:getSettings()};
}
const hybrid=hybridModule.install(db,getSale);
const catalogue=catalogueModule.create(db);
function guardDate(s){if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number.isNaN(Date.parse(s+'T00:00:00Z')))throw bad('Date must be YYYY-MM-DD.');return s;}
function report(from,to){
 const start=guardDate(from), end=guardDate(to);if(start>end)throw bad('Start date cannot be after end date.');
 if((Date.parse(end)-Date.parse(start))/86400000>365)throw bad('Choose a period under 366 days.');
 const bounds=[start,end];
 const stats=db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(total_paisa),0) AS revenue,
 COALESCE(SUM(paid_paisa),0) AS collected,COALESCE(SUM(due_paisa),0) AS due,
 COALESCE(SUM(discount_paisa),0) AS discount,COALESCE(SUM(tax_paisa),0) AS tax
 FROM sales WHERE date(created_at,'+5 hours') BETWEEN ? AND ?`).get(...bounds);
 const cost=db.prepare(`SELECT COALESCE(SUM(si.cost_paisa*si.qty),0) AS total_cost
 FROM sale_items si JOIN sales s ON si.sale_id=s.id WHERE date(s.created_at,'+5 hours') BETWEEN ? AND ?`).get(...bounds).total_cost;
 const days=db.prepare(`SELECT date(created_at,'+5 hours') AS date,COUNT(*) AS orders,
 SUM(total_paisa) AS sales, SUM(paid_paisa) AS collected FROM sales
 WHERE date(created_at,'+5 hours') BETWEEN ? AND ? GROUP BY date(created_at,'+5 hours') ORDER BY date DESC`).all(...bounds);
 const top=db.prepare(`SELECT si.sku,si.name,SUM(si.qty) AS qty,SUM(si.line_total_paisa) AS sales
 FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE date(s.created_at,'+5 hours') BETWEEN ? AND ?
 GROUP BY si.product_id ORDER BY qty DESC LIMIT 7`).all(...bounds);
 const methods=db.prepare(`SELECT p.method,SUM(p.amount_paisa) AS amount, COUNT(*) AS count FROM payments p
 JOIN sales s ON p.sale_id=s.id WHERE date(s.created_at,'+5 hours') BETWEEN ? AND ? GROUP BY p.method ORDER BY amount DESC`).all(...bounds);
 const returns=db.prepare("SELECT COALESCE(SUM(refund_paisa),0) a,COUNT(*) n FROM returns WHERE date(created_at,'+5 hours') BETWEEN ? AND ?").get(...bounds);
 const pendingCod=db.prepare("SELECT COUNT(*) n,COALESCE(SUM(due_paisa),0) outstanding FROM sales WHERE due_paisa>0 AND sale_type='delivery_cod'").get();
 return {from:start,to:end,...stats,cost,returns_paisa:returns.a,return_count:returns.n,net_revenue:stats.revenue-returns.a,estimated_profit:stats.revenue-stats.tax-cost-returns.a, pending_cod:pendingCod,days,top,methods};
}
function seedDemo(userId){
 const samples=[
  ['FX-ZEN-001','Flexico Zenior Classic','Flexico','Quartz','Black Dial','8900','13999',14,6,'FLEX10001'],
  ['FX-EXE-002','Flexico Executive Steel','Flexico','Executive','Silver','17900','28999',8,4,'FLEX10002'],
  ['FX-AUR-003','Flexico Aurora Rose','Flexico','Women','Rose Gold','7200','11999',12,5,'FLEX10003'],
  ['FX-AUT-004','Flexico Automatic Noir','Flexico','Automatic','Black','22500','36999',5,3,'FLEX10004'],
  ['FX-GFT-005','Flexico Premium Gift Box','Flexico','Accessories','Black','900','2499',25,10,'FLEX10005'],
  ['FX-QTZ-006','Flexico Quartz Silver','Flexico','Quartz','Silver Dial','6100','9999',20,7,'FLEX10006']
 ];
 for(const [sku,name,brand,category,variant,cost,price,storeQty,warehouseQty,barcode] of samples){
  const exists=db.prepare('SELECT id FROM products WHERE sku=?').get(sku);if(exists)continue;
  const productId=Number(db.prepare(`INSERT INTO products(sku,barcode,name,brand,category,variant,cost_paisa,price_paisa,threshold)
   VALUES(?,?,?,?,?,?,?,?,5)`).run(sku,barcode,name,brand,category,variant,money(cost),money(price)).lastInsertRowid);
  for(const [locationId,qty] of [[1,storeQty],[2,warehouseQty]]){
   db.prepare('INSERT INTO stock(product_id,location_id,qty) VALUES(?,?,?)').run(productId,locationId,qty);
   db.prepare('INSERT INTO stock_movements(product_id,location_id,delta,kind,reason,user_id) VALUES(?,?,?,?,?,?)').run(productId,locationId,qty,'DEMO_SEED','Demo inventory',userId);
  }
 }
 db.prepare("UPDATE products SET warranty_months=0 WHERE sku='FX-GFT-005'").run();
 audit(userId,'SEED_DEMO','products','Generated sample catalogue for testing');
}

const pro=proModule.create(db,transaction,audit,bad,money,requiredString,optString,requireRole,parseBody,nowIslamabadDate);

async function api(req,res,url){
 const method=req.method;const pathname=url.pathname;
 if(method==='GET'&&pathname==='/api/bootstrap') return respond(res,200,{setupRequired:db.prepare('SELECT COUNT(*) AS n FROM users').get().n===0});
 if(method==='POST'&&pathname==='/api/setup'){
  const b=await parseBody(req);
  const result=transaction(()=>{
   if(db.prepare('SELECT COUNT(*) AS n FROM users').get().n!==0)throw bad('Setup has already been completed.',403);
   const username=requiredString(b.username,'Username',40);
   const password=requiredString(b.password,'Password',128);
   if(password.length<10)throw bad('Admin password must have at least 10 characters.');
   const uid=Number(db.prepare("INSERT INTO users(username,password_hash,role) VALUES(?,?,'admin')").run(username,hashPassword(password)).lastInsertRowid);
   if(b.store_name)db.prepare("UPDATE settings SET value=? WHERE key='store_name'").run(requiredString(b.store_name,'Store name',80));
   if(b.demo===true)seedDemo(uid);
   audit(uid,'FIRST_SETUP','system','Local POS initialized');
   return db.prepare('SELECT id,username,role FROM users WHERE id=?').get(uid);
  });
  createSession(result,res);return respond(res,201,{user:result,settings:getSettings()});
 }
 if(method==='POST'&&pathname==='/api/login'){
  const b=await parseBody(req);const username=optString(b.username,40),password=String(b.password||'');
  const u=db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if(!u||!u.is_active)throw bad('Invalid username or password.',401);
  if(u.locked_until>Date.now())throw bad('Account temporarily locked after repeated failed logins. Try again later.',429);
  if(!verifyPassword(password,u.password_hash)){
   const attempts=u.failed_attempts+1;
   db.prepare('UPDATE users SET failed_attempts=?,locked_until=? WHERE id=?').run(attempts>=5?0:attempts,attempts>=5?Date.now()+15*60*1000:0,u.id);
   throw bad('Invalid username or password.',401);
  }
  db.prepare('UPDATE users SET failed_attempts=0,locked_until=0 WHERE id=?').run(u.id);
  createSession(u,res);return respond(res,200,{user:{id:u.id,username:u.username,role:u.role},settings:getSettings()});
 }
 const user=getUser(req); requireRole(user);
 const catalogResponse=await catalogue(req,url,user);if(catalogResponse)return respond(res,catalogResponse.status,catalogResponse.body);
 const enhanced=await pro.route(req,url,user);if(enhanced)return respond(res,enhanced.status,enhanced.body);
 if(method==='GET'&&pathname==='/api/sync/status'){requireRole(user,['admin','manager']);return respond(res,200,hybrid.status());}
 if(method==='POST'&&pathname==='/api/sync/now'){requireRole(user,['admin']);return respond(res,200,await hybrid.syncOnce({force:true}));}
 if(method==='GET'&&pathname==='/api/me')return respond(res,200,{user,settings:getSettings()});
 if(method==='POST'&&pathname==='/api/logout'){
  const token=/(?:^|;\s*)flexico_session=([^;]+)/.exec(req.headers.cookie||'')?.[1];
  if(token)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(crypto.createHash('sha256').update(token).digest('hex'));
  res.setHeader('Set-Cookie',`flexico_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${SECURE_COOKIE?'; Secure':''}`);return respond(res,200,{ok:true});
 }
 if(method==='GET'&&pathname==='/api/products')return respond(res,200,{products:productList(url.searchParams.get('search')||'',user.role==='admin'&&url.searchParams.get('includeArchived')==='true')});
 if(method==='POST'&&pathname==='/api/products'){
  requireRole(user,['admin','manager']);const b=await parseBody(req),p=validateProduct(b);
  const id=transaction(()=>{
   const result=db.prepare(`INSERT INTO products(sku,barcode,name,brand,category,variant,cost_paisa,price_paisa,sale_price_paisa,threshold,warranty_months)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(p.sku,p.barcode,p.name,p.brand,p.category,p.variant,p.cost,p.price,p.sale,p.threshold,p.warrantyMonths);
   const id=Number(result.lastInsertRowid);
   db.prepare('INSERT INTO price_history(product_id,old_price_paisa,new_price_paisa,user_id) VALUES(?,NULL,?,?)').run(id,p.price,user.id);
   audit(user.id,'CREATE_PRODUCT',`product:${id}`,p.sku);return id;
  });return respond(res,201,{id,ok:true});
 }
 const pMatch=/^\/api\/products\/(\d+)$/.exec(pathname);
 if(method==='PATCH'&&pMatch){
  requireRole(user,['admin','manager']);const id=Number(pMatch[1]),b=await parseBody(req);
  transaction(()=>{
   const old=db.prepare('SELECT * FROM products WHERE id=?').get(id);if(!old)throw bad('Product not found.',404);
   const p=validateProduct(b,old);
   db.prepare(`UPDATE products SET sku=?,barcode=?,name=?,brand=?,category=?,variant=?,cost_paisa=?,price_paisa=?,
    sale_price_paisa=?,threshold=?,warranty_months=?,is_active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(p.sku,p.barcode,p.name,p.brand,p.category,p.variant,p.cost,p.price,p.sale,p.threshold,p.warrantyMonths,b.is_active===false?0:1,id);
   if(old.price_paisa!==p.price)db.prepare('INSERT INTO price_history(product_id,old_price_paisa,new_price_paisa,user_id) VALUES(?,?,?,?)').run(id,old.price_paisa,p.price,user.id);
   audit(user.id,'EDIT_PRODUCT',`product:${id}`,'Product details changed');
  });return respond(res,200,{ok:true});
 }
 if(method==='GET'&&pathname==='/api/locations')return respond(res,200,{locations:db.prepare('SELECT * FROM locations ORDER BY id').all()});
 if(method==='POST'&&pathname==='/api/stock/adjust'){
  requireRole(user,['admin','manager']);const b=await parseBody(req),productId=Number(b.product_id),locationId=Number(b.location_id),delta=Number(b.delta),reason=requiredString(b.reason,'Reason',250);
  if(!Number.isInteger(productId)||!Number.isInteger(locationId)||!Number.isInteger(delta)||delta===0||Math.abs(delta)>100000)throw bad('Invalid stock adjustment.');
  const qty=transaction(()=>{
   if(!db.prepare('SELECT id FROM products WHERE id=?').get(productId))throw bad('Product not found.',404);
   if(!db.prepare('SELECT id FROM locations WHERE id=?').get(locationId))throw bad('Location not found.',404);
   db.prepare('INSERT OR IGNORE INTO stock(product_id,location_id,qty) VALUES(?,?,0)').run(productId,locationId);
   const old=db.prepare('SELECT qty FROM stock WHERE product_id=? AND location_id=?').get(productId,locationId).qty;
   if(old+delta<0)throw bad('Cannot reduce stock below zero.');
   db.prepare('UPDATE stock SET qty=qty+? WHERE product_id=? AND location_id=?').run(delta,productId,locationId);
   db.prepare('INSERT INTO stock_movements(product_id,location_id,delta,kind,reason,user_id) VALUES(?,?,?,?,?,?)').run(productId,locationId,delta,'MANUAL',reason,user.id);
   audit(user.id,'STOCK_ADJUST',`product:${productId}`,`${delta} @ ${locationId}; ${reason}`);return old+delta;
  });return respond(res,200,{ok:true,qty});
 }
 if(method==='POST'&&pathname==='/api/stock/transfer'){
  requireRole(user,['admin','manager']);const b=await parseBody(req),pid=Number(b.product_id),from=Number(b.from_id),to=Number(b.to_id),qty=Number(b.qty);
  if(!Number.isInteger(pid)||!Number.isInteger(from)||!Number.isInteger(to)||from===to||!Number.isInteger(qty)||qty<1||qty>100000)throw bad('Invalid stock transfer.');
  transaction(()=>{
   if(!db.prepare('SELECT id FROM products WHERE id=?').get(pid))throw bad('Product not found.',404);
   for(const id of [from,to]){if(!db.prepare('SELECT id FROM locations WHERE id=?').get(id))throw bad('Invalid location.');db.prepare('INSERT OR IGNORE INTO stock(product_id,location_id,qty) VALUES(?,?,0)').run(pid,id);}
   const available=db.prepare('SELECT qty FROM stock WHERE product_id=? AND location_id=?').get(pid,from).qty;
   if(available<qty)throw bad('Not enough stock at source location.');
   db.prepare('UPDATE stock SET qty=qty-? WHERE product_id=? AND location_id=?').run(qty,pid,from);
   db.prepare('UPDATE stock SET qty=qty+? WHERE product_id=? AND location_id=?').run(qty,pid,to);
   for(const [id,delta] of [[from,-qty],[to,qty]])db.prepare('INSERT INTO stock_movements(product_id,location_id,delta,kind,reason,user_id) VALUES(?,?,?,?,?,?)').run(pid,id,delta,'TRANSFER',`Transfer ${from} → ${to}`,user.id);
   audit(user.id,'STOCK_TRANSFER',`product:${pid}`,`${qty} units ${from}->${to}`);
  });return respond(res,200,{ok:true});
 }
 if(method==='GET'&&pathname==='/api/stock/movements'){
  requireRole(user,['admin','manager','warehouse']);
  const movements=db.prepare(`SELECT m.*,p.name,p.sku,l.name AS location,u.username FROM stock_movements m
   JOIN products p ON p.id=m.product_id JOIN locations l ON l.id=m.location_id JOIN users u ON u.id=m.user_id
   ORDER BY m.id DESC LIMIT 100`).all();return respond(res,200,{movements});
 }
 if(method==='GET'&&pathname==='/api/customers'){
  const query=`%${optString(url.searchParams.get('search'),120)}%`;
  return respond(res,200,{customers:db.prepare('SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? ORDER BY id DESC LIMIT 200').all(query,query)});
 }
 if(method==='POST'&&pathname==='/api/customers'){
  const b=await parseBody(req);const name=requiredString(b.name,'Customer name',120),phone=optString(b.phone,35)||null;
  const id=Number(db.prepare('INSERT INTO customers(name,phone,email,city,address,notes) VALUES(?,?,?,?,?,?)').run(name,phone,optString(b.email,160),optString(b.city,100),optString(b.address,250),optString(b.notes,400)).lastInsertRowid);
  audit(user.id,'CREATE_CUSTOMER',`customer:${id}`);return respond(res,201,{id,ok:true});
 }
 if(method==='POST'&&pathname==='/api/sales'){
  requireRole(user,['admin','manager','cashier']);const b=await parseBody(req);
  const reqId=requiredString(b.client_request_id,'Client request ID',100);
  const existing=db.prepare('SELECT id FROM sales WHERE client_request_id=?').get(reqId);
  if(existing)return respond(res,200,{sale:getSale(existing.id),duplicate:true});
  if(!Array.isArray(b.items)||!b.items.length||b.items.length>100)throw bad('Bill must contain 1 to 100 products.');
  const type=b.sale_type;
  if(!['in_store','whatsapp','delivery_cod','delivery_prepaid','layaway'].includes(type))throw bad('Invalid sale type.');
  if(type==='layaway'&&(getSettings().customer_credit_enabled!=='true'||!['admin','manager'].includes(user.role)))
    throw bad('Customer credit sales are disabled or require a manager.',403);
  const itemsMap=new Map();
  for(const entry of b.items){const id=Number(entry.product_id),qty=Number(entry.qty);
   if(!Number.isSafeInteger(id)||id<1||!Number.isInteger(qty)||qty<1||qty>1000)throw bad('Invalid item or quantity.');
   itemsMap.set(id,(itemsMap.get(id)||0)+qty);
  }
  const itemRows=[];let subtotal=0;
  for(const [id,qty] of itemsMap){
   const p=db.prepare('SELECT * FROM products WHERE id=? AND is_active=1').get(id);
   if(!p)throw bad(`Product ${id} is unavailable.`);
   const unit=p.sale_price_paisa??p.price_paisa;
   if(unit<=0)throw bad(`Product ${p.sku} has no valid selling price.`);
   const line=unit*qty; if(!Number.isSafeInteger(line))throw bad('Bill total too large.');
   subtotal+=line;itemRows.push({id,qty,p,unit,line});
  }
  if(subtotal>100000000000)throw bad('Bill total too large.');
  const discountType=b.discount_type==='percent'?'percent':'fixed';
  const discountInput=String(b.discount_value??'0');
  let discount=0;
  if(discountType==='percent'){
   const pct=Number(discountInput);if(!Number.isFinite(pct)||pct<0||pct>100)throw bad('Invalid discount percentage.');
   discount=Math.round(subtotal*pct/100);
  } else discount=money(discountInput,'Discount');
  if(discount>subtotal)throw bad('Discount exceeds subtotal.');
  const code=optString(b.coupon_code,40).trim().toUpperCase();
  if(code){if(discount>0)throw bad('Coupon and manual discount cannot be combined.');discount=pro.promo(code,subtotal).discount;}
  const cfg=getSettings();const cap=Number(cfg.cashier_discount_percent||'10');
  if(user.role==='cashier'&&!code&&subtotal>0&&discount/subtotal*100>cap+1e-8)throw bad(`Cashier discount limit is ${cap}%. Ask manager to use their account.`);
  const total=subtotal-discount;
  const taxPct=Number(cfg.tax_rate_percent||0), tax=Math.round(total*taxPct/(100+taxPct));
  const payInput=b.payments||[];if(!Array.isArray(payInput)||payInput.length>6)throw bad('Invalid payments.');
  let tendered=0,nonCash=0;const payments=[];
  for(const payment of payInput){
   if(!['Cash','Card','Bank Transfer','JazzCash','Easypaisa','Store Credit'].includes(payment.method))throw bad('Invalid payment method.');
   const amount=money(payment.amount,'Payment');if(amount===0)continue;
   const reference=optString(payment.reference,100);
   if(['Bank Transfer','JazzCash','Easypaisa'].includes(payment.method)&&!reference)throw bad(`${payment.method} requires a payment reference.`);
   tendered+=amount;
   if(payment.method!=='Cash')nonCash+=amount;
   if(!Number.isSafeInteger(tendered)||!Number.isSafeInteger(nonCash))throw bad('Payment amount is too large.');
   payments.push({method:payment.method,amount,tendered:amount,reference});
  }
  // Excess cash is physically returned, NOT revenue or a customer credit.
  // Only Cash may cover a change amount; overpayments through bank/card/wallet/credit are rejected.
  if(nonCash>total)throw bad('Non-cash payments exceed the bill. Reduce bank/card/wallet/store-credit amount.');
  const change=Math.max(0,tendered-total);
  const paid=tendered-change; // NET retained amount; sales, reports and shift calculations use this
  let changeLeft=change;
  for(let i=payments.length-1;i>=0&&changeLeft>0;i--){
   const entry=payments[i];if(entry.method!=='Cash')continue;
   const deduct=Math.min(entry.amount,changeLeft);
   entry.amount-=deduct;changeLeft-=deduct;
  }
  if(changeLeft!==0)throw bad('Cash received is insufficient to cover the change.');
  if(type==='delivery_cod'){
   if(paid<Math.ceil(total*0.1))throw bad('COD orders require at least 10% advance payment.');
  } else if(type!=='layaway'&&paid!==total) throw bad('Full payment is required except for COD and authorized customer-credit sales.');
  let cid=null;
  if(b.customer_id!==undefined&&b.customer_id!==null&&b.customer_id!==''){
   cid=Number(b.customer_id);
   if(!Number.isInteger(cid)||!db.prepare('SELECT id FROM customers WHERE id=?').get(cid))throw bad('Customer not found.');
  }
  if((type==='delivery_cod'||type==='layaway')&&!cid)throw bad('COD and credit sales require a customer.');
  const payingCredit=payments.filter(p=>p.method==='Store Credit').reduce((n,p)=>n+p.amount,0);
  if(payingCredit){if(!cid)throw bad('Select a customer to redeem store credit.');if(payingCredit>pro.credit(cid))throw bad('Customer has insufficient store credit.');}
  if(type==='delivery_cod'&&paid-payingCredit<Math.ceil(total*.1))throw bad('COD requires a 10% advance from cash, bank, card or wallet.');
  const createdId=transaction(()=>{
   // A repeated request remains safe even if two browser retries arrive close together.
   const found=db.prepare('SELECT id FROM sales WHERE client_request_id=?').get(reqId);if(found)return found.id;
   for(const it of itemRows){
    const stock=db.prepare('SELECT qty FROM stock WHERE product_id=? AND location_id=1').get(it.id);
    if(!stock||stock.qty<it.qty)throw bad(`${it.p.name}: only ${stock?.qty||0} items in store. Adjust or transfer stock first.`);
   }
   const result=db.prepare(`INSERT INTO sales(client_request_id,sale_type,customer_id,subtotal_paisa,discount_paisa,tax_paisa,
    total_paisa,paid_paisa,due_paisa,status,notes,user_id,tendered_paisa,change_paisa) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    reqId,type,cid,subtotal,discount,tax,total,paid,total-paid,total===paid?'PAID':type==='layaway'?'CREDIT_PENDING':'COD_PENDING',optString(b.notes,500),user.id,tendered,change);
   const id=Number(result.lastInsertRowid);
   const stamp=nowIslamabadDate().replaceAll('-',''); const prefix=optString(cfg.receipt_prefix||'FX',8).replace(/[^A-Z0-9]/gi,'').toUpperCase()||'FX';
   db.prepare('UPDATE sales SET receipt_no=? WHERE id=?').run(`${prefix}-${stamp}-${String(id).padStart(5,'0')}`,id);
   for(const it of itemRows){
    db.prepare(`INSERT INTO sale_items(sale_id,product_id,sku,name,qty,unit_price_paisa,cost_paisa,line_total_paisa)
     VALUES(?,?,?,?,?,?,?,?)`).run(id,it.id,it.p.sku,it.p.name,it.qty,it.unit,it.p.cost_paisa,it.line);
    db.prepare('UPDATE stock SET qty=qty-? WHERE product_id=? AND location_id=1').run(it.qty,it.id);
    db.prepare('INSERT INTO stock_movements(product_id,location_id,delta,kind,reason,sale_id,user_id) VALUES(?,?,?,?,?,?,?)').run(it.id,1,-it.qty,'SALE',`Receipt ${id}`,id,user.id);
   }
   for(const payment of payments)db.prepare('INSERT INTO payments(sale_id,method,amount_paisa,tendered_paisa,reference) VALUES(?,?,?,?,?)').run(id,payment.method,payment.amount,payment.tendered,payment.reference);
   pro.onSale(id,user,b);
   db.prepare('UPDATE payments SET shift_id=(SELECT shift_id FROM sales WHERE id=?) WHERE sale_id=? AND shift_id IS NULL').run(id,id);
   hybrid.enqueueSale(id);
   audit(user.id,'CREATE_SALE',`sale:${id}`,`${type}; total=${total}; net_collected=${paid}; cash_change=${change}`);return id;
  });return respond(res,201,{sale:getSale(createdId)});
 }
 if(method==='GET'&&pathname==='/api/sales'){
  const rows=db.prepare(`SELECT s.id,s.receipt_no,s.sale_type,s.status,s.total_paisa,s.paid_paisa,s.due_paisa,s.created_at,
  u.username AS cashier,c.name AS customer_name FROM sales s JOIN users u ON u.id=s.user_id
  LEFT JOIN customers c ON c.id=s.customer_id ORDER BY s.id DESC LIMIT 150`).all();
  return respond(res,200,{sales:user.role==='cashier'?rows.filter(s=>s.cashier===user.username):rows});
 }
 const saleMatch=/^\/api\/sales\/(\d+)$/.exec(pathname);
 if(method==='GET'&&saleMatch){const sale=getSale(Number(saleMatch[1]));
  if(user.role==='cashier'&&sale.user_id!==user.id)throw bad('You can only view your own receipts.',403);
  return respond(res,200,{sale});
 }
 if(method==='GET'&&pathname==='/api/dashboard'){
  const day=nowIslamabadDate();const stats=report(day,day);
  const low=productList().filter(p=>p.store_qty<=p.threshold).slice(0,8);
  const recent=db.prepare('SELECT id,receipt_no,total_paisa,status,created_at FROM sales ORDER BY id DESC LIMIT 6').all();
  const productCount=db.prepare('SELECT COUNT(*) AS n FROM products WHERE is_active=1').get().n;
  return respond(res,200,{day,stats,low,recent,productCount});
 }
 if(method==='GET'&&pathname==='/api/reports'){
  requireRole(user,['admin','manager']);const today=nowIslamabadDate();
  return respond(res,200,{report:report(url.searchParams.get('from')||today,url.searchParams.get('to')||today)});
 }
 if(method==='GET'&&pathname==='/api/receivables'){
  requireRole(user,['admin','manager']);return respond(res,200,{receivables:db.prepare(`SELECT s.id,s.receipt_no,s.sale_type,s.total_paisa,s.paid_paisa,s.due_paisa,s.created_at,s.status,
    c.name customer_name,c.phone customer_phone FROM sales s JOIN customers c ON c.id=s.customer_id
    WHERE s.due_paisa>0 ORDER BY s.id DESC LIMIT 300`).all()});
 }
 const collectReceivable=/^\/api\/receivables\/(\d+)\/collect$/.exec(pathname);
 if(method==='POST'&&collectReceivable){requireRole(user,['admin','manager']);const b=await parseBody(req);
  const saleId=Number(collectReceivable[1]),amount=money(b.amount,'Collection amount');
  if(amount===0)throw bad('Collection amount must be greater than zero.');
  if(!['Cash','Card','Bank Transfer','JazzCash','Easypaisa'].includes(b.method))throw bad('Unsupported collection method.');
  const reference=optString(b.reference,100);
  if(['Bank Transfer','JazzCash','Easypaisa'].includes(b.method)&&!reference)throw bad('Payment reference is required.');
  const collectionId=requiredString(b.collection_id,'Collection ID',100);
  const result=transaction(()=>{
    const existing=db.prepare('SELECT sale_id,amount_paisa FROM receivable_collections WHERE collection_id=?').get(collectionId);
    if(existing){if(existing.sale_id!==saleId||existing.amount_paisa!==amount)throw bad('Collection ID already used for another payment.',409);return {due_paisa:db.prepare('SELECT due_paisa FROM sales WHERE id=?').get(saleId).due_paisa,duplicate:true};}
    const sale=db.prepare('SELECT * FROM sales WHERE id=?').get(saleId);
    if(!sale||!['layaway','delivery_cod'].includes(sale.sale_type))throw bad('Receivable sale not found.');
    if(amount>sale.due_paisa)throw bad('Collection exceeds the remaining balance.');
    db.prepare('INSERT INTO receivable_collections(collection_id,sale_id,amount_paisa) VALUES(?,?,?)').run(collectionId,saleId,amount);
    const openShift=db.prepare("SELECT id FROM shifts WHERE user_id=? AND status='OPEN' ORDER BY id DESC LIMIT 1").get(user.id);
    if(b.method==='Cash'&&!openShift)throw bad('Open your cash shift before collecting cash for an old balance.');
    db.prepare('INSERT INTO payments(sale_id,method,amount_paisa,tendered_paisa,reference,shift_id) VALUES(?,?,?,?,?,?)').run(saleId,b.method,amount,amount,reference,openShift?.id??null);
    db.prepare('UPDATE sales SET paid_paisa=paid_paisa+?,due_paisa=due_paisa-?,tendered_paisa=tendered_paisa+?,status=? WHERE id=?')
     .run(amount,amount,amount,amount===sale.due_paisa?'PAID':sale.status,saleId);
    audit(user.id,'RECEIVABLE_COLLECT',`sale:${saleId}`,`${b.method} / ${amount}`);
    return {due_paisa:sale.due_paisa-amount};
  });return respond(res,200,result);
 }
 if(method==='GET'&&pathname==='/api/settings'){
  requireRole(user,['admin']);return respond(res,200,{settings:getSettings(),users:db.prepare('SELECT id,username,role,is_active,created_at FROM users ORDER BY id').all()});
 }
 if(method==='PATCH'&&pathname==='/api/settings'){
  requireRole(user,['admin']);const b=await parseBody(req);
  const updates={
   store_name:requiredString(b.store_name,'Store name',80),
   address:optString(b.address,220),phone:optString(b.phone,50),
   website:optString(b.website,200),email:optString(b.email,160),
   receipt_footer:optString(b.receipt_footer,220),
   receipt_prefix:requiredString(b.receipt_prefix,'Receipt prefix',8).toUpperCase().replace(/[^A-Z0-9]/g,''),
   customer_credit_enabled:b.customer_credit_enabled===true?'true':'false',
   tax_rate_percent:String(b.tax_rate_percent),cashier_discount_percent:String(b.cashier_discount_percent)
  };
  for(const k of ['tax_rate_percent','cashier_discount_percent']){
   const n=Number(updates[k]);if(!Number.isFinite(n)||n<0||n>100)throw bad(`${k} must be between 0 and 100.`);
   updates[k]=String(n);
  }
  if(!updates.receipt_prefix)throw bad('Receipt prefix must include letters or numbers.');
  transaction(()=>{for(const [k,v] of Object.entries(updates))db.prepare('UPDATE settings SET value=? WHERE key=?').run(v,k);audit(user.id,'SETTINGS_CHANGE','settings','Store preferences updated');});
  return respond(res,200,{ok:true,settings:getSettings()});
 }
 if(method==='POST'&&pathname==='/api/users'){
  requireRole(user,['admin']);const b=await parseBody(req),username=requiredString(b.username,'Username',40),password=requiredString(b.password,'Password',128);
  if(password.length<10)throw bad('Password must have at least 10 characters.');
  if(!['manager','cashier','warehouse','support'].includes(b.role))throw bad('Invalid staff role.');
  const id=Number(db.prepare('INSERT INTO users(username,password_hash,role) VALUES(?,?,?)').run(username,hashPassword(password),b.role).lastInsertRowid);
  audit(user.id,'CREATE_USER',`user:${id}`,b.role);return respond(res,201,{ok:true,id});
 }
 if(method==='POST'&&pathname==='/api/change-password'){
  const b=await parseBody(req),old=String(b.current_password||''),next=requiredString(b.new_password,'New password',128);
  if(next.length<10)throw bad('New password must have at least 10 characters.');
  const record=db.prepare('SELECT password_hash FROM users WHERE id=?').get(user.id);
  if(!verifyPassword(old,record.password_hash))throw bad('Current password is incorrect.',403);
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(next),user.id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
  return respond(res,200,{ok:true});
 }
 if(method==='POST'&&pathname==='/api/demo-seed'){
  requireRole(user,['admin']);transaction(()=>seedDemo(user.id));return respond(res,200,{ok:true});
 }
 if(method==='GET'&&pathname==='/api/audit'){
  requireRole(user,['admin']);return respond(res,200,{logs:db.prepare(`SELECT a.*,u.username FROM audit_logs a LEFT JOIN users u ON a.user_id=u.id ORDER BY a.id DESC LIMIT 100`).all()});
 }
 throw bad('API route not found.',404);
}
const staticFiles={
 '/':['index.html','text/html; charset=utf-8'],
 '/index.html':['index.html','text/html; charset=utf-8'],
 '/styles.css':['styles.css','text/css; charset=utf-8'],
 '/pro.css':['pro.css','text/css; charset=utf-8'],
 '/brand-cream.css':['brand-cream.css','text/css; charset=utf-8'],
 '/app.js':['app.js','application/javascript; charset=utf-8'],
 '/favicon.svg':['favicon.svg','image/svg+xml'],
 '/manifest.webmanifest':['manifest.webmanifest','application/manifest+json; charset=utf-8'],
 '/sw.js':['sw.js','application/javascript; charset=utf-8'],
 '/icon-192.png':['icon-192.png','image/png'],
 '/icon-512.png':['icon-512.png','image/png']
};
const server=http.createServer(async(req,res)=>{
 try{
  const hostHeader=req.headers.host||'';
  if(!ALLOWED_HOSTS.has(hostHeader.toLowerCase()))throw bad('Host not allowed.',403);
  const origin=req.headers.origin;
  if(['POST','PUT','PATCH','DELETE'].includes(req.method)&&origin&&!ALLOWED_ORIGINS.has(origin))throw bad('Cross-origin requests are blocked.',403);
  if(req.headers['sec-fetch-site']==='cross-site'&&['POST','PUT','PATCH','DELETE'].includes(req.method))throw bad('Cross-site requests are blocked.',403);
  const url=new URL(req.url,`http://${hostHeader}`);
  if(url.pathname.startsWith('/api/')){await api(req,res,url);return;}
  if(req.method!=='GET'&&req.method!=='HEAD')throw bad('Method not allowed.',405);
  let file=staticFiles[url.pathname];
  if(!file&&/^\/uploads\/fx-\d+-[a-f0-9]{12}\.(jpg|png|webp)$/.test(url.pathname)){
    const ext=path.extname(url.pathname);file=[url.pathname.slice(1),ext==='.png'?'image/png':ext==='.webp'?'image/webp':'image/jpeg'];
  }
  if(!file&&/^\/uploads\/shopify\/[A-Za-z0-9_-]{1,64}\.(jpg|png|webp)$/.test(url.pathname)){
    const ext=path.extname(url.pathname);file=[url.pathname.slice(1),ext==='.png'?'image/png':ext==='.webp'?'image/webp':'image/jpeg'];
  }
  if(!file)throw bad('Page not found.',404);
  const bytes=fs.readFileSync(path.join(__dirname,'public',file[0]));
  res.writeHead(200,{'Content-Type':file[1],'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff',
   'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://cdn.shopify.com https://*.shopifycdn.net https://flexicowatches.com; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});
  res.end(req.method==='HEAD'?undefined:bytes);
 }catch(e){
  let status=e.status||500;let message=e.message||'Unexpected server error.';
  if(e.code==='SQLITE_CONSTRAINT_UNIQUE'){status=409;message='This SKU, barcode, username, or phone already exists.';}
  if(e.code==='SQLITE_CONSTRAINT_CHECK'){status=400;message='Invalid value (constraint violation).';}
  if(status===500)console.error('[Flexico server]',e);
  if(!res.headersSent)respond(res,status,{error:status===500?'Unexpected server error. Check the terminal.':message});
 }
});
if(require.main===module)server.listen(PORT,HOST,()=>{
 pro.autoBackup().catch(e=>console.error('Auto backup failed:',e.message));
 hybrid.start();
 setInterval(()=>pro.autoBackup().catch(e=>console.error('Auto backup failed:',e.message)),6*3600*1000).unref();
 console.log(`\n  FLEXICO POS — v1.3 CREAM & GOLD RELEASE CANDIDATE (LOCAL CASHIER)\n  Open http://localhost:${PORT}\n  Database: ${DB_PATH}\n  Press Ctrl+C to stop.\n`);
});
module.exports={server,db,money,hashPassword};
