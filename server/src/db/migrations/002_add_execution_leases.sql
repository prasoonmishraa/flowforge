ALTER TABLE executions
ADD COLUMN worker_token UUID,
ADD COLUMN locked_until TIMESTAMPTZ,
ADD COLUMN last_heartbeat_at TIMESTAMPTZ;

CREATE INDEX idx_executions_locked_until
ON executions (locked_until)
WHERE status = 'running';