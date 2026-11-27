-- Supports the cancelled branch of rider history. Completed rows keep assignment_completion_page_idx.
CREATE INDEX "assignment_release_page_idx" ON "delivery_assignments" ("rider_profile_id", "status", "released_at", "id");
