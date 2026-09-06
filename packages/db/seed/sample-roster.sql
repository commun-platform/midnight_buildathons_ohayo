INSERT OR IGNORE INTO rings (id, label, status, created_at) VALUES
  ('ring-1', 'RING-A', 'deployed', '2026-08-01T00:00:00.000Z'),
  ('ring-2', 'RING-B', 'deployed', '2026-08-01T00:00:00.000Z'),
  ('ring-3', 'RING-C', 'deployed', '2026-08-01T00:00:00.000Z');

INSERT OR IGNORE INTO workers (id, created_at) VALUES
  ('worker-1', '2026-08-01T00:00:00.000Z'),
  ('worker-2', '2026-08-01T00:00:00.000Z'),
  ('worker-3', '2026-08-01T00:00:00.000Z');

INSERT OR IGNORE INTO worker_pii (worker_id, name) VALUES
  ('worker-1', '作業員 一郎'),
  ('worker-2', '作業員 二郎'),
  ('worker-3', '職長 三郎');

INSERT OR IGNORE INTO ring_worker_map (ring_id, worker_id, from_ts, to_ts) VALUES
  ('ring-1', 'worker-1', '2026-08-01T00:00:00.000Z', NULL),
  ('ring-2', 'worker-2', '2026-08-01T00:00:00.000Z', NULL),
  ('ring-3', 'worker-3', '2026-08-01T00:00:00.000Z', NULL);
