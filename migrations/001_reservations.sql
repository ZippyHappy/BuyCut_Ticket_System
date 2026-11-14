CREATE TABLE IF NOT EXISTS purchase_reservations (
 id UUID PRIMARY KEY, event_id VARCHAR(128) NOT NULL,
 quantity SMALLINT NOT NULL CHECK(quantity BETWEEN 1 AND 4),
 status VARCHAR(16) NOT NULL CHECK(status IN ('reserved','committed','released')),
 expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS reservation_signals (
 reservation_id UUID NOT NULL REFERENCES purchase_reservations(id) ON DELETE CASCADE,
 event_id VARCHAR(128) NOT NULL,
 signal_type VARCHAR(24) NOT NULL CHECK(signal_type IN ('account','email','phone','document','payment','ip')),
 signal_hash CHAR(64) NOT NULL, quantity SMALLINT NOT NULL CHECK(quantity BETWEEN 1 AND 4),
 PRIMARY KEY(reservation_id,signal_type)
);
CREATE INDEX IF NOT EXISTS reservation_signal_lookup ON reservation_signals(event_id,signal_type,signal_hash);
CREATE INDEX IF NOT EXISTS reservation_expiry ON purchase_reservations(expires_at);

CREATE TABLE IF NOT EXISTS otp_challenges (
 id UUID PRIMARY KEY,
 channel VARCHAR(16) NOT NULL CHECK(channel IN ('email','sms','whatsapp')),
 contact_type VARCHAR(16) NOT NULL CHECK(contact_type IN ('email','phone')),
 account_id VARCHAR(128) NOT NULL,
 subject_hash CHAR(64) NOT NULL,
 code_hash CHAR(64) NOT NULL,
 attempts SMALLINT NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 expires_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 consumed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS otp_subject_recent ON otp_challenges(subject_hash,created_at DESC);
CREATE INDEX IF NOT EXISTS otp_expiry ON otp_challenges(expires_at);
CREATE TABLE IF NOT EXISTS verified_contacts (
 id UUID PRIMARY KEY,
 account_id VARCHAR(128) NOT NULL,
 channel VARCHAR(16) NOT NULL CHECK(channel IN ('email','phone')),
 subject_hash CHAR(64) NOT NULL UNIQUE,
 verified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS verified_contact_account ON verified_contacts(account_id,channel);




