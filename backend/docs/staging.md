# First staging deployment

This is the backend layout for the first staging release. Do not create a second dispatch service. Do not schedule coordinate retention, and do not run coordinate deletion.

## Services

Run one Railway web service from the `backend` directory.

- Install: `npm ci`
- Build: `npm run build`
- Start: `npm run start:prod`

`npm run build` runs `prisma generate` and then `nest build`. The generated Prisma client is not committed. Local `npm run start:dev` is unchanged and keeps using the client already generated on the machine.

The API process is the only dispatcher. `DispatchWorker` starts inside NestJS with that one replica. Do not scale the service above one replica, and do not run `npm run start:prod` a second time.

Set `NODE_ENV=production`. Leave `COORDINATE_RETENTION_ENABLED=false`. Leave `ALLOW_TEST_NL_PHONE_NUMBERS` and `ALLOW_DEV_ADMIN_BOOTSTRAP` unset or `false`. `npm run retention:once` is the deletion command. Do not add it to a cron.

Railway sends `SIGTERM` on shutdown. The process enables Nest shutdown hooks, which stop the in-process timers and disconnect Prisma.

Use Node 22 or 24. The repository does not pin a version.

## Database

Use Supabase's direct Postgres connection, not the transaction pooler on port 6543. Put that URL in `DATABASE_URL` with `sslmode=require`. Migrations and the running API both use this one variable.

Before the first migration, enable the `postgis` extension in the Supabase SQL editor:

```sql
create extension if not exists postgis;
```

The migration role must be able to resolve `geography`. On Supabase, PostGIS is often installed in the `extensions` schema, so that schema has to be on the role's search path.

Apply the existing migrations from `backend`. This does not generate a new migration:

```bash
npx prisma migrate deploy
```

Run that with the direct SSL URL. Do not point it at the pooler. The repository migrations do not create the PostGIS extension themselves.

## Client IP for OTP limits

Leave `TRUST_RAILWAY_EDGE_CLIENT_IP` false locally. Set it to `true` only on this Railway service. `NODE_ENV` does not enable it.

This mode assumes Railway's public HTTP ingress and one service in that environment. The public edge replaces `X-Real-IP`. The OTP address is that header when it contains exactly one IPv4 or IPv6 address. A missing or malformed value uses the socket address. `X-Forwarded-For` is not read.

Adding a private-network service, a TCP proxy, or another ingress path requires a security review. Those paths do not pass the public edge, so a caller there can choose `X-Real-IP`.

`TRUSTED_PROXY_CIDRS` remains the local and non-Railway allowlist. Leave it empty unless a specific connecting proxy is known. A direct caller is rated by its socket address. `0.0.0.0/0` and `::/0` are rejected.
