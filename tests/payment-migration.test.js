'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const net=require('node:net');const {spawn}=require('node:child_process');const {DatabaseSync}=require('node:sqlite');
const ROOT=path.resolve(__dirname,'..');
test('Opening an older pilot database adds tendered/change fields and keeps previous payment values',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'flexico-migrate-'));const dbPath=path.join(dir,'legacy.sqlite');
 const db=new DatabaseSync(dbPath);
 db.exec(`
 CREATE TABLE sales (
  id INTEGER PRIMARY KEY, receipt_no TEXT UNIQUE, client_request_id TEXT UNIQUE NOT NULL,
  sale_type TEXT NOT NULL, customer_id INTEGER,
  subtotal_paisa INTEGER NOT NULL, discount_paisa INTEGER NOT NULL, tax_paisa INTEGER NOT NULL,
  total_paisa INTEGER NOT NULL, paid_paisa INTEGER NOT NULL, due_paisa INTEGER NOT NULL,
  status TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 );
 CREATE TABLE payments (
  id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL, method TEXT NOT NULL,
  amount_paisa INTEGER NOT NULL, reference TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 );
 INSERT INTO sales(client_request_id,sale_type,subtotal_paisa,discount_paisa,tax_paisa,total_paisa,paid_paisa,due_paisa,status,user_id)
 VALUES('old-receipt','in_store',129900,0,0,129900,129900,0,'PAID',1);
 INSERT INTO payments(sale_id,method,amount_paisa) VALUES (1,'Cash',129900);
 `);db.close();
 const port=await new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
 const child=spawn(process.execPath,['server.js'],{cwd:ROOT,env:{...process.env,PORT:String(port),FLEXICO_DB:dbPath},stdio:['ignore','pipe','pipe']});
 let errors='';child.stdout.on('data',x=>errors+=x);child.stderr.on('data',x=>errors+=x);
 t.after(async()=>{child.kill();await new Promise(r=>{if(child.exitCode!==null||child.signalCode!==null)return r();child.once('exit',r);setTimeout(r,1500);});fs.rmSync(dir,{recursive:true,force:true});});
 let ready=false;
 for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('Migration failed: '+errors);try{const res=await fetch(`http://127.0.0.1:${port}/api/bootstrap`);if(res.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,25));}
 assert.ok(ready,errors);
 const migrated=new DatabaseSync(dbPath,{readOnly:true});
 try{
  const sale=migrated.prepare('SELECT tendered_paisa,change_paisa,paid_paisa FROM sales WHERE id=1').get();
  assert.equal(sale.tendered_paisa,129900);assert.equal(sale.change_paisa,0);assert.equal(sale.paid_paisa,129900);
  const payment=migrated.prepare('SELECT tendered_paisa,amount_paisa FROM payments WHERE id=1').get();
  assert.equal(payment.tendered_paisa,129900);assert.equal(payment.amount_paisa,129900);
 }finally{migrated.close();}
});
