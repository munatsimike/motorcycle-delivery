-- Status values for an EcoCash Online Payments charge.
-- Existing PENDING, FAILED, and VERIFIED rows are unchanged.
-- This file does not add columns, rewrite payments, or touch balances.

ALTER TYPE "wallet_payment_status" ADD VALUE 'EXPIRED';
ALTER TYPE "wallet_payment_status" ADD VALUE 'UNRESOLVED';
ALTER TYPE "wallet_payment_status" ADD VALUE 'REFUNDED';
ALTER TYPE "wallet_payment_status" ADD VALUE 'REVERSED';
