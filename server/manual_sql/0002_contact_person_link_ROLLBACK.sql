-- Rollback of 0002. Only removes the link column; every contact, message and task stays exactly as it is.
-- (The links themselves are lost; the contacts are not.) Run only if you want to undo identity linking.
DROP INDEX IF EXISTS ix_wa_contacts_person_id;
ALTER TABLE wa_contacts DROP COLUMN IF EXISTS person_id;
-- VERIFY: SELECT count(*) FROM information_schema.columns WHERE table_name = 'wa_contacts' AND column_name = 'person_id';  -- 0
