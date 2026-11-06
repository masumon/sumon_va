-- 0003: richer task records (progress, blocker, where the task came from, how sure we are). ADDITIVE ONLY. Owner runs this in Supabase.
-- Needs a database backup first. Safe: seven nullable columns on wa_tasks, no existing row changes, old code never reads them.
-- The app/server work with OR without this SQL (without it the progress route answers HTTP 409 and says why).

-- PREFLIGHT (expect: 0 rows)
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'wa_tasks' AND column_name IN ('status','progress','blocker','source_msg_id','confidence','assigner_contact_id','updated_at');

ALTER TABLE wa_tasks ADD COLUMN IF NOT EXISTS status VARCHAR(12);              -- proposed|not_started|in_progress|blocked|delayed|completed|cancelled
ALTER TABLE wa_tasks ADD COLUMN IF NOT EXISTS progress TEXT;                   -- the OWNER's own progress note (never AI-written)
ALTER TABLE wa_tasks ADD COLUMN IF NOT EXISTS blocker TEXT;
ALTER TABLE wa_tasks ADD COLUMN IF NOT EXISTS source_msg_id UUID;              -- the message that created it (evidence)
ALTER TABLE wa_tasks ADD COLUMN IF NOT EXISTS confidence VARCHAR(8);           -- high|medium for detected tasks
ALTER TABLE wa_tasks ADD COLUMN IF NOT EXISTS assigner_contact_id UUID;        -- who asked (the contact row)
ALTER TABLE wa_tasks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
-- RLS is already ON for wa_tasks (0001).

-- VERIFY (expect: 7 rows; task count unchanged)
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'wa_tasks' AND column_name IN ('status','progress','blocker','source_msg_id','confidence','assigner_contact_id','updated_at');
-- SELECT count(*) FROM wa_tasks;
