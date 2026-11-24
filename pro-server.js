'use strict';
/* Additional Flexico local business workflows. Every mutating operation is permission checked,
   validated and committed atomically with the SQLite database. No external live integrations. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { backup } = require('node:sqlite');
const root = __dirname;
const uploads = path.join(root, 'public', 'uploads');
const backups = path.join(path.dirname(process.env.FLEXICO_DB || path.join(root,'data','flexico.sqlite')), 'backups');
fs.mkdirSync(uploads,{recursive:true});
fs.mkdirSync(backups,{recursive:true});
function install(db){
 db.exec(`
 CREATE TABLE IF NOT EXISTS suppliers(id INTEGER PRIMARY KEY,name TEXT NOT NULL,phone TEXT DEFAULT '',email TEXT DEFAULT '',city TEXT DEFAULT '',address TEXT DEFAULT '',notes TEXT DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS purchase_orders(id INTEGER PRIMARY KEY,number TEXT UNIQUE,supplier_id INTEGER NOT NULL REFERENCES suppliers(id),status TEXT NOT NULL DEFAULT 'DRAFT',shipping_paisa INTEGER NOT NULL DEFAULT 0,notes TEXT NOT NULL DEFAULT '',created_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,received_at TEXT);
 CREATE TABLE IF NOT EXISTS purchase_items(id INTEGER PRIMARY KEY,order_id INTEGER NOT NULL REFERENCES purchase_orders(id),product_id INTEGER NOT NULL REFERENCES products(id),qty INTEGER NOT NULL CHECK(qty>0),unit_cost_paisa INTEGER NOT NULL CHECK(unit_cost_paisa>=0));
 CREATE TABLE IF NOT EXISTS shifts(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),status TEXT NOT NULL DEFAULT 'OPEN',opening_paisa INTEGER NOT NULL CHECK(opening_paisa>=0),closing_paisa INTEGER,expected_paisa INTEGER,variance_paisa INTEGER,notes TEXT NOT NULL DEFAULT '',opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,closed_at TEXT);
 CREATE UNIQUE INDEX IF NOT EXISTS ix_open_shift_per_user ON shifts(user_id) WHERE status='OPEN';
 CREATE TABLE IF NOT EXISTS returns(id INTEGER PRIMARY KEY,number TEXT UNIQUE NOT NULL,sale_id INTEGER NOT NULL REFERENCES sales(id),reason TEXT NOT NULL,refund_method TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'COMPLETED',refund_paisa INTEGER NOT NULL,created_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS return_items(id INTEGER PRIMARY KEY,return_id INTEGER NOT NULL REFERENCES returns(id),sale_item_id INTEGER NOT NULL REFERENCES sale_items(id),qty INTEGER NOT NULL,refund_paisa INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS credit_ledger(id INTEGER PRIMARY KEY,customer_id INTEGER NOT NULL REFERENCES customers(id),delta_paisa INTEGER NOT NULL,reason TEXT NOT NULL,sale_id INTEGER REFERENCES sales(id),return_id INTEGER REFERENCES returns(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS warranties(id INTEGER PRIMARY KEY,sale_item_id INTEGER NOT NULL UNIQUE REFERENCES sale_items(id),customer_id INTEGER REFERENCES customers(id),serial_no TEXT UNIQUE,start_date TEXT NOT NULL,expiry_date TEXT NOT NULL,qty INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'ACTIVE',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS warranty_claims(id INTEGER PRIMARY KEY,warranty_id INTEGER NOT NULL REFERENCES warranties(id),issue TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'RECEIVED',resolution TEXT NOT NULL DEFAULT '',created_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS deliveries(sale_id INTEGER PRIMARY KEY REFERENCES sales(id),verified INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'NEW',courier TEXT NOT NULL DEFAULT '',tracking TEXT NOT NULL DEFAULT '',rider TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS promotions(id INTEGER PRIMARY KEY,code TEXT NOT NULL COLLATE NOCASE UNIQUE,kind TEXT NOT NULL CHECK(kind IN ('percent','fixed')),value TEXT NOT NULL,minimum_paisa INTEGER NOT NULL DEFAULT 0,usage_limit INTEGER NOT NULL DEFAULT 0,usage_count INTEGER NOT NULL DEFAULT 0,valid_from TEXT,valid_to TEXT,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS promotion_redemptions(id INTEGER PRIMARY KEY,promotion_id INTEGER NOT NULL REFERENCES promotions(id),sale_id INTEGER NOT NULL UNIQUE REFERENCES sales(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS supplier_payments(id INTEGER PRIMARY KEY,order_id INTEGER NOT NULL REFERENCES purchase_orders(id),method TEXT NOT NULL,amount_paisa INTEGER NOT NULL CHECK(amount_paisa>0),reference TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',created_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS held_bills(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),title TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS stock_counts(id INTEGER PRIMARY KEY,location_id INTEGER NOT NULL REFERENCES locations(id),status TEXT NOT NULL DEFAULT 'OPEN',notes TEXT NOT NULL DEFAULT '',created_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,completed_at TEXT);
 CREATE TABLE IF NOT EXISTS stock_count_items(id INTEGER PRIMARY KEY,count_id INTEGER NOT NULL REFERENCES stock_counts(id),product_id INTEGER NOT NULL REFERENCES products(id),expected_qty INTEGER NOT NULL,counted_qty INTEGER,UNIQUE(count_id,product_id));
 CREATE INDEX IF NOT EXISTS ix_returns_sale ON returns(sale_id);
 CREATE INDEX IF NOT EXISTS ix_claims_warranty ON warranty_claims(warranty_id);
 CREATE INDEX IF NOT EXISTS ix_credit_customer ON credit_ledger(customer_id);
 `);
 const hasColumn=(table,col)=>db.prepare(`PRAGMA table_info(${table})`).all().some(r=>r.name===col);
 for(const [table,col,sql] of [
   ['products','image_path',"ALTER TABLE products ADD COLUMN image_path TEXT NOT NULL DEFAULT ''"],
   ['products','warranty_months',"ALTER TABLE products ADD COLUMN warranty_months INTEGER NOT NULL DEFAULT 12"],
   ['sales','shift_id','ALTER TABLE sales ADD COLUMN shift_id INTEGER REFERENCES shifts(id)'],
   ['sales','coupon_code',"ALTER TABLE sales ADD COLUMN coupon_code TEXT NOT NULL DEFAULT ''"],
   ['returns','shift_id','ALTER TABLE returns ADD COLUMN shift_id INTEGER REFERENCES shifts(id)'],
 ]) if(!hasColumn(table,col))db.exec(sql);
 db.prepare("INSERT OR IGNORE INTO locations(id,code,name) VALUES(3,'QUARANTINE','Returns / Inspection')").run();
 db.prepare("INSERT OR IGNORE INTO deliveries(sale_id) SELECT id FROM sales WHERE sale_type<>'in_store'").run();
 // Historical pilot sales receive a warranty row if one was not generated by v0.1.
 for(const it of db.prepare("SELECT si.id,si.qty,s.customer_id,s.created_at,p.warranty_months FROM sale_items si JOIN sales s ON s.id=si.sale_id JOIN products p ON p.id=si.product_id LEFT JOIN warranties w ON w.sale_item_id=si.id WHERE w.id IS NULL AND p.warranty_months>0").all()){
   const st=it.created_at.slice(0,10),end=new Date(st+'T12:00:00Z');end.setUTCMonth(end.getUTCMonth()+it.warranty_months);
   db.prepare("INSERT INTO warranties(sale_item_id,customer_id,start_date,expiry_date,qty) VALUES(?,?,?,?,?)").run(it.id,it.customer_id,st,end.toISOString().slice(0,10),it.qty);
 }
}
function create(db, transaction, audit, bad, money, requiredString, optString, requireRole, parseBody, nowIslamabadDate){
 const ok=(body={},status=200)=>({status,body});
 const role=(u,roles)=>requireRole(u,roles);
 const integer=(v,label,min=1,max=100000)=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<min||n>max)throw bad(`${label} must be an integer between ${min} and ${max}.`);return n;};
 const str=(v,label,max=200)=>requiredString(v,label,max);
 const text=(v,max=500)=>optString(v,max);
 const exists=(table,id)=>{if(!db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(id))throw bad(`${table} record not found.`,404);};
 const credit=(cid)=>db.prepare('SELECT COALESCE(SUM(delta_paisa),0) AS amount FROM credit_ledger WHERE customer_id=?').get(cid).amount;
 const saleDetails=id=>{const s=db.prepare('SELECT * FROM sales WHERE id=?').get(id);if(!s)throw bad('Sale not found.',404);return s;};
 const promo=(code,subtotal)=>{
   const p=db.prepare('SELECT * FROM promotions WHERE code=?').get(code);
   if(!p||!p.active)throw bad('Promotion code not found or inactive.');
   const day=nowIslamabadDate();
   if((p.valid_from&&p.valid_from>day)||(p.valid_to&&p.valid_to<day))throw bad('Promotion not valid for today.');
   if(p.usage_limit&&p.usage_count>=p.usage_limit)throw bad('Promotion usage limit reached.');
   if(subtotal<p.minimum_paisa)throw bad('Bill is below the promotion minimum spend.');
   const discount=p.kind==='fixed'?money(p.value,'Promotion value'):Math.round(subtotal*Number(p.value)/100);
   return {promotion:p,discount:Math.min(subtotal,discount)};
 };
 function onSale(id,user,b){
   const s=saleDetails(id);
   const active=db.prepare("SELECT id FROM shifts WHERE user_id=? AND status='OPEN' ORDER BY id DESC LIMIT 1").get(user.id);
   if(active)db.prepare('UPDATE sales SET shift_id=? WHERE id=?').run(active.id,id);
   const code=text(b.coupon_code,50).toUpperCase();
   if(code){
     const p=db.prepare('SELECT id FROM promotions WHERE code=?').get(code);
     db.prepare('INSERT INTO promotion_redemptions(promotion_id,sale_id) VALUES(?,?)').run(p.id,id);
     db.prepare('UPDATE promotions SET usage_count=usage_count+1 WHERE id=?').run(p.id);
     db.prepare('UPDATE sales SET coupon_code=? WHERE id=?').run(code,id);
   }
   if(s.customer_id){
     const c=(b.payments||[]).filter(p=>p.method==='Store Credit').reduce((n,p)=>n+money(p.amount),0);
     if(c){if(credit(s.customer_id)<c)throw bad('Not enough customer store credit.');
       db.prepare('INSERT INTO credit_ledger(customer_id,delta_paisa,reason,sale_id) VALUES(?,?,?,?)').run(s.customer_id,-c,`Used on receipt ${s.receipt_no}`,id);
     }
   }
   for(const item of db.prepare('SELECT si.*,p.warranty_months FROM sale_items si JOIN products p ON p.id=si.product_id WHERE si.sale_id=?').all(id)){
     if(item.warranty_months>0){
       const start=nowIslamabadDate();const end=new Date(`${start}T12:00:00Z`);end.setUTCMonth(end.getUTCMonth()+item.warranty_months);
       db.prepare('INSERT INTO warranties(sale_item_id,customer_id,start_date,expiry_date,qty) VALUES(?,?,?,?,?)').run(item.id,s.customer_id,start,end.toISOString().slice(0,10),item.qty);
     }
   }
   if(s.sale_type!=='in_store')db.prepare('INSERT INTO deliveries(sale_id) VALUES(?)').run(id);
 }
 function renderPO(id){const po=db.prepare('SELECT po.*,s.name supplier_name FROM purchase_orders po JOIN suppliers s ON po.supplier_id=s.id WHERE po.id=?').get(id);if(!po)throw bad('Purchase order not found.',404);const items=db.prepare('SELECT pi.*,p.name,p.sku FROM purchase_items pi JOIN products p ON p.id=pi.product_id WHERE pi.order_id=? ORDER BY pi.id').all(id);
 const paid=db.prepare('SELECT COALESCE(SUM(amount_paisa),0) paid FROM supplier_payments WHERE order_id=?').get(id).paid;
 return {...po,items,paid_paisa:paid,total_paisa:items.reduce((n,i)=>n+i.qty*i.unit_cost_paisa,po.shipping_paisa),payments:db.prepare('SELECT * FROM supplier_payments WHERE order_id=? ORDER BY id').all(id)};}
 function returnedQty(itemId){return db.prepare('SELECT COALESCE(SUM(qty),0) q FROM return_items WHERE sale_item_id=?').get(itemId).q;}
 async function route(req,url,user){const pathName=url.pathname; if(!pathName.startsWith('/api/pro/'))return null;
   const p=pathName.slice('/api/pro'.length);const method=req.method;
   if(method==='GET'&&p==='/overview'){
     const day=nowIslamabadDate();const dateStart=day+' 00:00:00';
     const pending=db.prepare("SELECT COUNT(*) n FROM deliveries WHERE status NOT IN ('DELIVERED','CANCELLED')").get().n;
     const claims=db.prepare("SELECT COUNT(*) n FROM warranty_claims WHERE status NOT IN ('RETURNED','REJECTED')").get().n;
     const returnsToday=db.prepare("SELECT COALESCE(SUM(refund_paisa),0) amt FROM returns WHERE date(created_at,'+5 hours')=?").get(day).amt;
     const openShifts=db.prepare("SELECT COUNT(*) n FROM shifts WHERE status='OPEN'").get().n;
     const lowStock=db.prepare('SELECT COUNT(*) n FROM products p LEFT JOIN stock s ON p.id=s.product_id AND s.location_id=1 WHERE p.is_active=1 AND COALESCE(s.qty,0)<=p.threshold').get().n;
     return ok({pending,claims,returnsToday,openShifts,lowStock,day,dateStart});
   }
   if(method==='GET'&&p==='/holds'){role(user,['admin','manager','cashier']);return ok({bills:db.prepare('SELECT id,title,payload,created_at FROM held_bills WHERE user_id=? ORDER BY id DESC LIMIT 40').all(user.id).map(b=>({...b,payload:JSON.parse(b.payload)}))});}
   if(method==='POST'&&p==='/holds'){role(user,['admin','manager','cashier']);const b=await parseBody(req);if(!Array.isArray(b.items)||!b.items.length||b.items.length>100)throw bad('Cannot hold an empty bill.');
     const items=b.items.map(x=>({id:integer(x.id,'Product'),qty:integer(x.qty,'Quantity',1,1000)}));for(const x of items)exists('products',x.id);
     const payload={items,saleType:text(b.saleType,30)||'in_store',customerId:text(b.customerId,50),discountType:text(b.discountType,20)||'fixed',discountValue:text(b.discountValue,30)||'0',notes:text(b.notes,500)};
     if(db.prepare('SELECT COUNT(*) n FROM held_bills WHERE user_id=?').get(user.id).n>=30)throw bad('Maximum 30 held bills per cashier.');
     const id=Number(db.prepare('INSERT INTO held_bills(user_id,title,payload) VALUES(?,?,?)').run(user.id,text(b.title,60)||'Held customer bill',JSON.stringify(payload)).lastInsertRowid);audit(user.id,'HOLD_BILL',`hold:${id}`);return ok({id},201);
   }
   const heldMatch=/^\/holds\/(\d+)$/.exec(p);
   if(method==='DELETE'&&heldMatch){role(user,['admin','manager','cashier']);const id=integer(heldMatch[1],'Held bill');const result=db.prepare('DELETE FROM held_bills WHERE id=? AND user_id=?').run(id,user.id);if(!result.changes)throw bad('Held bill not found.',404);audit(user.id,'RESUME_OR_DISCARD_BILL',`hold:${id}`);return ok({ok:true});}
   if(method==='GET'&&p==='/suppliers'){
     role(user,['admin','manager','warehouse']);return ok({suppliers:db.prepare('SELECT * FROM suppliers ORDER BY id DESC LIMIT 250').all()});
   }
   if(method==='POST'&&p==='/suppliers'){
     role(user,['admin','manager']);const b=await parseBody(req);const id=Number(db.prepare('INSERT INTO suppliers(name,phone,email,city,address,notes) VALUES(?,?,?,?,?,?)').run(str(b.name,'Supplier',140),text(b.phone,60),text(b.email,150),text(b.city,90),text(b.address,220),text(b.notes,500)).lastInsertRowid);audit(user.id,'SUPPLIER_CREATE',`supplier:${id}`);return ok({id},201);
   }
   const supplierPatch=/^\/suppliers\/(\d+)$/.exec(p);
   if(method==='PATCH'&&supplierPatch){role(user,['admin','manager']);const id=integer(supplierPatch[1],'Supplier ID');exists('suppliers',id);const b=await parseBody(req);db.prepare('UPDATE suppliers SET name=?,phone=?,email=?,city=?,address=?,notes=? WHERE id=?').run(str(b.name,'Supplier',140),text(b.phone,60),text(b.email,150),text(b.city,90),text(b.address,220),text(b.notes,500),id);audit(user.id,'SUPPLIER_EDIT',`supplier:${id}`);return ok({ok:true});}
   if(method==='GET'&&p==='/purchases'){
     role(user,['admin','manager','warehouse']);return ok({orders:db.prepare('SELECT po.*,s.name supplier_name,(SELECT COUNT(*) FROM purchase_items WHERE order_id=po.id) product_lines,(SELECT COALESCE(SUM(qty*unit_cost_paisa),0) FROM purchase_items WHERE order_id=po.id)+po.shipping_paisa total_paisa FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id ORDER BY po.id DESC LIMIT 200').all()});
   }
   if(method==='POST'&&p==='/purchases'){
     role(user,['admin','manager']);const b=await parseBody(req);const supplierId=integer(b.supplier_id,'Supplier');exists('suppliers',supplierId);
     if(!Array.isArray(b.items)||!b.items.length||b.items.length>100)throw bad('Purchase must contain 1–100 products.');
     const items=b.items.map(i=>({pid:integer(i.product_id,'Product'),qty:integer(i.qty,'Quantity',1,100000),cost:money(i.unit_cost,'Unit cost')}));
     const shipping=money(b.shipping??'0','Shipping');const id=transaction(()=>{
       for(const it of items)exists('products',it.pid);
       const r=db.prepare('INSERT INTO purchase_orders(supplier_id,shipping_paisa,notes,created_by) VALUES(?,?,?,?)').run(supplierId,shipping,text(b.notes),user.id);
       const id=Number(r.lastInsertRowid);db.prepare('UPDATE purchase_orders SET number=? WHERE id=?').run('PO-'+String(id).padStart(6,'0'),id);
       for(const it of items)db.prepare('INSERT INTO purchase_items(order_id,product_id,qty,unit_cost_paisa) VALUES(?,?,?,?)').run(id,it.pid,it.qty,it.cost);
       audit(user.id,'PURCHASE_CREATE',`po:${id}`);return id;
     });return ok({order:renderPO(id)},201);
   }
   const poMatch=/^\/purchases\/(\d+)$/.exec(p);
   if(method==='GET'&&poMatch){role(user,['admin','manager','warehouse']);return ok({order:renderPO(integer(poMatch[1],'PO'))});}
   const poPayment=/^\/purchases\/(\d+)\/pay$/.exec(p);
   if(method==='POST'&&poPayment){role(user,['admin','manager']);const id=integer(poPayment[1],'Purchase order');const b=await parseBody(req);const amount=money(b.amount,'Supplier payment'),method=String(b.method||'');
     if(amount<=0)throw bad('Payment must be greater than zero.');if(!['Cash','Bank Transfer','Cheque','Wallet'].includes(method))throw bad('Invalid supplier payment method.');
     const result=transaction(()=>{const po=renderPO(id);if(amount>po.total_paisa-po.paid_paisa)throw bad('Payment exceeds remaining purchase order balance.');
       db.prepare('INSERT INTO supplier_payments(order_id,method,amount_paisa,reference,notes,created_by) VALUES(?,?,?,?,?,?)').run(id,method,amount,text(b.reference,120),text(b.notes,300),user.id);
       audit(user.id,'SUPPLIER_PAYMENT',`po:${id}`,`${method} ${amount}`);return {balance_paisa:po.total_paisa-po.paid_paisa-amount};});return ok(result,201);
   }

   const poReceive=/^\/purchases\/(\d+)\/receive$/.exec(p);
   if(method==='POST'&&poReceive){role(user,['admin','manager','warehouse']);const id=integer(poReceive[1],'PO');const b=await parseBody(req);const dest=integer(b.location_id||2,'Location');if(![1,2].includes(dest))throw bad('Receive only at main store or warehouse.');
     transaction(()=>{const po=renderPO(id);if(po.status!=='DRAFT')throw bad('This PO has already been received or cancelled.');
       const totalQty=po.items.reduce((n,i)=>n+i.qty,0);let remainingShipping=po.shipping_paisa;
       po.items.forEach((it,index)=>{
         const shippingShare=index===po.items.length-1?remainingShipping:Math.floor(po.shipping_paisa*it.qty/totalQty);
         remainingShipping-=shippingShare;
         db.prepare('INSERT OR IGNORE INTO stock(product_id,location_id,qty) VALUES(?,?,0)').run(it.product_id,dest);
         db.prepare('UPDATE stock SET qty=qty+? WHERE product_id=? AND location_id=?').run(it.qty,it.product_id,dest);
         db.prepare('UPDATE products SET cost_paisa=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(it.unit_cost_paisa+Math.floor(shippingShare/it.qty),it.product_id);
         db.prepare('INSERT INTO stock_movements(product_id,location_id,delta,kind,reason,user_id) VALUES(?,?,?,?,?,?)').run(it.product_id,dest,it.qty,'PURCHASE',`Received ${po.number}`,user.id);
       });
       db.prepare("UPDATE purchase_orders SET status='RECEIVED',received_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
       audit(user.id,'PURCHASE_RECEIVE',`po:${id}`,`location:${dest}`);
     });return ok({order:renderPO(id)});
   }
   if(method==='GET'&&p==='/shifts'){
     role(user,['admin','manager','cashier']);const own=user.role==='cashier';
     return ok({shifts:db.prepare(`SELECT s.*,u.username FROM shifts s JOIN users u ON u.id=s.user_id ${own?'WHERE s.user_id=?':''} ORDER BY s.id DESC LIMIT 150`).all(...(own?[user.id]:[])),current:db.prepare("SELECT * FROM shifts WHERE user_id=? AND status='OPEN' ORDER BY id DESC LIMIT 1").get(user.id)||null});
   }
   if(method==='POST'&&p==='/shifts'){
     role(user,['admin','manager','cashier']);const b=await parseBody(req);const opening=money(b.opening??'0','Opening float');
     const id=transaction(()=>{if(db.prepare("SELECT id FROM shifts WHERE user_id=? AND status='OPEN'").get(user.id))throw bad('You already have an open shift. Close it first.');const id=Number(db.prepare('INSERT INTO shifts(user_id,opening_paisa,notes) VALUES(?,?,?)').run(user.id,opening,text(b.notes,300)).lastInsertRowid);audit(user.id,'SHIFT_OPEN',`shift:${id}`);return id;});return ok({id},201);
   }
   const closeShift=/^\/shifts\/(\d+)\/close$/.exec(p);
   if(method==='POST'&&closeShift){role(user,['admin','manager','cashier']);const id=integer(closeShift[1],'Shift');const b=await parseBody(req);const counted=money(b.counted,'Counted cash');
     const result=transaction(()=>{const shift=db.prepare('SELECT * FROM shifts WHERE id=?').get(id);if(!shift)throw bad('Shift not found.',404);if(shift.status!=='OPEN')throw bad('Shift already closed.');if(shift.user_id!==user.id&&user.role!=='admin')throw bad('Only the cashier or admin can close this shift.',403);
       const collected=db.prepare("SELECT COALESCE(SUM(p.amount_paisa),0) a FROM payments p WHERE p.shift_id=? AND p.method='Cash'").get(id).a;
       const refunded=db.prepare("SELECT COALESCE(SUM(refund_paisa),0) a FROM returns WHERE shift_id=? AND refund_method='Cash'").get(id).a;
       const expected=shift.opening_paisa+collected-refunded;const variance=counted-expected;
       db.prepare("UPDATE shifts SET status='CLOSED',closing_paisa=?,expected_paisa=?,variance_paisa=?,notes=?,closed_at=CURRENT_TIMESTAMP WHERE id=?").run(counted,expected,variance,text(b.notes,400),id);
       audit(user.id,'SHIFT_CLOSE',`shift:${id}`,`variance:${variance}`);return {expected,variance};
     });return ok(result);
   }
   if(method==='GET'&&p==='/returns'){
     role(user,['admin','manager','cashier','support']);return ok({returns:db.prepare('SELECT r.*,s.receipt_no,c.name customer_name,u.username created_by_name FROM returns r JOIN sales s ON s.id=r.sale_id LEFT JOIN customers c ON c.id=s.customer_id JOIN users u ON u.id=r.created_by ORDER BY r.id DESC LIMIT 200').all()});
   }
   if(method==='POST'&&p==='/returns'){
     role(user,['admin','manager']);const b=await parseBody(req);const saleId=integer(b.sale_id,'Sale ID');const method=String(b.refund_method||'');
     if(!['Cash','Card','Bank Transfer','JazzCash','Easypaisa','Store Credit'].includes(method))throw bad('Choose a valid refund method.');
     const reason=str(b.reason,'Return reason',400);const lines=b.items;
     if(!Array.isArray(lines)||!lines.length||lines.length>100)throw bad('Choose at least one returned product.');
     const result=transaction(()=>{
       const s=saleDetails(saleId);const days=Math.floor((Date.now()-Date.parse(s.created_at.replace(' ','T')+'Z'))/86400000);
       if(days>7&&!(user.role==='admin'&&b.override_policy===true&&reason.length>=10))throw bad('Seven-day return window expired. Admin can override with a detailed reason.');
       if(method==='Store Credit'&&!s.customer_id)throw bad('Add a customer to the original sale before giving store credit.');
       const byItem=new Map();for(const item of lines){const sid=integer(item.sale_item_id,'Sale item ID'),qty=integer(item.qty,'Return quantity',1,1000);if(byItem.has(sid))throw bad('Duplicate return item.');byItem.set(sid,qty);}
       let total=0;const details=[];
       for(const [sid,qty] of byItem){const it=db.prepare('SELECT * FROM sale_items WHERE id=? AND sale_id=?').get(sid,saleId);if(!it)throw bad('Sale line does not match receipt.');if(qty>it.qty-returnedQty(sid))throw bad('Quantity exceeds remaining returnable items.');
         const value=Math.round(s.total_paisa*(it.line_total_paisa/s.subtotal_paisa)*(qty/it.qty));total+=value;details.push({it,qty,value});}
       const already=db.prepare('SELECT COALESCE(SUM(refund_paisa),0) a FROM returns WHERE sale_id=?').get(saleId).a;
       if(total> s.total_paisa-already)throw bad('Refund exceeds original sale total.');
       if(total+already> s.paid_paisa)throw bad('Cumulative refunds cannot exceed money collected for this order.');
       const activeShift=db.prepare("SELECT id FROM shifts WHERE user_id=? AND status='OPEN'").get(user.id);
       const result=db.prepare('INSERT INTO returns(number,sale_id,reason,refund_method,refund_paisa,created_by,shift_id) VALUES(?,?,?,?,?,?,?)').run('RET-'+crypto.randomBytes(5).toString('hex').toUpperCase(),saleId,reason,method,total,user.id,activeShift?.id??null);
       const id=Number(result.lastInsertRowid);
       for(const {it,qty,value} of details){
         db.prepare('INSERT INTO return_items(return_id,sale_item_id,qty,refund_paisa) VALUES(?,?,?,?)').run(id,it.id,qty,value);
         db.prepare('INSERT OR IGNORE INTO stock(product_id,location_id,qty) VALUES(?,?,0)').run(it.product_id,3);
         db.prepare('UPDATE stock SET qty=qty+? WHERE product_id=? AND location_id=3').run(qty,it.product_id);
         db.prepare('INSERT INTO stock_movements(product_id,location_id,delta,kind,reason,sale_id,user_id) VALUES(?,?,?,?,?,?,?)').run(it.product_id,3,qty,'RETURN_QUARANTINE',`Return RET-${id}: ${reason}`,saleId,user.id);
         db.prepare("UPDATE warranties SET status='RETURNED' WHERE sale_item_id=? AND ? >= (SELECT qty FROM sale_items WHERE id=?)").run(it.id,returnedQty(it.id),it.id);
       }
       if(method==='Store Credit')db.prepare('INSERT INTO credit_ledger(customer_id,delta_paisa,reason,return_id) VALUES(?,?,?,?)').run(s.customer_id,total,`Return on ${s.receipt_no}`,id);
       const full=db.prepare('SELECT COUNT(*) n FROM sale_items si WHERE si.sale_id=? AND si.qty>(SELECT COALESCE(SUM(ri.qty),0) FROM return_items ri WHERE ri.sale_item_id=si.id)').get(saleId).n===0;
       db.prepare('UPDATE sales SET status=? WHERE id=?').run(full?'RETURNED':'PARTIAL_RETURN',saleId);
       audit(user.id,'RETURN_COMPLETE',`return:${id}`,`${method}; amount=${total}; ${reason}`);
       return {id,refund_paisa:total,status:full?'RETURNED':'PARTIAL_RETURN'};
     });return ok(result,201);
   }
   const lineMatch=/^\/returns\/sale\/(\d+)$/.exec(p);
   if(method==='GET'&&lineMatch){role(user,['admin','manager','cashier','support']);const id=integer(lineMatch[1],'Sale');const s=saleDetails(id);return ok({sale:s,items:db.prepare('SELECT si.*,si.qty-COALESCE((SELECT SUM(qty) FROM return_items ri WHERE ri.sale_item_id=si.id),0) AS returnable_qty FROM sale_items si WHERE si.sale_id=?').all(id)});}
   if(method==='GET'&&p==='/warranties'){
     role(user,['admin','manager','cashier','support']);return ok({warranties:db.prepare('SELECT w.*,si.name product,si.sku,s.receipt_no,c.name customer_name,c.phone FROM warranties w JOIN sale_items si ON si.id=w.sale_item_id JOIN sales s ON s.id=si.sale_id LEFT JOIN customers c ON c.id=w.customer_id ORDER BY w.id DESC LIMIT 300').all()});
   }
   const warrantyMatch=/^\/warranties\/(\d+)$/.exec(p);
   if(method==='PATCH'&&warrantyMatch){role(user,['admin','manager','support']);const id=integer(warrantyMatch[1],'Warranty');const b=await parseBody(req);const serial=text(b.serial_no,80)||null;exists('warranties',id);db.prepare('UPDATE warranties SET serial_no=? WHERE id=?').run(serial,id);audit(user.id,'WARRANTY_SERIAL',`warranty:${id}`,serial||'removed');return ok({ok:true});}
   if(method==='GET'&&p==='/claims'){
     role(user,['admin','manager','cashier','support']);return ok({claims:db.prepare('SELECT wc.*,w.serial_no,si.name product,s.receipt_no,c.name customer_name FROM warranty_claims wc JOIN warranties w ON w.id=wc.warranty_id JOIN sale_items si ON si.id=w.sale_item_id JOIN sales s ON s.id=si.sale_id LEFT JOIN customers c ON c.id=w.customer_id ORDER BY wc.id DESC LIMIT 200').all()});
   }
   if(method==='POST'&&p==='/claims'){
     role(user,['admin','manager','support']);const b=await parseBody(req);const wid=integer(b.warranty_id,'Warranty');const w=db.prepare('SELECT * FROM warranties WHERE id=?').get(wid);if(!w)throw bad('Warranty record not found.',404);if(w.status!=='ACTIVE'||w.expiry_date<nowIslamabadDate())throw bad('Warranty expired or inactive.');const id=Number(db.prepare('INSERT INTO warranty_claims(warranty_id,issue,created_by) VALUES(?,?,?)').run(wid,str(b.issue,'Issue',500),user.id).lastInsertRowid);audit(user.id,'WARRANTY_CLAIM_OPEN',`claim:${id}`);return ok({id},201);
   }
   const claimMatch=/^\/claims\/(\d+)$/.exec(p);
   if(method==='PATCH'&&claimMatch){role(user,['admin','manager','support']);const id=integer(claimMatch[1],'Claim');const b=await parseBody(req);if(!['RECEIVED','INSPECTED','REPAIRED','REPLACED','RETURNED','REJECTED'].includes(b.status))throw bad('Invalid claim status.');const result=db.prepare('UPDATE warranty_claims SET status=?,resolution=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(b.status,text(b.resolution,500),id);if(!result.changes)throw bad('Claim not found.',404);audit(user.id,'WARRANTY_CLAIM_UPDATE',`claim:${id}`,b.status);return ok({ok:true});}
   if(method==='GET'&&p==='/orders'){
     role(user,['admin','manager','cashier','support','warehouse']);return ok({orders:db.prepare('SELECT d.*,s.receipt_no,s.sale_type,s.total_paisa,s.paid_paisa,s.due_paisa,s.status sale_status,s.created_at,c.name customer_name,c.phone customer_phone,c.address FROM deliveries d JOIN sales s ON s.id=d.sale_id LEFT JOIN customers c ON c.id=s.customer_id ORDER BY s.id DESC LIMIT 250').all()});
   }
   const deliveryMatch=/^\/orders\/(\d+)$/.exec(p);
   if(method==='PATCH'&&deliveryMatch){role(user,['admin','manager','warehouse','support']);const sid=integer(deliveryMatch[1],'Order');const b=await parseBody(req);if(!['NEW','CONFIRMED','PACKED','DISPATCHED','DELIVERED','FAILED','CANCELLED'].includes(b.status))throw bad('Invalid delivery status.');if(!db.prepare('SELECT sale_id FROM deliveries WHERE sale_id=?').get(sid))throw bad('Delivery order not found.',404);
     db.prepare('UPDATE deliveries SET verified=?,status=?,courier=?,tracking=?,rider=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE sale_id=?').run(b.verified?1:0,b.status,text(b.courier,80),text(b.tracking,120),text(b.rider,90),text(b.notes,500),sid);audit(user.id,'DELIVERY_UPDATE',`sale:${sid}`,b.status);return ok({ok:true});}
   const collectMatch=/^\/orders\/(\d+)\/collect$/.exec(p);
   if(method==='POST'&&collectMatch){role(user,['admin','manager']);const id=integer(collectMatch[1],'Order');const b=await parseBody(req);const amt=money(b.amount,'Collection amount');const ref=str(b.reference,'Courier or bank reference',120);if(amt<=0)throw bad('Amount must be greater than zero.');
     const result=transaction(()=>{const s=saleDetails(id);if(!db.prepare('SELECT sale_id FROM deliveries WHERE sale_id=?').get(id))throw bad('Delivery order not found.');if(s.due_paisa<amt)throw bad('Collection exceeds outstanding amount.');
       db.prepare("INSERT INTO payments(sale_id,method,amount_paisa,tendered_paisa,reference) VALUES(?,'COD Remittance',?,?,?)").run(id,amt,amt,ref);
       db.prepare('UPDATE sales SET paid_paisa=paid_paisa+?,due_paisa=due_paisa-?,tendered_paisa=tendered_paisa+?,status=? WHERE id=?').run(amt,amt,amt,amt===s.due_paisa?'PAID':s.status,id);
       audit(user.id,'COD_REMITTANCE',`sale:${id}`,`${amt} / ${ref}`);return {due_paisa:s.due_paisa-amt};
     });return ok(result);
   }
   if(method==='GET'&&p==='/promotions'){
     role(user,['admin','manager']);return ok({promotions:db.prepare('SELECT * FROM promotions ORDER BY id DESC LIMIT 200').all()});
   }
   if(method==='POST'&&p==='/promotions'){
     role(user,['admin','manager']);const b=await parseBody(req);const code=str(b.code,'Code',40).replace(/\s/g,'').toUpperCase();if(!/^[A-Z0-9_-]{3,40}$/.test(code))throw bad('Code must use letters, numbers, underscores or hyphens.');
     if(!['percent','fixed'].includes(b.kind))throw bad('Invalid promotion type.');const val=b.kind==='percent'?Number(b.value):money(b.value,'Discount');if(!Number.isFinite(val)||val<=0||(b.kind==='percent'&&val>100))throw bad('Invalid discount amount.');
     const validFrom=text(b.valid_from,10)||null,validTo=text(b.valid_to,10)||null;if(validFrom&&validTo&&validFrom>validTo)throw bad('End date must be after start date.');
     const id=Number(db.prepare('INSERT INTO promotions(code,kind,value,minimum_paisa,usage_limit,valid_from,valid_to) VALUES(?,?,?,?,?,?,?)').run(code,b.kind,String(b.value),money(b.minimum??'0','Minimum bill'),integer(b.usage_limit??0,'Usage limit',0,1000000),validFrom,validTo).lastInsertRowid);audit(user.id,'PROMO_CREATE',`promo:${id}`,code);return ok({id},201);
   }
   const promotionMatch=/^\/promotions\/(\d+)$/.exec(p);
   if(method==='PATCH'&&promotionMatch){role(user,['admin','manager']);const id=integer(promotionMatch[1],'Promotion');const b=await parseBody(req);const result=db.prepare('UPDATE promotions SET active=? WHERE id=?').run(b.active?1:0,id);if(!result.changes)throw bad('Promotion not found.',404);audit(user.id,'PROMO_CHANGE',`promo:${id}`,b.active?'activated':'deactivated');return ok({ok:true});}
   if(method==='GET'&&p==='/promo-check'){const code=str(url.searchParams.get('code'),'Code',40).toUpperCase();const subtotal=money(url.searchParams.get('subtotal')??'0','Subtotal');const item=promo(code,subtotal);return ok({code:item.promotion.code,discount_paisa:item.discount});}
   if(method==='GET'&&p==='/stock-counts'){
     role(user,['admin','manager','warehouse']);return ok({counts:db.prepare('SELECT sc.*,l.name location_name,u.username FROM stock_counts sc JOIN locations l ON l.id=sc.location_id JOIN users u ON u.id=sc.created_by ORDER BY sc.id DESC LIMIT 100').all()});
   }
   if(method==='POST'&&p==='/stock-counts'){
     role(user,['admin','manager']);const b=await parseBody(req),lid=integer(b.location_id,'Location');if(![1,2,3].includes(lid))throw bad('Invalid location.');const id=transaction(()=>{const id=Number(db.prepare('INSERT INTO stock_counts(location_id,notes,created_by) VALUES(?,?,?)').run(lid,text(b.notes,250),user.id).lastInsertRowid);
       db.prepare('INSERT INTO stock_count_items(count_id,product_id,expected_qty) SELECT ?,p.id,COALESCE(s.qty,0) FROM products p LEFT JOIN stock s ON s.product_id=p.id AND s.location_id=? WHERE p.is_active=1').run(id,lid);
       audit(user.id,'STOCK_COUNT_OPEN',`count:${id}`);return id;});return ok({id},201);
   }
   const countMatch=/^\/stock-counts\/(\d+)$/.exec(p);
   if(method==='GET'&&countMatch){role(user,['admin','manager','warehouse']);const id=integer(countMatch[1],'Stock count');const c=db.prepare('SELECT sc.*,l.name location_name FROM stock_counts sc JOIN locations l ON l.id=sc.location_id WHERE sc.id=?').get(id);if(!c)throw bad('Count not found.',404);return ok({count:c,items:db.prepare('SELECT sci.*,p.sku,p.name FROM stock_count_items sci JOIN products p ON p.id=sci.product_id WHERE sci.count_id=? ORDER BY p.name').all(id)});}
   const finalize=/^\/stock-counts\/(\d+)\/finalize$/.exec(p);
   if(method==='POST'&&finalize){role(user,['admin','manager']);const id=integer(finalize[1],'Stock count'),b=await parseBody(req);if(!Array.isArray(b.items))throw bad('Submit all counted quantities.');const changed=transaction(()=>{const c=db.prepare('SELECT * FROM stock_counts WHERE id=?').get(id);if(!c||c.status!=='OPEN')throw bad('Count is missing or already completed.');
       const it=db.prepare('SELECT * FROM stock_count_items WHERE count_id=?').all(id);const map=new Map(b.items.map(i=>[Number(i.product_id),i.counted_qty]));if(map.size!==it.length)throw bad('All count lines must be provided.');let changed=0;
       for(const row of it){const number=integer(map.get(row.product_id),'Counted quantity',0,1000000);db.prepare('INSERT OR IGNORE INTO stock(product_id,location_id,qty) VALUES(?,?,0)').run(row.product_id,c.location_id);
         const current=db.prepare('SELECT qty FROM stock WHERE product_id=? AND location_id=?').get(row.product_id,c.location_id).qty;
         if(current!==row.expected_qty)throw bad('Stock changed since this count was opened. Start a new count for accurate reconciliation.');
         const delta=number-current;db.prepare('UPDATE stock_count_items SET counted_qty=? WHERE id=?').run(number,row.id);
         if(delta){changed++;db.prepare('UPDATE stock SET qty=? WHERE product_id=? AND location_id=?').run(number,row.product_id,c.location_id);
           db.prepare('INSERT INTO stock_movements(product_id,location_id,delta,kind,reason,user_id) VALUES(?,?,?,?,?,?)').run(row.product_id,c.location_id,delta,'CYCLE_COUNT',`Count #${id}`,user.id);}
       }
       db.prepare("UPDATE stock_counts SET status='COMPLETED',completed_at=CURRENT_TIMESTAMP WHERE id=?").run(id);audit(user.id,'STOCK_COUNT_COMPLETE',`count:${id}`,`${changed} adjusted SKUs`);return changed;
     });return ok({changed});
   }
   const customerMatch=/^\/customers\/(\d+)$/.exec(p);
   if(method==='PATCH'&&customerMatch){role(user,['admin','manager','support']);const id=integer(customerMatch[1],'Customer');exists('customers',id);const b=await parseBody(req);db.prepare('UPDATE customers SET name=?,phone=?,email=?,city=?,address=?,notes=? WHERE id=?').run(str(b.name,'Customer name',120),text(b.phone,35)||null,text(b.email,160),text(b.city,100),text(b.address,250),text(b.notes,400),id);audit(user.id,'CUSTOMER_EDIT',`customer:${id}`);return ok({ok:true});}
   if(method==='GET'&&p==='/customer-credits'){
     role(user,['admin','manager','cashier','support']);return ok({credits:db.prepare('SELECT c.id,c.name,c.phone,COALESCE(SUM(l.delta_paisa),0) balance_paisa FROM customers c LEFT JOIN credit_ledger l ON l.customer_id=c.id GROUP BY c.id ORDER BY balance_paisa DESC,c.name LIMIT 250').all()});
   }
   if(method==='GET'&&p==='/audit'){
     role(user,['admin']);return ok({logs:db.prepare('SELECT a.*,u.username FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 250').all()});
   }
   if(method==='GET'&&p==='/integrations'){
     role(user,['admin']);return ok({integrations:[{name:'Shopify products, stock & orders',status:'NOT_CONNECTED',note:'Requires authorized Shopify Admin API access and stock-conflict policy.'},{name:'FBR POS invoice validation',status:'NOT_CONNECTED',note:'Requires FBR onboarding and approved integration details; test receipts are not tax invoices.'},{name:'Leopard courier',status:'MANUAL',note:'Tracking and delivery statuses can be entered manually; booking API is not connected.'},{name:'WhatsApp Business',status:'NOT_CONNECTED',note:'Requires Meta Business setup, approved templates and credentials.'},{name:'Cloud + offline sync',status:'STAGING_MIRROR',note:'Durable sale events and operational snapshots feed a read-only owner portal when a cloud host is configured. NOT a two-way inventory sync.'}]});
   }
   if(method==='GET'&&p==='/backups'){
     role(user,['admin']);const files=fs.readdirSync(backups).filter(f=>/^flexico-backup-\d{8}-\d{6}\.sqlite$/.test(f)).sort().reverse().slice(0,30);
     return ok({backups:files.map(f=>({name:f,size:fs.statSync(path.join(backups,f)).size}))});
   }
   if(method==='POST'&&p==='/backups'){
     role(user,['admin']);const at=new Date();const stamp=at.toISOString().slice(0,10).replaceAll('-','')+'-'+at.toISOString().slice(11,19).replaceAll(':','');const file=`flexico-backup-${stamp}.sqlite`;const dest=path.join(backups,file);await backup(db,dest);
     const all=fs.readdirSync(backups).filter(f=>/^flexico-backup-\d{8}-\d{6}\.sqlite$/.test(f)).sort().reverse();for(const old of all.slice(30))fs.unlinkSync(path.join(backups,old));audit(user.id,'BACKUP_CREATE','database',file);return ok({file,location:'data\\backups\\'+file,size:fs.statSync(dest).size});
   }
   if(method==='POST'&&p==='/products/import'){
     role(user,['admin','manager']);const b=await parseBody(req);if(!Array.isArray(b.products)||b.products.length>500||!b.products.length)throw bad('Upload 1–500 CSV rows per batch.');const summary=transaction(()=>{let inserted=0,skipped=0;
       for(const line of b.products){const sku=str(line.sku,'SKU',45).toUpperCase();if(db.prepare('SELECT id FROM products WHERE sku=?').get(sku)){skipped++;continue;}
         const name=str(line.name,'Name',180),price=money(line.price,'Price'),cost=money(line.cost||'0','Cost');
         db.prepare('INSERT INTO products(sku,barcode,name,brand,category,variant,price_paisa,cost_paisa,threshold) VALUES(?,?,?,?,?,?,?,?,?)').run(sku,text(line.barcode,80)||null,name,text(line.brand,80),text(line.category,80),text(line.variant,80),price,cost,integer(line.threshold??5,'Threshold',0,100000));inserted++;
       }audit(user.id,'PRODUCT_CSV_IMPORT','products',`inserted ${inserted}, skipped ${skipped}`);return {inserted,skipped};});return ok(summary);
   }
   const imageMatch=/^\/products\/(\d+)\/image$/.exec(p);
   if(method==='POST'&&imageMatch){role(user,['admin','manager']);const pid=integer(imageMatch[1],'Product');exists('products',pid);const b=await parseBody(req),value=String(b.image||'');const match=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(value);if(!match)throw bad('Only JPG/PNG/WEBP images are accepted.');const data=Buffer.from(match[2],'base64');if(data.length>250000||data.length<10)throw bad('Image should be under 250 KB.');const ext=match[1]==='jpeg'?'jpg':match[1];const magic=ext==='jpg'?data[0]===255&&data[1]===216:ext==='png'?data.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP';if(!magic)throw bad('Image data is invalid.');
     const filename=`fx-${pid}-${crypto.randomBytes(6).toString('hex')}.${ext}`;fs.writeFileSync(path.join(uploads,filename),data,{flag:'wx'});const old=db.prepare('SELECT image_path FROM products WHERE id=?').get(pid).image_path;db.prepare('UPDATE products SET image_path=? WHERE id=?').run('/uploads/'+filename,pid);if(old&&/^\/uploads\/fx-[\w.-]+$/.test(old))try{fs.unlinkSync(path.join(uploads,path.basename(old)));}catch{}
     audit(user.id,'PRODUCT_IMAGE',`product:${pid}`);return ok({path:'/uploads/'+filename});
   }
   return null;
 }
 async function autoBackup(){if(!db.prepare('SELECT COUNT(*) n FROM users').get().n)return null;
   const newest=fs.readdirSync(backups).filter(f=>/^flexico-backup-\d{8}-\d{6}\.sqlite$/.test(f)).sort().at(-1);
   if(newest&&Date.now()-fs.statSync(path.join(backups,newest)).mtimeMs<24*3600*1000)return null;
   const at=new Date(),stamp=at.toISOString().slice(0,10).replaceAll('-','')+'-'+at.toISOString().slice(11,19).replaceAll(':','');
   const file='flexico-backup-'+stamp+'.sqlite';await backup(db,path.join(backups,file));
   const files=fs.readdirSync(backups).filter(f=>/^flexico-backup-\d{8}-\d{6}\.sqlite$/.test(f)).sort().reverse();
   for(const f of files.slice(30))fs.unlinkSync(path.join(backups,f));return file;
 }
 return {route,onSale,promo,credit,autoBackup};
}
module.exports={install,create};
