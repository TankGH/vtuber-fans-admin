-- 全量 schema：一次建表，F3/F4/F5 本期只建不使用业务
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO app_meta(key, value) VALUES ('schema_version', '1');

CREATE TABLE IF NOT EXISTS fan_profile (
  uid TEXT PRIMARY KEY,
  current_nickname TEXT NOT NULL,
  birthday_encrypted BLOB,
  first_interaction_at TEXT,
  guard_anniversary_date TEXT,
  watch_anniversary_date TEXT,
  address_encrypted BLOB,
  address_status TEXT NOT NULL DEFAULT 'none',
  note TEXT NOT NULL DEFAULT '',
  manual_locked_fields TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fan_profile_updated ON fan_profile(updated_at);
CREATE INDEX IF NOT EXISTS idx_fan_profile_nickname ON fan_profile(current_nickname);

CREATE TABLE IF NOT EXISTS fan_nickname_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL REFERENCES fan_profile(uid) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  changed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nickname_history_uid ON fan_nickname_history(uid);

CREATE TABLE IF NOT EXISTS guard_snapshot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_date TEXT NOT NULL UNIQUE,
  room_id TEXT NOT NULL DEFAULT '',
  fetched_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'import',
  raw_response_hash TEXT,
  note TEXT
);

CREATE TABLE IF NOT EXISTS guard_snapshot_member (
  snapshot_id INTEGER NOT NULL REFERENCES guard_snapshot(id) ON DELETE CASCADE,
  uid TEXT NOT NULL,
  nickname TEXT,
  guard_level INTEGER NOT NULL,
  rank INTEGER,
  PRIMARY KEY (snapshot_id, uid)
);
CREATE INDEX IF NOT EXISTS idx_guard_member_uid ON guard_snapshot_member(uid);

CREATE TABLE IF NOT EXISTS guard_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL,
  nickname TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL,
  guard_level INTEGER,
  unit_months INTEGER,
  price_yuan REAL,
  event_at TEXT NOT NULL,
  source TEXT NOT NULL,
  raw_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_guard_event_at ON guard_event(event_at);
CREATE INDEX IF NOT EXISTS idx_guard_event_uid ON guard_event(uid);

CREATE TABLE IF NOT EXISTS import_batch (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  total_rows INTEGER NOT NULL,
  new_count INTEGER NOT NULL,
  merge_count INTEGER NOT NULL,
  skipped_count INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reminder_ack (
  uid TEXT NOT NULL,
  reminder_type TEXT NOT NULL,
  reminder_date TEXT NOT NULL,
  acked_at TEXT,
  PRIMARY KEY (uid, reminder_type, reminder_date)
);
CREATE INDEX IF NOT EXISTS idx_reminder_ack_date ON reminder_ack(reminder_date);

CREATE TABLE IF NOT EXISTS gift_batch (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
);

CREATE TABLE IF NOT EXISTS gift_shipment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES gift_batch(id) ON DELETE CASCADE,
  uid TEXT NOT NULL,
  shipment_status TEXT NOT NULL DEFAULT 'pending',
  tracking_no TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger_entry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_type TEXT NOT NULL,
  category TEXT NOT NULL,
  amount_yuan REAL NOT NULL,
  occurred_at TEXT NOT NULL,
  batch_id INTEGER,
  guard_event_id INTEGER,
  note TEXT
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at);
