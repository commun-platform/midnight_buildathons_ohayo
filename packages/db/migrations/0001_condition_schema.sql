CREATE TABLE rings (
  id          TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  owner_label TEXT NOT NULL DEFAULT 'vendor',
  status      TEXT NOT NULL DEFAULT 'pooled' CHECK (status IN ('pooled', 'deployed', 'retired', 'lost')),
  created_at  TEXT NOT NULL
);

CREATE TABLE ring_worker_map (
  ring_id   TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  from_ts   TEXT NOT NULL,
  to_ts     TEXT,
  PRIMARY KEY (ring_id, from_ts)
);

CREATE INDEX ring_worker_map_worker ON ring_worker_map (worker_id);

CREATE TABLE workers (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE TABLE worker_pii (
  worker_id TEXT PRIMARY KEY,
  name      TEXT NOT NULL
);

CREATE TABLE condition_readings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ring_id        TEXT NOT NULL,
  recorded_at    TEXT NOT NULL,
  value          REAL NOT NULL CHECK (value >= 0 AND value <= 100),
  source         TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('partner_api', 'manual')),
  entered_by     TEXT,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'submitted', 'skipped', 'failed')),
  skip_reason    TEXT CHECK (skip_reason IN ('already_submitted', 'unknown_ring', 'invalid_value', 'value_superseded', 'ring_unassigned', 'wearer_unknown', 'off_site', 'ambiguous_wearer')),
  external_id    TEXT UNIQUE,
  partner_sig    TEXT,
  last_error     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX condition_readings_ring ON condition_readings (ring_id, recorded_at);
CREATE INDEX condition_readings_status ON condition_readings (status);

CREATE TABLE partner_sync (
  source    TEXT PRIMARY KEY,
  cursor    TEXT NOT NULL,
  synced_at TEXT NOT NULL
);

CREATE TABLE submissions (
  entry_key            TEXT PRIMARY KEY,
  ring_id              TEXT NOT NULL,
  period_start_ms      INTEGER NOT NULL,
  timezone             TEXT NOT NULL,
  recorded_at_ms       INTEGER NOT NULL,
  band                 TEXT NOT NULL,
  score_commitment_hex TEXT NOT NULL,
  salt_ref             TEXT,
  deployment_id        TEXT,
  submitted_by         TEXT,
  tx_id                TEXT,
  tx_hash              TEXT,
  block_height         TEXT,
  submitted_at         TEXT NOT NULL,
  chain_verified_at    TEXT,
  reconciled_at        TEXT,
  opening_ciphertext   TEXT
);

CREATE INDEX submissions_ring_period ON submissions (ring_id, period_start_ms);

CREATE TABLE salt_epochs (
  id         TEXT PRIMARY KEY,
  salt_hash  TEXT NOT NULL,
  from_ms    INTEGER NOT NULL,
  to_ms      INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE contract_deployments (
  id          TEXT PRIMARY KEY,
  network     TEXT NOT NULL,
  address     TEXT NOT NULL,
  deployed_at TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE audit_log (
  id            TEXT PRIMARY KEY,
  actor_user_id TEXT,
  action        TEXT NOT NULL,
  target_table  TEXT NOT NULL,
  target_id     TEXT NOT NULL,
  before_json   TEXT,
  after_json    TEXT,
  ts            TEXT NOT NULL
);

CREATE INDEX audit_log_target ON audit_log (target_table, target_id);

CREATE TABLE work_decisions (
  id              TEXT PRIMARY KEY,
  worker_id       TEXT NOT NULL,
  period_start_ms INTEGER NOT NULL,
  entry_key       TEXT,
  band            TEXT,
  decision        TEXT NOT NULL CHECK (decision IN ('worked', 'light_duty', 'rested')),
  reason          TEXT NOT NULL,
  decided_by      TEXT NOT NULL,
  decided_at      TEXT NOT NULL,
  supersedes_id   TEXT REFERENCES work_decisions (id)
);

CREATE INDEX work_decisions_worker_period ON work_decisions (worker_id, period_start_ms);
CREATE UNIQUE INDEX work_decisions_one_root ON work_decisions (worker_id, period_start_ms) WHERE supersedes_id IS NULL;
CREATE UNIQUE INDEX work_decisions_one_successor ON work_decisions (supersedes_id) WHERE supersedes_id IS NOT NULL;

CREATE TRIGGER work_decisions_no_update BEFORE UPDATE ON work_decisions BEGIN SELECT RAISE(ABORT, 'work_decisions is append-only'); END;
CREATE TRIGGER work_decisions_no_delete BEFORE DELETE ON work_decisions BEGIN SELECT RAISE(ABORT, 'work_decisions is append-only'); END;

CREATE TABLE wallet_bindings (
  id         TEXT PRIMARY KEY,
  key_hash   TEXT NOT NULL,
  worker_id  TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE UNIQUE INDEX wallet_bindings_active_key ON wallet_bindings (key_hash) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX wallet_bindings_active_worker ON wallet_bindings (worker_id) WHERE revoked_at IS NULL;

CREATE TABLE worker_invites (
  code_hash  TEXT PRIMARY KEY,
  worker_id  TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_by TEXT NOT NULL
);

CREATE TABLE auth_challenges (
  id          TEXT PRIMARY KEY,
  message     TEXT NOT NULL,
  invite_hash TEXT,
  expires_at  TEXT NOT NULL,
  used_at     TEXT
);

CREATE TABLE guest_sessions (
  id         TEXT PRIMARY KEY,
  worker_id  TEXT NOT NULL,
  ring_id    TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
