# Database Strategy

This document covers Situs's database approach, how the schema reaches a database, backup and
recovery, and the storage/scale plan: what would actually force a move off SQLite, and what that
move would look like.

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
   `Document.storagePath`, which the receipt archive uses, already does this correctly,
   storing a filesystem path or URL instead of bytes. `Lease.contractFile` predates that
   pattern and was never migrated to match it.
2. **`lib/contexts/use-app-data.ts` loads seven full, unpaginated collections
   (`/api/properties`, `/api/buildings`, `/api/tenants`, `/api/receipts`,
   `/api/owners`, `/api/expenses`, `/api/leases`) in parallel on every app mount**,
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

- **A hosted/managed offering ships** — multiple
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
   `prisma migrate deploy` replayed from empty on SQLite today (a known, unfixed issue).
   Actually adopting PostgreSQL means either fixing that migration for both engines or, more
   realistically, generating a fresh baseline migration per engine from the current schema
   rather than trying to replay the full mixed-syntax history.
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

## How the schema reaches a database

The image applies `prisma/schema.prisma` itself, on every start: `prestart` runs
`scripts/ensure-sqlite.js`, which pushes the schema into an empty file (`AUTO_DB_INIT`, default
on) and then runs an additive `prisma db push` (`AUTO_DB_SCHEMA_SYNC`, default on). When the
additive push cannot apply — the schema dropped or retyped a column — it copies the file to
`<file>.bak-<timestamp>` and retries with `--accept-data-loss`, which drops what the schema no
longer has. `AUTO_DB_SCHEMA_SYNC_FORCE=false` stops it before that step instead, leaving the app on
a schema it cannot fully query. It proceeds with the forced push even if the copy fails, so keep
your own backups (below) rather than relying on that copy.

In development, apply schema changes with `npx prisma db push`.

**`prisma/migrations/` is not applied by anything, and `prisma migrate deploy` is not a supported
way to create or upgrade a Situs database.** The history cannot be replayed from empty on SQLite:
`20260308000000_iberian_compliance` contains PostgreSQL-only SQL (see the migration path above).

## Backup & Recovery

A backup is a copy of one file: `situs.sqlite` on the data volume (`/app/data` inside the
container). Health checks say nothing about it surviving.

- **TrueNAS SCALE** — schedule periodic snapshots of the dataset mounted at `/app/data`
  (**Data Protection → Periodic Snapshot Tasks**). A snapshot is atomic, so it is safe while the
  app runs.
- **Docker Compose** — `scripts/db-backup.sh` runs on the host, not in the container (the image
  has neither `bash` nor `sqlite3`). From the repository checkout, where Compose mounts `./data`:

  ```bash
  bash scripts/db-backup.sh ./data/situs.sqlite ./backups 14   # file, directory, days to keep
  ```

  It uses `sqlite3 .backup` when `sqlite3` is installed, which is safe during writes; without it,
  it falls back to a file copy, which is safe only with the app stopped.

### Recovery

Stop the app, replace `situs.sqlite` on the data volume with the backup, and start it again. On
start, `prestart` brings the restored file's schema up to date as described above.

## Schema Reference

See `prisma/schema.prisma` for the full data model. Key models:

- `User` — authentication and user profiles
- `Property` — property listings
- `Tenant` — tenant records
- `Lease` — lease agreements
