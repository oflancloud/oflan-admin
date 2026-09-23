CREATE TABLE IF NOT EXISTS bf_sequences (
  mode TEXT NOT NULL CHECK(mode IN ('test','live')),
  day TEXT NOT NULL,
  seq INTEGER NOT NULL,
  PRIMARY KEY(mode, day)
);
CREATE TABLE IF NOT EXISTS bf_orders (
  mode TEXT NOT NULL CHECK(mode IN ('test','live')),
  order_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  value INTEGER NOT NULL CHECK(value > 0),
  day TEXT NOT NULL,
  event_time INTEGER NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  dataset_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PENDING','SENDING','SUCCESS','FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  last_sent_at TEXT,
  result TEXT,
  PRIMARY KEY(mode, order_id)
);
CREATE INDEX IF NOT EXISTS bf_history ON bf_orders(mode, day, event_time);
