-- One active customer session and one active rider session per user.
-- The currently deployed backend inserts refresh_sessions without app_role.
-- The BEFORE INSERT trigger fills that column from the account role and ends
-- the previous session for the same app, so sign-in still succeeds and the
-- unique index does not reject the old insert. Admin sessions are not limited.
-- A refresh keeps the same family, so the trigger does not treat it as a new
-- device and does not invalidate rider push tokens.
-- Prisma 7.1.0 cannot represent these objects. Do not drop them:
--   refresh_sessions_one_active_per_app_idx
--   refresh_sessions_prepare_insert()

ALTER TABLE "refresh_sessions" ADD COLUMN "app_role" "user_role";

UPDATE "refresh_sessions" AS session
SET "app_role" = account."role"
FROM "users" AS account
WHERE account."id" = session."user_id"
  AND session."app_role" IS NULL;

UPDATE "refresh_sessions"
SET "app_role" = 'CUSTOMER'::"user_role"
WHERE "app_role" IS NULL;

CREATE OR REPLACE FUNCTION "refresh_sessions_prepare_insert"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  same_family boolean;
BEGIN
  IF NEW."app_role" IS NULL THEN
    SELECT account."role"
    INTO NEW."app_role"
    FROM "users" AS account
    WHERE account."id" = NEW."user_id";
  END IF;
  IF NEW."app_role" IS NULL THEN
    NEW."app_role" := 'CUSTOMER'::"user_role";
  END IF;

  IF NEW."app_role" IN ('CUSTOMER'::"user_role", 'RIDER'::"user_role") THEN
    PERFORM 1
    FROM "users"
    WHERE "id" = NEW."user_id"
    FOR UPDATE;

    UPDATE "refresh_sessions"
    SET "revoked_at" = COALESCE(NEW."created_at", CURRENT_TIMESTAMP)
    WHERE "user_id" = NEW."user_id"
      AND "app_role" = NEW."app_role"
      AND "revoked_at" IS NULL
      AND "replaced_by_session_id" IS NULL;

    SELECT EXISTS (
      SELECT 1
      FROM "refresh_sessions"
      WHERE "family_id" = NEW."family_id"
    ) INTO same_family;

    IF NEW."app_role" = 'RIDER'::"user_role" AND NOT same_family THEN
      UPDATE "rider_push_devices" AS device
      SET "invalidated_at" = COALESCE(NEW."created_at", CURRENT_TIMESTAMP)
      FROM "rider_profiles" AS profile
      WHERE device."rider_profile_id" = profile."id"
        AND profile."user_id" = NEW."user_id"
        AND device."invalidated_at" IS NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "refresh_sessions_prepare_insert_trg" ON "refresh_sessions";

CREATE TRIGGER "refresh_sessions_prepare_insert_trg"
BEFORE INSERT ON "refresh_sessions"
FOR EACH ROW
EXECUTE FUNCTION "refresh_sessions_prepare_insert"();

ALTER TABLE "refresh_sessions" ALTER COLUMN "app_role" SET NOT NULL;

-- Keep the newest active session for each customer or rider app.
WITH ranked AS (
    SELECT
        "id",
        row_number() OVER (
            PARTITION BY "user_id", "app_role"
            ORDER BY "created_at" DESC, "id" DESC
        ) AS n
    FROM "refresh_sessions"
    WHERE "revoked_at" IS NULL
      AND "replaced_by_session_id" IS NULL
      AND "app_role" IN ('CUSTOMER'::"user_role", 'RIDER'::"user_role")
)
UPDATE "refresh_sessions"
SET "revoked_at" = CURRENT_TIMESTAMP
WHERE "id" IN (SELECT "id" FROM ranked WHERE n > 1);

CREATE UNIQUE INDEX "refresh_sessions_one_active_per_app_idx"
    ON "refresh_sessions" ("user_id", "app_role")
    WHERE "revoked_at" IS NULL
      AND "replaced_by_session_id" IS NULL
      AND "app_role" IN ('CUSTOMER'::"user_role", 'RIDER'::"user_role");
