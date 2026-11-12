-- Add the included-distance pricing model.
-- Existing tariff rows are not updated.
-- PostgreSQL cannot use a new enum value in the same transaction that adds it.

ALTER TYPE "pricing_model" ADD VALUE 'INCLUDED_DISTANCE';
