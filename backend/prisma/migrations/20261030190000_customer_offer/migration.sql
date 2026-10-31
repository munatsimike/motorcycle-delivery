-- The customer's opening offer. Distinct from suggested_price and from the agreed price.
ALTER TABLE "deliveries" ADD COLUMN "customer_offer" DECIMAL(12,2);
