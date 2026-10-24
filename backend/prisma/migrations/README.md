# Migrations

## Clean install and `postgis_catalog_guard`

A brand-new database can fail `prisma migrate deploy` at `20261014160000_progressive_dispatch` with:

```text
relation "postgis_catalog_guard" already exists
```

`20261013103200_init_core_delivery_schema` and `20261014160000_progressive_dispatch` both create a temporary table with that name. PostgreSQL keeps a temporary table until the session ends, and Prisma applies the whole history on one session. The second create then collides.

Do not edit those historical files. Databases that already applied them store a checksum, and a changed file blocks later deploys until that checksum is rewritten. These files stay as they were applied.

Temporary workaround for an empty database: apply each `migration.sql` in its own database session, in filename order. `prisma migrate deploy` on a database that already has both of those migrations is unaffected, because only pending migrations run.

Do not use this workaround against production.
