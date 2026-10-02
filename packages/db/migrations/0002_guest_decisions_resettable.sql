DROP TRIGGER work_decisions_no_delete;
CREATE TRIGGER work_decisions_no_delete BEFORE DELETE ON work_decisions WHEN OLD.decided_by NOT LIKE 'guest:%' BEGIN SELECT RAISE(ABORT, 'work_decisions is append-only'); END;
