-- Home and Work are categories, not unique identifiers.
-- Existing saved addresses are left unchanged.
-- The single default pickup index stays in place.

DROP INDEX "customer_saved_addresses_one_home_idx";
DROP INDEX "customer_saved_addresses_one_work_idx";
