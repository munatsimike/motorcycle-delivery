-- Add REVOKED before the motorcycle registration migration uses it.
-- PostgreSQL cannot use a new enum value in the same transaction that adds
-- it, and Prisma runs each migration in one transaction.
-- This migration does not alter tables, PostGIS catalogs, or applied checks.

ALTER TYPE "motorcycle_verification_status" ADD VALUE 'REVOKED';
