-- Rollback of 0003: removes only the seven added columns. Tasks themselves (title, due date, done flag) stay exactly as they are.
ALTER TABLE wa_tasks DROP COLUMN IF EXISTS status;
ALTER TABLE wa_tasks DROP COLUMN IF EXISTS progress;
ALTER TABLE wa_tasks DROP COLUMN IF EXISTS blocker;
ALTER TABLE wa_tasks DROP COLUMN IF EXISTS source_msg_id;
ALTER TABLE wa_tasks DROP COLUMN IF EXISTS confidence;
ALTER TABLE wa_tasks DROP COLUMN IF EXISTS assigner_contact_id;
ALTER TABLE wa_tasks DROP COLUMN IF EXISTS updated_at;
