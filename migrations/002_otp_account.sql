-- Challenges created before account binding cannot be safely attributed. Expire them.
UPDATE otp_challenges SET consumed_at=COALESCE(consumed_at,now()), expires_at=LEAST(expires_at,now()) WHERE account_id IS NULL;
ALTER TABLE otp_challenges ALTER COLUMN account_id SET NOT NULL;

