-- AlterTable
ALTER TABLE "recipients" ADD COLUMN     "otp_sent_at" TIMESTAMPTZ,
ADD COLUMN     "otp_verified_at" TIMESTAMPTZ;

-- A signing link may read its own recipient row (to find the tenant).
create policy token_read on recipients for select
  using (token_hash = app_token_hash());
