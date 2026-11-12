# First staging deployment

This is the backend layout for the first staging release. Do not create a second dispatch service. Do not schedule coordinate retention, and do not run coordinate deletion.

## Services

Run one Railway web service from the `backend` directory.

- Install: `npm ci`
- Build: `npm run build`
- Start: `npm run start:prod`

`npm run build` runs `prisma generate` and then `nest build`. The generated Prisma client is not committed. Local `npm run start:dev` is unchanged and keeps using the client already generated on the machine.

The API process is the only dispatcher. `DispatchWorker` starts inside NestJS with that one replica. Do not scale the service above one replica, and do not run `npm run start:prod` a second time.

Set `NODE_ENV=production`. Leave `COORDINATE_RETENTION_ENABLED=false`. Leave `ALLOW_TEST_NL_PHONE_NUMBERS`, `ALLOW_DEV_ADMIN_BOOTSTRAP`, and `DEV_OTP_ENABLED` unset or `false`. A true `DEV_OTP_ENABLED` value stops the API from starting on Railway, staging, or production. `npm run retention:once` is the deletion command. Do not add it to a cron.

Railway sends `SIGTERM` on shutdown. The process enables Nest shutdown hooks, which stop the in-process timers and disconnect Prisma.

Use Node 22 or 24. The repository does not pin a version.

## Database

Use Supabase's direct Postgres connection, not the transaction pooler on port 6543. Put that URL in `DATABASE_URL` with `sslmode=require`. Migrations and the running API both use this one variable.

Set `DATABASE_SSL_CA` on Railway to the Supabase root CA, including the BEGIN and END lines. The API verifies that certificate and checks the server hostname. Leave `DATABASE_SSL_CA` unset for local PostgreSQL. An invalid certificate stops startup.

Before the first migration, enable the `postgis` extension in the Supabase SQL editor:

```sql
create extension if not exists postgis;
```

The migration role must be able to resolve `geography`. On Supabase, PostGIS is often installed in the `extensions` schema, so that schema has to be on the role's search path.

Apply the existing migrations from `backend` before starting the API. This does not generate a new migration, and it must not run as part of API startup:

```bash
npm run migrate:deploy
```

Run one deployment at a time. A second concurrent run can observe the first run's session state. The command refuses a database URL that uses port 6543, the transaction pooler. Use the direct connection, or the session pooler on port 5432, with `sslmode=require`.

On a completely fresh database, Prisma applies every migration in one session. The first migration leaves a temporary PostGIS guard table, and `20261014160000_progressive_dispatch` then tries to create that same table. `npm run migrate:deploy` continues only when that failure is PostgreSQL `42P07` for `postgis_catalog_guard` and a read-only check shows the failed migration created no tables, enum types, columns, indexes, or constraints. It then marks that migration rolled back and runs `prisma migrate deploy` in a new process. Any other error stops with no recovery.

## Client IP for OTP limits

Leave `TRUST_RAILWAY_EDGE_CLIENT_IP` false locally. Set it to `true` only on this Railway service. `NODE_ENV` does not enable it.

This mode assumes Railway's public HTTP ingress and one service in that environment. The public edge replaces `X-Real-IP`. The OTP address is that header when it contains exactly one IPv4 or IPv6 address. A missing or malformed value uses the socket address. `X-Forwarded-For` is not read.

Adding a private-network service, a TCP proxy, or another ingress path requires a security review. Those paths do not pass the public edge, so a caller there can choose `X-Real-IP`.

`TRUSTED_PROXY_CIDRS` remains the local and non-Railway allowlist. Leave it empty unless a specific connecting proxy is known. A direct caller is rated by its socket address. `0.0.0.0/0` and `::/0` are rejected.
