'use strict';
// Local-first, single-device cloud sales MIRROR foundation.
// The local SQLite transaction is the source of truth during this pilot.
// This does NOT implement multi-terminal stock reservations / 2-way inventory sync.
const crypto = require('node:crypto');
const ops = require('./ops-snapshot');

const STORE = process.env.FLEXICO_STORE_ID || 'flexico-main';
const CLOUD_URL = (process.env.FLEXICO_CLOUD_SYNC_URL || '').trim();
const CLOUD_TOKEN = (process.env.FLEXICO_CLOUD_TOKEN || '').trim();
const MAX_BATCH = 25;
const RETRY_BASE_MS = 5000;

function install(db, getSale) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_outbox (
      id INTEGER PRIMARY KEY,
      event_id TEXT NOT NULL UNIQUE,
      sale_id INTEGER NOT NULL UNIQUE REFERENCES sales(id),
      payload_json TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','SYNCED')),
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_ms INTEGER NOT NULL DEFAULT 0,
      last_error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      synced_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sync_outbox_due ON sync_outbox(state,next_attempt_ms,id);
    CREATE TABLE IF NOT EXISTS sync_installation (id INTEGER PRIMARY KEY CHECK(id=1), device_id TEXT NOT NULL UNIQUE);
  `);
  db.prepare('INSERT OR IGNORE INTO sync_installation (id,device_id) VALUES(1,?)').run(crypto.randomUUID());
  const deviceId = db.prepare('SELECT device_id FROM sync_installation WHERE id=1').get().device_id;
  let running = false;
  let lastRun = null;
  let lastError = '';
  const configured = !!(CLOUD_URL && CLOUD_TOKEN && STORE);

  function snapshot(saleId) {
    const s = getSale(saleId);
    return {
      receipt_no: s.receipt_no,
      local_sale_id: s.id,
      created_at: s.created_at,
      sale_type: s.sale_type,
      status: s.status,
      cashier: s.cashier,
      customer_name: s.customer_name || '',
      subtotal_paisa: s.subtotal_paisa,
      discount_paisa: s.discount_paisa,
      tax_paisa: s.tax_paisa,
      total_paisa: s.total_paisa,
      paid_paisa: s.paid_paisa,
      due_paisa: s.due_paisa,
      tendered_paisa: s.tendered_paisa,
      change_paisa: s.change_paisa,
      items: s.items.map(x=>({ sku:x.sku, name:x.name, qty:x.qty,
        unit_price_paisa:x.unit_price_paisa, line_total_paisa:x.line_total_paisa })),
      payments: s.payments.map(x=>({method:x.method,amount_paisa:x.amount_paisa,
        tendered_paisa:x.tendered_paisa}))
    };
  }
  // Must be called from INSIDE the same SQLite transaction as a new sale.
  function enqueueSale(saleId) {
    const existing = db.prepare('SELECT event_id FROM sync_outbox WHERE sale_id=?').get(saleId);
    if (existing) return existing.event_id;
    const eventId = crypto.randomUUID();
    db.prepare('INSERT INTO sync_outbox(event_id,sale_id,payload_json) VALUES(?,?,?)')
      .run(eventId, saleId, JSON.stringify(snapshot(saleId)));
    return eventId;
  }
  // Existing v0.3 sales become pending sync events. Safe if upgrade is interrupted.
  function backfill() {
    for (const s of db.prepare('SELECT s.id FROM sales s LEFT JOIN sync_outbox o ON o.sale_id=s.id WHERE o.id IS NULL ORDER BY s.id').all()) {
      enqueueSale(s.id);
    }
  }
  backfill();
  ops.install(db);

  function status() {
    ops.enqueueIfDirty(db);
    const counts = db.prepare(`SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN state='PENDING' THEN 1 ELSE 0 END),0) AS pending,
      COALESCE(SUM(CASE WHEN state='SYNCED' THEN 1 ELSE 0 END),0) AS synced,
      COALESCE(SUM(CASE WHEN state='PENDING' AND attempts>0 THEN 1 ELSE 0 END),0) AS retries
      FROM sync_outbox`).get();
    const latest = db.prepare("SELECT synced_at FROM sync_outbox WHERE state='SYNCED' ORDER BY synced_at DESC LIMIT 1").get();
    const opsStatus=db.prepare("SELECT COUNT(*) total, SUM(CASE WHEN state='PENDING' THEN 1 ELSE 0 END) pending FROM ops_sync_outbox").get();
    return { owner_url:configured?new URL(CLOUD_URL).origin+'/owner/':null, ops_pending:opsStatus.pending||0, ops_total:opsStatus.total||0, mode:'single-device-cloud-owner-mirror', configured, device_id:deviceId, store_id:STORE,
      ...counts, busy:running, last_sync_at:latest?.synced_at||null,
      last_attempt_at:lastRun, last_error:lastError||db.prepare("SELECT last_error FROM sync_outbox WHERE state='PENDING' AND last_error<>'' ORDER BY id DESC LIMIT 1").get()?.last_error||'' };
  }

  function validateUrl() {
    let parsed;
    try { parsed = new URL(CLOUD_URL); } catch { throw new Error('Invalid FLEXICO_CLOUD_SYNC_URL.'); }
    const local = ['127.0.0.1','localhost','[::1]'].includes(parsed.hostname);
    const allowedHttp = process.env.FLEXICO_ALLOW_HTTP_SYNC === '1' && local;
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && allowedHttp))
      throw new Error('Cloud sync requires HTTPS (HTTP allowed only for localhost test with explicit flag).');
    if (parsed.username || parsed.password || parsed.hash) throw new Error('Cloud sync URL must not contain credentials or a fragment.');
    return parsed.toString();
  }

  async function syncOnce({force=false}={}) {
    if (!configured) return { ...status(), message:'Cloud sync is not configured. Local sales are safe in the SQLite queue.' };
    if (running) return { ...status(), message:'Sync already in progress.' };
    const url = validateUrl();
    let kind='sale';
    running = true;
    lastRun = new Date().toISOString();
    try {
      ops.enqueueIfDirty(db);
      const sales = db.prepare(`SELECT * FROM sync_outbox WHERE state='PENDING' AND (next_attempt_ms<=? OR ?=1)
        ORDER BY id LIMIT ?`).all(Date.now(),force?1:0,MAX_BATCH);
      const opsRows = sales.length ? [] : db.prepare(`SELECT * FROM ops_sync_outbox WHERE state='PENDING' AND (next_attempt_ms<=? OR ?=1)
        ORDER BY id LIMIT 1`).all(Date.now(),force?1:0);
      const rows = sales.length ? sales : opsRows;
      kind=sales.length?'sale':'ops';
      if (!rows.length) return { ...status(), message:'Nothing due to sync.' };
      const events = rows.map(r=>({ event_id:r.event_id, schema_version:1,
        event_type:kind==='sale'?'sale.created':'ops.snapshot', payload:JSON.parse(r.payload_json) }));
      const controller = new AbortController();
      const timer = setTimeout(()=>controller.abort(),12000);
      let result;
      try {
        const response = await fetch(url,{method:'POST',redirect:'error',signal:controller.signal,
          headers:{'Authorization':`Bearer ${CLOUD_TOKEN}`,'Content-Type':'application/json', 'Accept':'application/json'},
          body:JSON.stringify({store_id:STORE,device_id:deviceId,events})});
        if (!response.ok) throw new Error(`Cloud rejected sync: HTTP ${response.status}`);
        result = await response.json();
      } finally {clearTimeout(timer);}
      if (!Array.isArray(result.acknowledged)) throw new Error('Invalid cloud acknowledgement.');
      const valid = new Set(rows.map(r=>r.event_id));
      const acknowledged = new Set(result.acknowledged);
      for(const id of acknowledged) if(!valid.has(id)) throw new Error('Cloud acknowledged an unknown event.');
      if(acknowledged.size!==rows.length) throw new Error('Cloud acknowledged only part of the batch; retrying safely.');
      const stamp=new Date().toISOString();
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const r of rows) db.prepare(`UPDATE ${kind==='sale'?'sync_outbox':'ops_sync_outbox'} SET state='SYNCED',synced_at=?,last_error='' WHERE event_id=? AND state='PENDING'`).run(stamp,r.event_id);
        db.exec('COMMIT');
      } catch(e) {db.exec('ROLLBACK');throw e;}
      lastError='';
      return { ...status(), message:`Cloud acknowledged ${acknowledged.size} ${kind==='sale'?'sale':'operational snapshot'} event(s).` };
    } catch(e) {
      lastError=String(e.message||e).slice(0,230);
      const now=Date.now();
      const table=kind==='ops'?'ops_sync_outbox':'sync_outbox';
      const due=db.prepare(`SELECT id,attempts FROM ${table} WHERE state='PENDING' AND (next_attempt_ms<=? OR ?=1) ORDER BY id LIMIT ?`)
        .all(now,force?1:0,MAX_BATCH);
      for (const r of due) {
        const wait=Math.min(300000, RETRY_BASE_MS*(2**Math.min(r.attempts,6)));
        db.prepare(`UPDATE ${table} SET attempts=attempts+1,next_attempt_ms=?,last_error=? WHERE id=?`)
          .run(now+wait,lastError,r.id);
      }
      return { ...status(), message:'Sync failed; queued sales will be retried automatically.' };
    } finally {running=false;}
  }
  function start() {
    if(!configured) return;
    // Network sync must not block cashier operations or the Node process from exiting.
    const tick = () => {syncOnce().catch(e=>console.error('Hybrid sync:',e.message));};
    setTimeout(tick,2500).unref();
    setInterval(tick,30000).unref();
  }
  return { enqueueSale, status, syncOnce, start };
}
module.exports={install};
