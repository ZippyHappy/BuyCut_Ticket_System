ALTER TABLE otp_challenges ADD COLUMN IF NOT EXISTS contact_type VARCHAR(16);
UPDATE otp_challenges SET contact_type=CASE WHEN channel='email' THEN 'email' ELSE 'phone' END WHERE contact_type IS NULL;
ALTER TABLE otp_challenges ALTER COLUMN contact_type SET NOT NULL;

