-- Flexico POS v0.4: PostgreSQL read-only sales mirror, NOT the production inventory ledger.
CREATE TABLE IF NOT EXISTS mirror_events (
  store_id text NOT NULL,
  device_id uuid NOT NULL,
  event_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type = 'sale.created'),
  payload_sha256 char(64) NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, event_id)
);
CREATE INDEX IF NOT EXISTS mirror_events_received_idx ON mirror_events(store_id, received_at DESC);
CREATE TABLE IF NOT EXISTS mirror_sales (
  store_id text NOT NULL,
  device_id uuid NOT NULL,
  event_id uuid NOT NULL,
  local_sale_id bigint NOT NULL,
  receipt_no text NOT NULL,
  created_at timestamptz NOT NULL,
  sale_type text NOT NULL,
  status text NOT NULL,
  cashier text NOT NULL,
  customer_name text NOT NULL,
  total_paisa bigint NOT NULL CHECK (total_paisa >= 0),
  paid_paisa bigint NOT NULL CHECK (paid_paisa >= 0),
  due_paisa bigint NOT NULL CHECK (due_paisa >= 0),
  tax_paisa bigint NOT NULL CHECK (tax_paisa >= 0),
  items jsonb NOT NULL,
  payments jsonb NOT NULL,
  mirrored_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, device_id, local_sale_id),
  UNIQUE (store_id, event_id),
  FOREIGN KEY (store_id, event_id) REFERENCES mirror_events(store_id, event_id)
);
CREATE INDEX IF NOT EXISTS mirror_sales_created_idx ON mirror_sales(store_id, created_at DESC);

-- v1.0 owner projection: absolute state per single store device.
ALTER TABLE mirror_events DROP CONSTRAINT IF EXISTS mirror_events_event_type_check;
ALTER TABLE mirror_events ADD CONSTRAINT mirror_events_event_type_check
  CHECK (event_type IN ('sale.created','ops.snapshot'));
CREATE TABLE IF NOT EXISTS mirror_ops (
  store_id text NOT NULL,device_id uuid NOT NULL,version bigint NOT NULL CHECK(version>0),
  payload jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(store_id,device_id)
);
CREATE TABLE IF NOT EXISTS owner_sessions(
  token_hash char(64) PRIMARY KEY,expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS owner_sessions_expires_idx ON owner_sessions(expires_at);

CREATE TABLE IF NOT EXISTS mirror_device_registration(
 store_id text PRIMARY KEY,device_id uuid NOT NULL,claimed_at timestamptz NOT NULL DEFAULT now()
);
