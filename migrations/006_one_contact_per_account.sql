CREATE UNIQUE INDEX IF NOT EXISTS verified_contact_one_per_type ON verified_contacts(account_id,channel);

