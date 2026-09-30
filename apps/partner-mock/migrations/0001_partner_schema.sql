CREATE TABLE partner_measurements (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  id          TEXT NOT NULL UNIQUE,
  ring_id     TEXT NOT NULL,
  measured_at TEXT NOT NULL,
  score       REAL NOT NULL CHECK (score >= 0 AND score <= 100),
  vitals_json TEXT,
  origin      TEXT NOT NULL CHECK (origin IN ('device', 'simulate')),
  received_at TEXT NOT NULL
);

CREATE INDEX partner_measurements_ring ON partner_measurements (ring_id, measured_at);
