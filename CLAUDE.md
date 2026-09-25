# Situs — Claude Code Context

## Project

Situs — **Situs // Sovereign Capital System** — is self-hosted property management for landlords
and property managers in **Portugal**. The product is one loop: bank movement → match →
allocate → receipt → tax filing → audit trail. Around it sit the records the loop runs on
(properties, buildings, owners, tenants, leases, expenses) and the compliance substrate (PII
encryption, GDPR export and retention, the Article 30 record, the legal pages). It is one owner's
instance, shared with co-owners, not a product to sell: there is no billing and no landing page, and
rent reaches the ledger as a matched bank movement, never as a card payment.

The version lives in `package.json`. Never copy it into prose.

## Tech Stack

| Layer      | Technology                                      |
| ---------- | ----------------------------------------------- |
| Framework  | Next.js 16 (App Router, TypeScript strict)      |
| Database   | Prisma ORM + SQLite (via better-sqlite3)        |
| Auth       | NextAuth.js v4 (Google OAuth + credentials)     |
| UI         | shadcn/ui + Tailwind CSS v4 + Radix UI + Framer |
| Validation | Zod v4                                          |
| Email      | SMTP (Brevo by default; any provider)           |
| Testing    | Vitest (unit/integration) + Playwright (E2E)    |
| i18n       | next-intl (PT / EN / ES / IT)                   |
| Deploy     | Docker / TrueNAS SCALE (Custom App)             |

## Key Commands

```bash
npm run dev            # Start dev server on http://localhost:3000
npm test               # Vitest unit/integration suite
npm run lint           # ESLint with --max-warnings=0 (CI gate)
npm run type-check     # tsc --noEmit
npm run hygiene        # docs, i18n, colour, currency, CSS, action, version and branch checks
npm run verify:ci      # type-check + lint + format:check + hygiene + security:audit + test
npm run audit:local    # mobile/desktop audit against a disposable app (see Responsive rules)

npx prisma db push     # Push schema changes to SQLite
npx prisma generate    # Regenerate the Prisma client after schema changes
```

## Architecture

### Directory Layout

```
app/
  api/                  # Route handlers, one folder per domain — list: find app/api -name route.ts
  [locale]/(main)/      # Owner-facing pages (locale-prefixed)
components/             # Shared React components
lib/
  types.ts              # Core entity types; domain types sit beside their code
                        #   (e.g. lib/services/allocation/types.ts, lib/tax/connectors/types.ts)
  contexts/             # AppState (app-reducer.ts) and AppContext (app-context.tsx)
  services/
    database/database.ts  # getPrismaClient() — the Prisma singleton, PII extension applied
    allocation/         # Pure reference-month waterfall engine + Prisma orchestration
    matching/           # Pure bank-movement-to-lease confidence scoring engine
    bank/               # CSV import + fingerprint dedupe + matching pipeline
      providers/        # PSD2 provider contract + registry + Enable Banking adapter + test fake
    receipts/           # Receipt document-lifecycle state machine + orchestration
    tax/                # Tax connector find-or-create + submission-log service
  tax/connectors/       # The Portuguese TaxConnector (pt-at.ts) and its mode guard
  tax/at/               # AT's webservice client: WS-Security header, SOAP, mutual TLS, files
  design/country-themes.ts  # PT/EU theme table
prisma/schema.prisma    # Database schema — source of truth
messages/               # en.json, pt.json, es.json, it.json
tests/                  # Cross-cutting contract tests; unit tests sit next to their source
e2e/                    # Playwright E2E tests
```

### Key Patterns

- **Tenant modal**: the 4-zone pattern — Status+Health / Primary Action / Issues Panel / Tabbed
  info (`tenant-detail-modal.tsx`). Property and Building have no modal: detail overlays open from
  any page with `?detail=<type>:<id>` (`components/shared/entity-detail-route-client.tsx`).
- **AppState**: `lib/contexts/app-reducer.ts` holds buildings, properties, tenants, receipts,
  owners, expenses and leases; `app-context.tsx` composes it with `use-app-data.ts`,
  `use-entity-actions.ts` and `create-entity-actions.ts`. Mutate through the typed actions
  (`addProperty`, `updateTenant`, …). Bank, tax and ledger data are fetched by their own
  components and never live in AppState.
- **API routes**: one folder per domain under `app/api/`. Validate with Zod, check the NextAuth
  session before touching the database.
- **Compliance**: `/api/compliance/rent-receipts`, Portugal's rent receipts. Tax logic lives in
  `lib/tax/` and `lib/services/tax/connector-service.ts`.
- **PII encryption**: AES-256-GCM via `lib/utils/pii-encryption.ts`, keyed off
  `PII_ENCRYPTION_KEY`. `PII_FIELDS` lists the fields the Prisma extension (applied in
  `lib/services/database/database.ts`) encrypts on write and decrypts on read — **not** every
  encrypted field. `BankAccount.iban` is encrypted at the call site (`lib/services/bank/consent.ts`)
  and never decrypted: matching uses `ibanHash`, display uses `ibanLast4`. Do not add it to
  `PII_FIELDS` — the extension would then decrypt it on every read. `Lease.contractFile` (bytes)
  is encrypted by its own route, `app/api/leases/[id]/contract` (`encryptFile`), and the client's
  global `omit` leaves it out of every other lease read. `TaxAuthorityConnector.credentialsRef`
  (the AT Portal sub-user and its password) is encrypted and decrypted only in
  `lib/services/tax/at-connection.ts`, which refuses to store it when `encryptPII` would write
  plaintext; no read returns the password. The extension transforms only the
  top-level model a query names, never a nested `create` or `include`, so a PII model is written
  and read through its own delegate (`LeaseParty` via `lib/services/database/lease-parties.ts`).
  **Required in production**: without the key `encryptPII` writes plaintext and only warns, so
  the server refuses to start: `instrumentation.ts` runs `lib/utils/env.ts` before the first
  request (skipped under `NEXT_BUILD=true` and CI), and in the image prestart's
  `scripts/validate-env.js` refuses even earlier. `ALLOW_UNENCRYPTED_PII=true` waives both and
  logs a warning instead.
- **Reference-month rent ledger**: `RentPeriod` is one row per lease per reference month; its
  `status` is recomputed in the same transaction as every allocation write and never hand-set.
  Waterfall invariant: fill the oldest not-fully-allocated period first
  (`lib/services/allocation/engine.ts`, pure). `Tenant.paymentStatus` is derived from the ledger —
  never write it from an API route.
- **Deletes keep money history**: a tenant, property or lease with leases, receipts, rent months,
  live allocations, expenses or AT filings recorded against it is refused, since every one of those
  cascades from it in the schema (`lib/services/database/history.ts`). The refusal is a
  `ConflictError`: a 409 whose `reason` `apiFetch` keeps and `useApiError` turns into a sentence. A
  lease with nothing paid against it can still be deleted; a tenancy otherwise stops by ending its
  lease.
- **Bank matching**: CSV/manual import or a live provider sync → fingerprint dedupe (idempotent) →
  fuzzy-duplicate check → reconciliation rules → weighted confidence scoring
  (`lib/services/matching/engine.ts`, pure). ≥0.85 auto-allocates via a draft `Receipt`
  (`source: "automation"`); anything lower waits in the Bank Movements inbox (Finance tab) for a
  human to confirm, reassign or ignore.
- **Live bank connection**: PSD2 account information through Enable Banking
  (`lib/services/bank/providers/`). Enable Banking is the licensed AISP, so an instance needs no
  PSD2 licence or eIDAS certificate; its free _restricted production_ mode covers accounts you
  whitelist as your own. Every request carries a JWT the app signs with the application's RSA key.
  A provider only returns `BankCsvRow[]`; `importBankRows`' `target` routes them to the right
  connection and account, so a synced movement behaves exactly like an uploaded one. Consent
  (`consent.ts`) is an unguessable reference, scoped to the caller, single-use. `sync.ts` checks
  the provider's daily read budget **before** spending a call (a 429 costs the rest of the day) and
  marks a connection `expired` on `ConsentExpiredError`. `BankConnection.provider` is `psd2_<key>`
  for a real bank and `manual`/`csv` otherwise — never offer a sync to the latter.
- **Receipt lifecycle**: `Receipt.status` is the money state (paid|pending); `Receipt.lifecycle` is
  the document state machine (`lib/services/receipts/lifecycle.ts`, pure): draft → review →
  emitted → submitted → accepted/rejected (rejected → review). Voiding is allowed from draft,
  review and emitted only. Reaching emitted/accepted archives a PDF `Document`; voiding
  soft-reverses live `PaymentAllocation` rows. Deleting a receipt reverses them too, in the delete's
  own transaction (`receiptService.delete`), because `PaymentAllocation.receipt` is `SetNull`; a
  `submitted` or `accepted` receipt cannot be deleted.
- **Receipt archive**, the one surviving use of `Document`: the archive's `description` carries
  `situs-receipt-archive:<receiptId>` — a convention, not a foreign key, and the only link between
  a receipt and the proof of its filing. Resolve it through `findExistingArchive`
  (`lib/services/receipts/service.ts`), never by rebuilding the marker.
  `GET /api/receipts/[id]/archive` exposes it; the Receipts dropdown serves that PDF before the
  client-side jsPDF copy.
- **Tax connectors**: one `TaxAuthorityConnector` row per `[userId, connectorKey]`. Sandbox and
  review simulate, transmitting nothing. `test` reaches AT's test service through `lib/tax/at/`
  (mutual TLS with the certificate AT signed, a WS-Security header, SOAP), and there only checks
  credentials and fetches receipts: issuing through it is not built, so
  `lib/tax/connectors/mode-guard.ts` refuses a receipt in it. No production AT integration exists,
  and the guard makes every other mode, `live` included, fail closed, so going live is a code
  change, not a row edit. The owner sets the mode and the Portal sub-user in Settings ›
  Integrations (`lib/services/tax/at-connection.ts`). Every call appends an immutable
  `TaxSubmissionLog` row (`GET /api/tax/connectors`, Finance › Tax Summary).
- **Alert generation**: `lib/services/notifications/notification-automation.ts` reads the rent
  ledger. `payment_due` (D-5) and `payment_overdue` (D+1/D+7) come from `RentPeriod` and quote the
  OUTSTANDING balance, so a part-paid month is chased for its balance; `rent_receipt_due` comes
  from a non-reversed `PaymentAllocation` and clears once the period has a `RentReceipt` filing.
  `paid`/`paid_late`/`waived` periods are never chased — `waived` is missing from the
  `RentPeriodStatus` union, so it is listed explicitly rather than derived from that type.
- **Audit trail**: `components/shared/audit-trail.tsx` + `GET /api/audit-trail` — pass
  `resourceIds` to scope to records (property detail Audit tab) or omit it for the account-wide
  trail. Backed by `AuditLog.resourceType`/`resourceId`, written on every workflow mutation.
- **Screen density** — apply to every main list/detail screen:
  1. **One heading per screen.** If a container renders a page title, the active tab's view does
     not repeat it — the tab label is the heading.
  2. **One stat row, 3–4 metrics at most.** Never stack two KPI rows; a metric nobody acts on
     belongs in a subtitle line, not a bordered panel.
  3. **Filters collapse behind one control only where they don't fit.** A search box plus one
     dropdown is a utility row; fold a wall of pills into a dropdown or one "Filters" popover.
     Above `lg` there is room for three or four inline dropdowns, so `SearchFilter`
     (`components/ui/search-filter.tsx`) collapses only below `lg` — by state, not `lg:hidden`,
     so the DOM holds one of each control.
  4. **Counts as text before counts as boxes** — e.g. the Portfolio subtitle,
     `"12 units · 9 occupied (75%) · €14,100/mo"`.
  5. **Every sub-view heading goes through i18n or is deleted.**

## Responsive rules (mobile-first)

`scripts/mobile-audit.mjs` measures these on every owner-facing page and overlay, in light and dark
themes.

1. **Nothing scrolls horizontally at viewport width.** Wide content (tables, grids, code) scrolls
   inside its own `overflow-x-auto` container with a sticky identity column. The audit flags
   `document.scrollingElement.scrollWidth > clientWidth`.
2. **Touch targets are ≥44px on the primary tap path.** This is the house rule; WCAG 2.2 AA's
   minimum is 24×24, and the audit fails below 24 and warns below 44. `Button`
   (`components/ui/button.tsx`) enforces it: every size below `xl` carries `max-md:min-h-11` /
   `max-md:min-w-11`, so icon buttons get a 44×44 hit area below `md` without growing on desktop.
   Text links in prose and small control-bar icons are exempt only with explicit design review.
3. **Tables declare a mobile strategy below `md`**: a card fallback for record lists (the
   `RenderTable` card mode, `components/ui/table.tsx`), or horizontal scroll with a sticky first
   column for matrices. Never an unwrapped table.
4. **Tab bars collapse only when their labels don't fit** — a space test, never a count. Measure
   `scrollWidth > clientWidth` on the `[role=tablist]` at 390px in the longest locale (Portuguese
   and Spanish labels run longest). Below `md`, hide the bar (`max-md:hidden` on `TabsList`) and
   use `TabsMobileSelect` (`components/ui/tabs.tsx`) in the same flex row as any adjacent action;
   it renders a badge as `Label (3)`. A bar that fits keeps the bar at every width.
5. **Overlays are full-bleed below `md`** and respect `env(safe-area-inset-*)`: a `Sheet` or
   full-screen overlay whose body scrolls while header, footer and primary action stay visible.
   From `md` up, a side panel or centred dialog.
6. **Multi-column forms are single-column below `md`.**

**Run the audit with `npm run audit:local`**, never against a server started by hand.
`scripts/audit-server.mjs` boots a disposable standalone app (`.next/standalone/server.js`, the
entrypoint CI and the Dockerfile use) with the environment it needs, and refuses to start when
something already answers on the port — a stale server passes every readiness check and measures
the wrong build. In CI the 390×844 pass is a blocking `--strict` gate against `BASELINE` in the
harness on every PR; a 1440×900 Portuguese pass is advisory. `scripts/build-gallery.mjs` turns a run
into one HTML page of screenshots and figures.

## CI Gates

Workflows: `ci.yml` (PRs + push to main), `security-scan.yml`, `release.yml`, `deploy-ghcr.yml`,
and `reusable-verify.yml`, which runs only via `workflow_call`. `docs/workflow-naming.md` holds the
conventions: install with a bare `npm ci`, set `cancel-in-progress` only for `pull_request`, make a
step that judges a report fail when the report is missing, boot the app with
`.github/actions/start-app`.

**Publishing.** Every merge to `main` that changes more than docs publishes a development image,
`ghcr.io/jigle/situs:main` and `:sha-<short>`. Only a release writes `:<version>` and `:latest`:
dispatch `release.yml` → merge its version-bump PR → `publish` tags `vX.Y.Z` → the tag starts
`deploy-ghcr.yml`. The tag starts it only when the `RELEASE_TOKEN` secret is set; otherwise
dispatch `deploy-ghcr.yml` against the tag ref. Full chain: `docs/REPOSITORY_PROCEDURES.md` §5.

- ESLint: `--max-warnings=0`.
- Vitest coverage is a **ratchet** in `vitest.config.ts` — statements 52 / branches 39 /
  functions 38 / lines 54. A PR may not lower it; raise it when real tests land. Keep the threshold
  keys flat: Vitest reads a nested key under `thresholds` as a glob pattern and enforces nothing.
- TypeScript: strict; `tsc --noEmit` must pass.

## Repo hygiene

`npm run hygiene` enforces these, in CI and inside `verify:ci`.

1. **Point-in-time records are deleted, not archived.** Git history is the archive:
   `git log --diff-filter=D --name-only` finds anything.
2. **Every file under `docs/` is reachable from `docs/README.md`.** Add the link in the same
   commit. "Unreferenced" never means "safe to delete" on its own.
3. **A document that states a fact about what exists is a claim with an expiry.** The commit that
   makes one false rewrites it and adds the old wording to `RETIRED_CLAIMS` in
   `scripts/check-docs.js`. Prefer deriving a status from state over asserting it in prose —
   `bankCheck` in `lib/services/admin/system-status.ts` is the pattern.
4. **A checker nothing runs is not a checker.** A gate script belongs in `npm run hygiene`. Two
   scripts are deliberately not gates: `check-hostport.js` (a prestart runtime check that skips
   unless `PRESTART_CHECK_HOSTPORT=true`) and `i18n-leak-scan.mjs` (a dev tool taking paths, with
   its companion `i18n-extract.mjs`). Wiring either would make a gate that passes because it
   skipped.

**Tailwind drops an unknown utility silently.** Add a v4 `@utility`, never a v3 plugin.
`npm run css:check` (`scripts/check-class-contract.mjs`) runs every candidate through the real
Tailwind compiler and fails at zero in both directions: a class used but not defined, and a rule in
`app/globals.css` defined but not used.

**Regenerate `package-lock.json` only with npm 11**, the `packageManager` pin. npm 10 drops the
`libc` fields that prebuilt native packages publish (`@img/sharp-*`, `@rolldown/*`, `@swc/*`,
`@next/swc-linux-*`), so npm can no longer choose between the glibc and musl builds. Count them with
`grep -c '"libc"' package-lock.json` and read the diff; zero after a regeneration means npm 10 ran.
Corepack honours the pin only after `corepack enable npm` (a bare `corepack enable` leaves npm
alone) — or run `npx npm@11 install`. CI writes the lockfile in exactly one place, the `prepare`
job in `release.yml`, which pins npm first; every other workflow runs a bare `npm ci`.

## Three ways a screen lies

Each of these passed type-check, lint and the mobile audit while the running app was wrong.

1. **`apiFetch` unwraps the envelope — do not unwrap it again.** Routes reply
   `createSuccessResponse(x)`, i.e. `{ data: x }`, and `apiFetch` returns `body.data`. Annotating
   `apiFetch<{ data: T }>` and reading `.data` yields `undefined`; a type argument asserts a shape
   rather than producing one. Defensive forms (`res.data ?? res`) are fine.
   `tests/api-envelope-contract.test.ts`.
2. **Nothing the server wrote in English reaches the screen.** Show errors through
   `useApiError()` (`lib/utils/api-error.ts`), which maps the HTTP status `apiFetch` attaches. A raw
   `fetch` throws `httpError(res.status)` rather than baking the status into a string. English under
   `app/api/**` is correct — it is a log. `tests/error-copy-contract.test.ts`.
3. **Dates take the app's locale, never the browser's.** Use `lib/utils/format-date.ts`, where
   `locale` is required. No contract test covers this rule yet.

**A stored enum is not a label** — `capitalize` and `replace(/_/g, " ")` are not a translation.
When two components render one enum, extract the map (`lib/utils/receipt-labels.ts`).
**`i18n:check:strict` cannot see an unreachable key**: it compares the four catalogues with each
other, never with what a component asks for. The type-check does that: `types/next-intl.d.ts`
types every key against `messages/en.json`, so a missing key is a compile error, and a key built
from data needs a typed map rather than a cast. `tests/i18n-no-hardcoded-copy.test.tsx` asserts
Portuguese because asserting English cannot catch hardcoded English.

**A guard that is too narrow is worse than none**, because it reports clean. Prove a new guard by
restoring the defect it describes and watching it name the file and line.

## Branching, PRs, Dependabot, releases

**`docs/REPOSITORY_PROCEDURES.md` is authoritative.** The two rules that cost the most when broken:

- **One change per PR.** Branch from current `origin/main` (`feat/`, `fix/`, `chore/`, `hotfix/`),
  or use the `claude/<id>` branch the session tool assigns. When a branch's PR merges, restart it
  from `origin/main` rather than stacking new work on it.
- **Never push onto a `dependabot/*` branch** — Dependabot can close the PR in response. Recreate
  the bumps plus the fix on `chore/deps-<group>` instead (procedures §4).

## Subagents (`.claude/agents/`)

| Agent               | Use when                                                           | Writes? |
| ------------------- | ------------------------------------------------------------------ | ------- |
| `api-route-auditor` | A PR adds/edits `app/api/**/route.ts`; any scoping or status sweep | No      |
| `ci-gate-auditor`   | A workflow, composite action, threshold or scan script changes     | No      |
| `situs-implementer` | One self-contained change, in its own worktree, ending in one PR   | Yes     |

**Delegate** broad read-only sweeps: the agent reads 40 files and returns 15 lines. The two
auditors report and never edit, and run on `sonnet`. **Don't delegate** the CI/release interlocks
(required-check names, the tag→deploy chain), work that needs this session's context, or an edit
small enough to just make. Both auditors declare `memory: project`; if memory files appear under
`.claude/agent-memory/`, review them like source before committing — a wrong lesson there spreads.

At most **3 concurrent worktrees** (each needs its own ~1.7 GB `npm ci`). Worktrees branch from the
default branch, so let dependent work merge first.

## Roadmap

`ROADMAP.md` holds shipped work and the Decisions Log, which records architectural choices and
their rationale.

## Environment

Copy `.env.example` to `.env`.

- `NEXTAUTH_URL` — base URL (e.g. `http://localhost:3000`).
- `DATABASE_URL` — SQLite file (e.g. `file:./dev.db`); optional in development, required in
  production.
- `NEXTAUTH_SECRET` — session-signing secret, at least 32 characters.
- `PII_ENCRYPTION_KEY` — 64-char hex; required in production (see PII encryption above).

**Registration is closed by default.** The first account ever created owns the instance and is
provisioned `ADMIN`; every other email is refused at the `signIn` callback before any row is
written (`lib/services/auth/registration.ts`). `AUTH_ALLOWED_EMAILS` admits a deliberate second
user. The gate fails closed: a database it cannot read refuses the sign-in. It exists because a
public instance otherwise made any Google account an administrator — and a live bank connection
requires public reachability.

Optional:

- `SMTP_HOST` (+ `SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`), `REDIS_URL`.
- Live bank connection: `ENABLE_BANKING_APPLICATION_ID` plus the RSA key —
  `ENABLE_BANKING_PRIVATE_KEY_FILE` pointing at a mounted `.pem` for a real deployment, or
  `ENABLE_BANKING_PRIVATE_KEY` inline locally; the file wins when both are set. Never base64 the
  key into a config field: a PEM is ~1,700 chars, ~2,272 as base64, over TrueNAS' 1,000-char cap.
  Without these the app is CSV-import-only and shows no connect button.
- `CRON_SECRET` gates the three `/api/cron/*` endpoints (notifications, data retention, bank sync);
  each returns 503 while it is unset.
- `METRICS_TOKEN` gates the counter endpoint, `/api/metrics`, in production; it answers 403 while
  it is unset.
- AT connection: `AT_CLIENT_CERT_FILE` and `AT_CLIENT_KEY_FILE`, the SSL certificate AT signed
  and its key, and `AT_AUTH_PUBLIC_KEY_FILE`, AT's authentication public key. Mounted files, read
  on every call (`lib/tax/at/config.ts`), never inlined. Without them nothing reaches AT and the
  test mode is refused; `/admin` warns 30 days before the certificate's 12 months run out.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
