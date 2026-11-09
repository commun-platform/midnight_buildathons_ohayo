ALTER TABLE condition_readings ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chain_jobs ADD COLUMN accepted_at TEXT;
