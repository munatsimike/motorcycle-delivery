-- Marks disposable private-polishing accounts. Existing rows stay false.
-- Authentication must not promote these rows into production identities.

ALTER TABLE "users" ADD COLUMN "private_test_account" BOOLEAN NOT NULL DEFAULT false;
