-- Additive migration. Preserve historical completion times.
ALTER TABLE "delivery_assignments" ADD COLUMN "completed_at" TIMESTAMPTZ(6);
UPDATE "delivery_assignments" a
SET "completed_at" = COALESCE(
  (SELECT MAX(e."occurred_at") FROM "delivery_status_events" e
   WHERE e."delivery_id" = a."delivery_id" AND e."new_status" = 'DELIVERED'),
  d."updated_at", d."created_at")
FROM "deliveries" d
WHERE d."id" = a."delivery_id" AND a."status" = 'COMPLETED';
CREATE INDEX "assignment_completion_page_idx" ON "delivery_assignments" ("rider_profile_id", "status", "completed_at", "id");
CREATE INDEX "customer_delivery_page_idx" ON "deliveries" ("customer_id", "created_at", "id");
CREATE INDEX "saved_address_page_idx" ON "customer_saved_addresses" ("customer_account_id", "created_at", "id");
CREATE INDEX "wallet_entry_page_idx" ON "rider_wallet_entries" ("rider_wallet_id", "created_at", "id");
CREATE INDEX "delivery_event_status_time_idx" ON "delivery_status_events" ("delivery_id", "new_status", "occurred_at");

-- Older application instances mark an assignment COMPLETED without writing
-- completed_at. Fill it in the same update so history stays ordered.
CREATE FUNCTION "delivery_assignments_set_completed_at"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."status" = 'COMPLETED' AND NEW."completed_at" IS NULL THEN
    NEW."completed_at" = CURRENT_TIMESTAMP;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "delivery_assignments_set_completed_at"
BEFORE INSERT OR UPDATE OF "status", "completed_at" ON "delivery_assignments"
FOR EACH ROW
EXECUTE FUNCTION "delivery_assignments_set_completed_at"();
