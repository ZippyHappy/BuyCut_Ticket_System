CREATE TABLE IF NOT EXISTS identity_sessions (
 session_hash CHAR(64) PRIMARY KEY,
 account_id VARCHAR(128) NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 consumed_at TIMESTAMPTZ
);
ALTER TABLE verified_identities ADD COLUMN IF NOT EXISTS identity_fingerprint CHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS verified_identity_fingerprint_unique ON verified_identities(identity_fingerprint) WHERE identity_fingerprint IS NOT NULL;

