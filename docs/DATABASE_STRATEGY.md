# Database Strategy

This document covers Situs's database approach, migration workflow, backup/recovery
procedures, and the storage/scale plan:
what would actually force a move off SQLite, and what that move would look like.
The two scale risks planned against here — contract-file BLOBs in the database, and
client state that loads everything — were first flagged by the 2026 product audit, since
deleted as a point-in-time record. This doc is where the plan for them lives.

## SQLite vs Server-based Database

Situs uses **SQLite** by default for simplicity and self-hosted deployments. For production at scale, consider migrating to PostgreSQL or MySQL.

| Aspect            | SQLite                     | PostgreSQL               |
| ----------------- | -------------------------- | ------------------------ |
| Setup complexity  | Zero — single file         | Requires separate server |
| Concurrent writes | Limited (single writer)    | Full concurrency         |
| Backup            | File copy                  | `pg_dump` or streaming   |
| Scaling           | Single node only           | Horizontal read replicas |
| Recommended for   | Single-tenant, low traffic | Multi-tenant, production |

**This is a deliberate choice, not a gap.** SQLite-by-default is core to Situs's
self-hosted positioning: zero external dependencies, one file to back up, runs on a
Raspberry Pi or a TrueNAS SCALE box with no separate DB server to operate. The plan
below is to keep that default and treat PostgreSQL as an opt-in path for a specific,
scale-triggered scenario (e.g. a future hosted/managed offering) — not to migrate
every deployment.

## Current Scale Risks

Two concrete risks, both real today, neither urgent yet:

1. **`Lease.contractFile` stores signed PDF contracts as a `Bytes` BLOB directly in the
   database row** (`prisma/schema.prisma`, `Lease` model). Every contract upload grows
   the single SQLite file, which then has to move through every backup, every `.backup`
   copy, and every WAL checkpoint. It's the only BLOB field in the schema —
   `Document.storagePath` (used for everything else: insurance policies, certificates,
   correspondence attachments) already does this correctly, storing a filesystem path or
   URL instead of bytes. `Lease.contractFile` predates that pattern and was never
   migrated to match it.
2. **`lib/contexts/use-app-data.ts` loads ten full, unpaginated collections
   (`/api/properties`, `/api/buildings`, `/api/tenants`, `/api/receipts`,
   `/api/correspondence/templates`, `/api/correspondence`, `/api/owners`,
   `/api/expenses`, `/api/maintenance`, `/api/leases`) in parallel on every app mount**,
   regardless of portfolio size. `/api/properties` already supports `?page=`/`?limit=`
   (see `app/api/properties/route.ts`) but this caller doesn't use it — it always hits
   the "return everything" branch. This is a client-side/API-shape problem, not a
   database-engine problem: it would still be slow against PostgreSQL. Fixing it means
   paginating these fetches and/or moving from "load everything into a global reducer on
   mount" to per-view fetching, independent of whichever database engine is underneath.

Neither risk is urgent at today's likely portfolio sizes (a handful to a few dozen
properties per landlord). Both compound linearly with usage, so they're worth planning
for, not fixing reactively under load.

## When to Migrate to PostgreSQL

Don't migrate speculatively. Move when any of these is true for a real deployment:

- **A hosted/managed offering ships** (see roadmap 3.4's monetization work) — multiple
  landlords' data on one running instance means concurrent writes across tenants, which
  is exactly where SQLite's single-writer model starts to queue requests. Self-hosted
  single-tenant instances don't hit this; a shared hosted instance eventually will.
- **The SQLite file crosses roughly 5–10 GB**, driven mostly by `Lease.contractFile`
  BLOBs at scale (a few thousand contracts at typical PDF sizes). At that size, `.backup`
  duration, WAL growth, and cold-start file-existence/writability checks in
  `lib/services/database/database.ts` start to matter operationally.
- **A single instance needs to survive a node failure with no downtime.** SQLite has no
  built-in replication; PostgreSQL does. If uptime SLAs matter more than "self-hosted
  simplicity," that's a PostgreSQL-shaped requirement.

If none of these apply, the right move is to keep SQLite and fix the two risks above
independently of any engine change (see the next section) — they're cheaper, safer, and
benefit every deployment including ones that never move to PostgreSQL.

## Migration Path (SQLite → PostgreSQL), When Triggered

Prisma's `datasource.provider` is a single value per schema — `prisma/schema.prisma`
currently pins `provider = "sqlite"` (line ~10), and
`lib/services/database/database.ts` hard-constructs a `PrismaBetterSqlite3` adapter.
Supporting both engines from one codebase (self-hosted stays SQLite, a hosted offering
runs PostgreSQL) requires:

1. **A provider-aware Prisma client construction.** Branch `getPrismaClient()` on
   `DATABASE_URL`'s scheme (`file:` → `PrismaBetterSqlite3`, `postgres(ql)?:` → the
   Postgres driver adapter) instead of hard-coding one adapter. Prisma 7's driver-adapter
   model supports this; it does not require duplicating `schema.prisma`.
2. **Reconciling the migration history.** `prisma/migrations/20260308000000_iberian_compliance/`
   already contains Postgres-only SQL (`DOUBLE PRECISION`, `pg_enum`/`DO $$` blocks for
   enum extension, `ADD CONSTRAINT IF NOT EXISTS`) — evidence the project ran on
   PostgreSQL at some point before settling on SQLite-by-default. That migration breaks
   `prisma migrate deploy` replayed from empty on SQLite today (found during roadmap
   milestone 1.3; tracked as a known, currently-unfixed issue, out of scope for this
   plan). Actually adopting PostgreSQL means either fixing that migration for both
   engines or, more realistically, generating a fresh baseline migration per engine from
   the current schema rather than trying to replay the full mixed-syntax history.
3. **Moving `Lease.contractFile` off BLOB storage first**, regardless of engine — same
   `storagePath` pattern as `Document`. This should happen before any Postgres migration,
   not as part of it: it's the change that actually shrinks the data being moved, and it
   benefits every SQLite deployment immediately.
4. **A one-time data migration tool**, not a schema migration: read every row via the
   SQLite Prisma client, write it via the Postgres Prisma client, in dependency order
   (respecting FKs). `pgloader` can do direct SQLite→Postgres conversion for simple
   schemas, but this schema's PII-encrypted fields (`lib/services/database/pii-extension.ts`)
   and `Bytes` fields make an application-level Prisma-to-Prisma copy safer — it goes
   through the same encryption extension both ways instead of moving ciphertext blindly.
5. **Keeping SQLite as the documented, supported self-hosted default.** PostgreSQL
   support should be additive (an alternate `DATABASE_URL`), not a replacement — anything
   that makes self-hosting harder undermines the product's own positioning.

### Development: `prisma db push`

Use `prisma db push` during active development when the schema is changing frequently:

```bash
npx prisma db push
```

This directly applies schema changes to the database **without creating migration files**. It may drop data if changes are destructive.

### Production: `prisma migrate deploy`

For production, use **tracked migrations** to ensure reproducible, auditable schema changes:

```bash
# 1. Create a migration (development)
npx prisma migrate dev --name add_payment_status

# 2. Review the generated SQL in prisma/migrations/<timestamp>_add_payment_status/

# 3. Deploy migrations (production/CI)
npx prisma migrate deploy
```

### Migration workflow

```
Development:
  prisma migrate dev    →  Creates migration SQL files
                        →  Applies to local DB
                        →  Generates Prisma Client

Production:
  prisma migrate deploy →  Applies pending migrations
                        →  Does NOT generate client (already in image)
```

### Transitioning from `db push` to migrations

If you've been using `db push` and want to switch to migrations:

```bash
# 1. Baseline the current schema (creates initial migration without applying)
npx prisma migrate dev --name baseline --create-only

# 2. Mark the migration as applied (since the DB already has this schema)
npx prisma migrate resolve --applied <migration-name>

# 3. From now on, use `prisma migrate dev` for new changes
```

### CI/CD integration

Run migrations on startup from the container entrypoint:

```dockerfile
# In Dockerfile CMD or entrypoint
CMD ["sh", "-c", "npx prisma migrate deploy && node server.js"]
```

> The Kubernetes init-container example that used to sit here has been removed along with the
> Helm chart and `k8s/` manifests — see `truenas.md`. TrueNAS SCALE moved to Docker in Electric
> Eel (24.10) and Custom App is the only supported deployment path, so the manifest could not
> have run.

Note that the shipped image does not use `migrate deploy` today: `scripts/ensure-sqlite.js`
applies additive schema changes with `prisma db push` on start, gated by `AUTO_DB_SCHEMA_SYNC`
(default on). The block above applies if you adopt the migrations workflow described earlier in
this document.

## Backup & Recovery

### SQLite backup

SQLite databases are single files, making backups straightforward.

**Using the backup script:**

```bash
bash scripts/db-backup.sh /data/situs.sqlite ./backups
```

**Manual backup:**

```bash
# Hot backup using sqlite3 .backup command (safe during writes)
sqlite3 /data/situs.sqlite ".backup '/backups/situs-$(date +%Y%m%d-%H%M%S).sqlite'"

# Simple file copy (only safe if app is stopped or using WAL mode)
cp /data/situs.sqlite /backups/situs-backup.sqlite
```

### Automated backups (CronJob)

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: situs-backup
spec:
  schedule: "0 2 * * *" # Daily at 2 AM
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: backup
              image: alpine:latest
              command:
                - sh
                - -c
                - |
                  apk add --no-cache sqlite
                  BACKUP_FILE="/backups/situs-$(date +%Y%m%d-%H%M%S).sqlite"
                  sqlite3 /data/situs.sqlite ".backup '${BACKUP_FILE}'"
                  echo "Backup created: ${BACKUP_FILE}"
                  # Keep only last 7 days of backups
                  find /backups -name "situs-*.sqlite" -mtime +7 -delete
              volumeMounts:
                - name: situs-data
                  mountPath: /data
                  readOnly: true
                - name: backups
                  mountPath: /backups
          restartPolicy: OnFailure
          volumes:
            - name: situs-data
              persistentVolumeClaim:
                claimName: situs-data
            - name: backups
              persistentVolumeClaim:
                claimName: situs-backups
```

### Recovery

```bash
# Stop the application
kubectl scale deployment situs --replicas=0

# Restore from backup
cp /backups/situs-20260208-020000.sqlite /data/situs.sqlite

# Restart
kubectl scale deployment situs --replicas=1
```

## Schema Reference

See `prisma/schema.prisma` for the full data model. Key models:

- `User` — authentication and user profiles
- `Property` — property listings
- `Tenant` — tenant records
- `Lease` — lease agreements
- `PaymentMethod` / `PaymentTransaction` — tenant rent-collection payments (Stripe)
- `Subscription` — the app's own SaaS plan/billing state (see roadmap 3.4)
- `Invoice` — generated invoices
