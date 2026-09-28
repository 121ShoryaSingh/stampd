-- AlterTable
ALTER TABLE "envelopes" ADD COLUMN     "seal_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "seal_locked_until" TIMESTAMPTZ,
ADD COLUMN     "seal_run_at" TIMESTAMPTZ;
