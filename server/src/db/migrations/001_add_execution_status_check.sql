ALTER TABLE executions
ADD CONSTRAINT executions_status_check
CHECK (status IN ('pending', 'running', 'completed', 'failed'));
