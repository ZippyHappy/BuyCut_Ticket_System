CREATE TABLE IF NOT EXISTS verified_identities (
 account_id VARCHAR(128) PRIMARY KEY,
 document_hash CHAR(64) NOT NULL,
 provider_reference_hash CHAR(64) NOT NULL UNIQUE,
 face_match BOOLEAN NOT NULL CHECK(face_match=true),
 verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 expires_at TIMESTAMPTZ NOT NULL
);

