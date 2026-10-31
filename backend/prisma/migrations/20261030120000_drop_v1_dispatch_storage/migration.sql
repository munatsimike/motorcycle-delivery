-- Drop obsolete V1 dispatch-round and rider-offer notification storage.
-- These tables hold only their own rows. Deliveries, assignments, bids, wallets, ledger entries, and status events stay.

DROP TABLE "rider_offer_notifications";
DROP TABLE "delivery_dispatch_rounds";
DROP TYPE "rider_offer_notification_status";
DROP TYPE "dispatch_round_status";
