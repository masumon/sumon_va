-- 0002: link several contacts (SMS number, WhatsApp number, chat-app name...) of ONE human. ADDITIVE ONLY. Owner runs this in Supabase.
-- Needs: a database backup first (owner confirmed a backup on 2026-11-06). Run BEFORE merging the code that reads it.
-- Safe: one nullable column + one index. No existing row changes (every person_id stays NULL until a link is made).
-- Old code keeps working: it never reads this column.

-- PREFLIGHT (run first, expect: table exists, column NOT there yet)
-- SELECT count(*) AS contacts FROM wa_contacts;
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'wa_contacts' AND column_name = 'person_id';  -- 0 rows

ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS person_id UUID;
CREATE INDEX IF NOT EXISTS ix_wa_contacts_person_id ON wa_contacts (person_id) WHERE person_id IS NOT NULL;
-- RLS is already ON for wa_contacts (0001); a new column does not change that.

-- VERIFY (expect: 1 row for the column; contacts count unchanged; 0 rows with a person_id)
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'wa_contacts' AND column_name = 'person_id';
-- SELECT count(*) AS contacts FROM wa_contacts;
-- SELECT count(*) AS linked FROM wa_contacts WHERE person_id IS NOT NULL;
