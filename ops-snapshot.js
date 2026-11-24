'use strict';
// A single store device is authoritative. Its transactionally incremented version
// tracks changes across all operational tables; absolute read projections are
// safe to replay, and never masquerade as two-way inventory synchronization.
const crypto=require('node:crypto');
const TRACKED=['products','stock','customers','sales','payments','returns','return_items',
  'credit_ledger','warranties','warranty_claims','deliveries','purchase_orders',
  'purchase_items','supplier_payments','shifts','promotions','suppliers','stock_movements'];
function install(db){
  db.exec(`CREATE TABLE IF NOT EXISTS ops_sync_version (
    id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL DEFAULT 1,
    enqueued_version INTEGER NOT NULL DEFAULT 0
  );
  INSERT OR IGNORE INTO ops_sync_version(id,version,enqueued_version) VALUES(1,1,0);
  CREATE TABLE IF NOT EXISTS ops_sync_outbox (
    id INTEGER PRIMARY KEY, event_id TEXT NOT NULL UNIQUE, version INTEGER NOT NULL UNIQUE,
    payload_json TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'PENDING'
      CHECK(state IN ('PENDING','SYNCED')),
    attempts INTEGER NOT NULL DEFAULT 0, next_attempt_ms INTEGER NOT NULL DEFAULT 0,
    last_error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    synced_at TEXT
  );
  CREATE INDEX IF NOT EXISTS ops_outbox_due ON ops_sync_outbox(state,next_attempt_ms,id);
  `);
  for(const table of TRACKED) {
    for(const [op,suffix] of [['INSERT','insert'],['UPDATE','update'],['DELETE','delete']]){
      db.exec(`CREATE TRIGGER IF NOT EXISTS ops_dirty_${table}_${suffix} AFTER ${op} ON ${table}
        BEGIN UPDATE ops_sync_version SET version=version+1 WHERE id=1; END;`);
    }
  }
}
const sum=(db,query,...args)=>Number(db.prepare(query).get(...args)?.n||0);
function snapshot(db,version){
  const statistics={
    sales_count:sum(db,'SELECT COUNT(*) n FROM sales'),
    sales_total_paisa:sum(db,'SELECT COALESCE(SUM(total_paisa),0) n FROM sales'),
    collected_paisa:sum(db,'SELECT COALESCE(SUM(paid_paisa),0) n FROM sales'),
    outstanding_paisa:sum(db,'SELECT COALESCE(SUM(due_paisa),0) n FROM sales'),
    refunds_paisa:sum(db,'SELECT COALESCE(SUM(refund_paisa),0) n FROM returns'),
    stock_units:sum(db,'SELECT COALESCE(SUM(qty),0) n FROM stock WHERE location_id IN (1,2)'),
    products_count:sum(db,'SELECT COUNT(*) n FROM products WHERE is_active=1'),
    customers_count:sum(db,'SELECT COUNT(*) n FROM customers'),
    pending_cod:sum(db,"SELECT COUNT(*) n FROM sales WHERE due_paisa>0 AND sale_type='delivery_cod'"),
    open_claims:sum(db,"SELECT COUNT(*) n FROM warranty_claims WHERE status NOT IN ('RETURNED','REJECTED')"),
    unpaid_suppliers_paisa:sum(db,`SELECT COALESCE(SUM(p.amount),0) n FROM (
       SELECT po.id, MAX(0,COALESCE((SELECT SUM(pi.qty*pi.unit_cost_paisa) FROM purchase_items pi WHERE pi.order_id=po.id),0)+po.shipping_paisa-
         COALESCE((SELECT SUM(sp.amount_paisa) FROM supplier_payments sp WHERE sp.order_id=po.id),0)) amount
       FROM purchase_orders po WHERE po.status<>'CANCELLED') p`),
    low_stock_count:sum(db,`SELECT COUNT(*) n FROM products p WHERE p.is_active=1 AND
      COALESCE((SELECT qty FROM stock WHERE product_id=p.id AND location_id=1),0)<=p.threshold`)
  };
  const stock=db.prepare(`SELECT p.sku,p.name,p.brand,p.category,p.threshold,p.price_paisa,
    COALESCE(a.qty,0) store_qty,COALESCE(b.qty,0) warehouse_qty
    FROM products p LEFT JOIN stock a ON a.product_id=p.id AND a.location_id=1
    LEFT JOIN stock b ON b.product_id=p.id AND b.location_id=2
    WHERE p.is_active=1 ORDER BY CASE WHEN COALESCE(a.qty,0)<=p.threshold THEN 0 ELSE 1 END,p.name LIMIT 200`).all();
  const recent_cod=db.prepare(`SELECT s.receipt_no,s.total_paisa,s.paid_paisa,s.due_paisa,s.created_at,
    d.status delivery_status,d.tracking FROM sales s LEFT JOIN deliveries d ON d.sale_id=s.id
    WHERE s.sale_type='delivery_cod' AND s.due_paisa>0 ORDER BY s.id DESC LIMIT 40`).all();
  const recent_returns=db.prepare(`SELECT r.number,s.receipt_no,r.refund_paisa,r.refund_method,r.created_at
    FROM returns r JOIN sales s ON s.id=r.sale_id ORDER BY r.id DESC LIMIT 40`).all();
  return {version,captured_at:new Date().toISOString(), statistics,stock,recent_cod,recent_returns,
    warning:'Read-only snapshot from the one local store device; it may be stale when offline. Does not confirm Shopify or FBR synchronization.'};
}
function enqueueIfDirty(db){
  const v=db.prepare('SELECT version,enqueued_version FROM ops_sync_version WHERE id=1').get();
  if(v.version<=v.enqueued_version)return false;
  db.exec('BEGIN IMMEDIATE');
  try{
    const latest=db.prepare('SELECT version,enqueued_version FROM ops_sync_version WHERE id=1').get();
    if(latest.version>latest.enqueued_version){
      const p=snapshot(db,latest.version);
      db.prepare('INSERT INTO ops_sync_outbox(event_id,version,payload_json) VALUES(?,?,?)')
        .run(crypto.randomUUID(),latest.version,JSON.stringify(p));
      db.prepare('UPDATE ops_sync_version SET enqueued_version=? WHERE id=1').run(latest.version);
      // Historical not-uploaded snapshots are superseded by absolute state.
      db.prepare("DELETE FROM ops_sync_outbox WHERE state='PENDING' AND version<?").run(latest.version);
    }
    db.exec('COMMIT');return true;
  }catch(e){db.exec('ROLLBACK');throw e;}
}
module.exports={install,enqueueIfDirty,snapshot};
