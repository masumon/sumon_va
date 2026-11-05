-- Sumon VA schema (own Supabase). Idempotent: safe to run more than once.
-- Generated from the SQLAlchemy models of the copied server (see docs/TRANSFER.md).

CREATE TABLE IF NOT EXISTS admin_users (
	id UUID NOT NULL, 
	email VARCHAR(255) NOT NULL, 
	password_hash VARCHAR(255) NOT NULL, 
	name VARCHAR(255) NOT NULL, 
	role VARCHAR(20) NOT NULL, 
	is_active BOOLEAN NOT NULL, 
	totp_secret TEXT, 
	totp_enabled BOOLEAN NOT NULL, 
	totp_recovery_codes TEXT, 
	totp_last_step BIGINT, 
	token_version INTEGER DEFAULT '0' NOT NULL, 
	failed_login_count INTEGER DEFAULT '0' NOT NULL, 
	locked_until TIMESTAMP WITH TIME ZONE, 
	last_login TIMESTAMP WITH TIME ZONE, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), 
	is_deleted BOOLEAN NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS passkeys (
	id UUID NOT NULL, 
	owner_type VARCHAR(20) NOT NULL, 
	owner_ref VARCHAR(255) NOT NULL, 
	credential_id VARCHAR(512) NOT NULL, 
	public_key TEXT NOT NULL, 
	sign_count BIGINT NOT NULL, 
	transports JSON NOT NULL, 
	name VARCHAR(120), 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), 
	last_used_at TIMESTAMP WITH TIME ZONE, 
	is_deleted BOOLEAN NOT NULL, 
	PRIMARY KEY (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_passkeys_credential_id ON passkeys (credential_id);
CREATE INDEX IF NOT EXISTS ix_passkeys_owner_ref ON passkeys (owner_ref);
CREATE INDEX IF NOT EXISTS ix_passkeys_owner_type ON passkeys (owner_type);

CREATE TABLE IF NOT EXISTS settings (
	id UUID NOT NULL, 
	key VARCHAR(255) NOT NULL, 
	value TEXT NOT NULL, 
	data_type VARCHAR(50) NOT NULL, 
	description TEXT, 
	is_secret BOOLEAN NOT NULL, 
	is_editable BOOLEAN NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), 
	is_deleted BOOLEAN NOT NULL, 
	PRIMARY KEY (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_settings_key ON settings (key);

CREATE TABLE IF NOT EXISTS activity_logs (
	id UUID NOT NULL, 
	admin_id UUID NOT NULL, 
	action VARCHAR(50) NOT NULL, 
	entity_type VARCHAR(50) NOT NULL, 
	entity_id UUID, 
	old_values JSON, 
	new_values JSON, 
	ip_address VARCHAR(45), 
	user_agent TEXT, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), 
	is_deleted BOOLEAN NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(admin_id) REFERENCES admin_users (id)
);

CREATE TABLE IF NOT EXISTS notifications (
	id UUID NOT NULL, 
	type VARCHAR(50) NOT NULL, 
	severity VARCHAR(20) NOT NULL, 
	title VARCHAR(255) NOT NULL, 
	body TEXT, 
	target_admin_id UUID, 
	link VARCHAR(500), 
	meta JSON NOT NULL, 
	is_read BOOLEAN NOT NULL, 
	read_at TIMESTAMP WITH TIME ZONE, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), 
	is_deleted BOOLEAN NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(target_admin_id) REFERENCES admin_users (id)
);
CREATE INDEX IF NOT EXISTS ix_notifications_created_at ON notifications (created_at);
CREATE INDEX IF NOT EXISTS ix_notifications_is_read ON notifications (is_read);
CREATE INDEX IF NOT EXISTS ix_notifications_target_admin_id ON notifications (target_admin_id);
CREATE INDEX IF NOT EXISTS ix_notifications_type ON notifications (type);

CREATE TABLE IF NOT EXISTS system_events (
	id UUID NOT NULL, 
	event_type VARCHAR(50) NOT NULL, 
	severity VARCHAR(20) NOT NULL, 
	source VARCHAR(100) NOT NULL, 
	message TEXT NOT NULL, 
	meta JSON NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), 
	is_deleted BOOLEAN NOT NULL, 
	PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS ix_system_events_created_at ON system_events (created_at);
CREATE INDEX IF NOT EXISTS ix_system_events_event_type ON system_events (event_type);
CREATE INDEX IF NOT EXISTS ix_system_events_severity ON system_events (severity);

CREATE TABLE IF NOT EXISTS email_templates (
	id UUID NOT NULL, 
	template_name VARCHAR(100) NOT NULL, 
	subject_en VARCHAR(255) NOT NULL, 
	subject_bn VARCHAR(255) NOT NULL, 
	body_en TEXT NOT NULL, 
	body_bn TEXT NOT NULL, 
	variables JSON NOT NULL, 
	is_active BOOLEAN NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), 
	is_deleted BOOLEAN NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (template_name)
);

CREATE TABLE IF NOT EXISTS wa_contacts (
	id UUID NOT NULL, 
	phone VARCHAR(80) NOT NULL, 
	channel VARCHAR(16) NOT NULL, 
	category VARCHAR(10), 
	tags JSON, 
	name VARCHAR(120), 
	calls_him VARCHAR(40), 
	relation VARCHAR(40), 
	gender VARCHAR(10), 
	mode VARCHAR(10) NOT NULL, 
	is_vip BOOLEAN NOT NULL, 
	is_family BOOLEAN NOT NULL, 
	is_blocked BOOLEAN NOT NULL, 
	state VARCHAR(10) NOT NULL, 
	hold_until TIMESTAMP WITH TIME ZONE, 
	priority SMALLINT NOT NULL, 
	need TEXT, 
	summary TEXT, 
	profile JSON, 
	unread INTEGER NOT NULL, 
	lang VARCHAR(5), 
	last_inbound_at TIMESTAMP WITH TIME ZONE, 
	last_outbound_at TIMESTAMP WITH TIME ZONE, 
	last_message_at TIMESTAMP WITH TIME ZONE, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), 
	PRIMARY KEY (id), 
	UNIQUE (phone)
);
CREATE INDEX IF NOT EXISTS ix_wa_contacts_category ON wa_contacts (category);
CREATE INDEX IF NOT EXISTS ix_wa_contacts_channel ON wa_contacts (channel);
CREATE INDEX IF NOT EXISTS ix_wa_contacts_last_message_at ON wa_contacts (last_message_at);
CREATE INDEX IF NOT EXISTS ix_wa_contacts_state ON wa_contacts (state);

CREATE TABLE IF NOT EXISTS wa_messages (
	id UUID NOT NULL, 
	contact_id UUID NOT NULL, 
	direction VARCHAR(3) NOT NULL, 
	channel VARCHAR(16) NOT NULL, 
	wa_id VARCHAR(120), 
	kind VARCHAR(12) NOT NULL, 
	body TEXT, 
	transcript TEXT, 
	status VARCHAR(10) NOT NULL, 
	reason VARCHAR(40), 
	send_after TIMESTAMP WITH TIME ZONE, 
	sent_at TIMESTAMP WITH TIME ZONE, 
	delivery VARCHAR(12), 
	error VARCHAR(300), 
	meta JSON, 
	feedback SMALLINT, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), 
	PRIMARY KEY (id), 
	FOREIGN KEY(contact_id) REFERENCES wa_contacts (id) ON DELETE CASCADE, 
	UNIQUE (wa_id)
);

CREATE TABLE IF NOT EXISTS wa_notes (
	id UUID NOT NULL, 
	contact_id UUID NOT NULL, 
	text TEXT NOT NULL, 
	until TIMESTAMP WITH TIME ZONE, 
	is_active BOOLEAN NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), 
	PRIMARY KEY (id), 
	FOREIGN KEY(contact_id) REFERENCES wa_contacts (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS wa_tasks (
	id UUID NOT NULL, 
	contact_id UUID, 
	title VARCHAR(300) NOT NULL, 
	due_at TIMESTAMP WITH TIME ZONE, 
	is_done BOOLEAN NOT NULL, 
	source VARCHAR(10) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), 
	done_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (id), 
	FOREIGN KEY(contact_id) REFERENCES wa_contacts (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS inbox_devices (
	id UUID NOT NULL, 
	name VARCHAR(80) NOT NULL, 
	admin_id UUID, 
	token_hash VARCHAR(64) NOT NULL, 
	app_version VARCHAR(20), 
	paired_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), 
	last_seen_at TIMESTAMP WITH TIME ZONE, 
	revoked_at TIMESTAMP WITH TIME ZONE, 
	meta JSON, 
	PRIMARY KEY (id), 
	FOREIGN KEY(admin_id) REFERENCES admin_users (id) ON DELETE CASCADE, 
	UNIQUE (token_hash)
);

CREATE TABLE IF NOT EXISTS inbox_pair_codes (
	code_hash VARCHAR(64) NOT NULL, 
	admin_id UUID, 
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), 
	used_at TIMESTAMP WITH TIME ZONE, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), 
	PRIMARY KEY (code_hash), 
	FOREIGN KEY(admin_id) REFERENCES admin_users (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS inbox_commands (
	id UUID NOT NULL, 
	device_id UUID, 
	msg_id UUID, 
	kind VARCHAR(12) NOT NULL, 
	target VARCHAR(80) NOT NULL, 
	body TEXT, 
	status VARCHAR(10) NOT NULL, 
	error VARCHAR(300), 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), 
	done_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (id), 
	FOREIGN KEY(device_id) REFERENCES inbox_devices (id) ON DELETE CASCADE
);

-- Row Level Security: ON for every table, NO policies (only the server's database role can read or write).
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.passkeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbox_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbox_pair_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbox_commands ENABLE ROW LEVEL SECURITY;
