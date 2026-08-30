# Situs — Claude Code Context

## Project Overview

Situs (rebranding in progress to **Situs // Sovereign Capital System**) is a self-hosted
property management SaaS for landlords and property managers in **Portugal and Spain**. It
handles properties, units, tenants, leases, receipts, expenses, maintenance, correspondence,
and fiscal compliance, built around a reference-month rent ledger: bank movement → match →
allocate → receipt → tax filing → audit trail.

**Current version**: see `package.json` — it was hardcoded here as 1.16.3 against a shipped
1.24.0, because a number copied into prose has no reason to move when the release does. Don't
reintroduce it. | **Stage**: Production-ready core; Situs rebrand PRs 1–12 shipped
(brand, nav, landing, portfolio tree, rent ledger, bank matching, receipt lifecycle + PT tax
connector, OCR classification, audit trail/tax dashboard, schema consolidation, a11y/e2e pass).
Deferred: People/Operations/Intelligence IA consolidation (PR 10b), full infra rename (PR 13).

## Tech Stack

| Layer      | Technology                                      |
| ---------- | ----------------------------------------------- |
| Framework  | Next.js 16 (App Router, TypeScript strict)      |
| Database   | Prisma ORM + SQLite (via better-sqlite3)        |
| Auth       | NextAuth.js v4 (Google OAuth + credentials)     |
| UI         | shadcn/ui + Tailwind CSS v4 + Radix UI + Framer |
| Validation | Zod v4                                          |
| Email      | SendGrid                                        |
| Testing    | Vitest (unit/integration) + Playwright (E2E)    |
| i18n       | next-intl (PT / EN / ES / IT)                   |
| Payments   | Stripe (card + SEPA Direct Debit)               |
| Deploy     | Docker / TrueNAS SCALE (Custom App)             |

## Key Commands

```bash
npm run dev            # Start dev server on http://localhost:3000
npm test               # Run Vitest unit/integration suite
npm run lint           # ESLint with --max-warnings=0 (CI gate)
npm run type-check     # tsc --noEmit
npm run verify         # type-check + test
npm run verify:ci      # type-check + lint + test

npx prisma db push     # Push schema changes to SQLite
npx prisma generate    # Regenerate Prisma client after schema changes
npx prisma studio      # Browse database in browser
```

## Architecture

### Directory Layout

```
app/
  api/                    # Next.js API route handlers (one folder per domain)
  [locale]/(main)/        # Owner-facing app pages (locale-prefixed)
  tenant-portal/          # Tenant self-service pages (token-based access)
components/         # Shared React components
lib/
  types.ts            # Canonical TypeScript types for all entities
  contexts/app-context.tsx  # Global AppState + AppContext (React context)
  prisma.ts            # Prisma client singleton
  services/
    allocation/       # Pure reference-month waterfall engine + Prisma orchestration
    matching/          # Pure bank-movement-to-lease confidence scoring engine
    bank/               # CSV import + fingerprint dedupe + matching pipeline
      providers/        # PSD2 provider contract + registry + Enable Banking adapter + test fake
    receipts/          # Receipt document-lifecycle state machine + orchestration
    ocr/                # Mock document classification engine + orchestration
    tax/               # Tax connector find-or-create + submission-log service
  tax/connectors/      # Per-country TaxConnector implementations (pt-at.ts)
  design/country-themes.ts  # 28-country theme table (Situs brand)
prisma/
  schema.prisma     # Database schema — source of truth
messages/           # i18n translation files (en.json, pt.json, es.json, it.json)
tests/              # Vitest unit/integration tests
e2e/                # Playwright E2E tests
```

### Key Patterns

- **4-zone modal pattern**: Status+Health / Primary Action / Issues Panel / Tabbed info — used by the Tenant edit modal (`tenant-detail-modal.tsx`) and the Ticket detail modal (`ticket-detail-modal.tsx`). Property has no modal — `property-detail-view.tsx` renders in a `Sheet` from `/portfolio?modal=<id>`; Building has no modal either.
- **AppContext**: All entities (properties, tenants, leases, receipts, expenses, tickets, buildings…) live in `AppState` via `lib/contexts/app-context.tsx` (composed from `use-app-data.ts` + `use-entity-actions.ts` + `create-entity-actions.ts`). Mutations go through typed actions (`addProperty`, `updateTenant`, etc.). Bank/tax/OCR domains (added in the Situs rebrand) are read via dedicated fetches in their own components instead — they don't live in `AppState`.
- **API routes**: Each domain has its own folder under `app/api/`. Use `GET`/`POST`/`PUT`/`DELETE` handlers with Zod validation and NextAuth session checks.
- **Compliance**: PT (`/api/compliance/rent-receipts`) and ES (`/api/compliance/nrua`) endpoints generate fiscal payloads. Tax logic lives in `app/api/tax/`.
- **PII encryption**: AES-256-GCM on IBAN, NIF, phone fields via `lib/utils/pii-encryption.ts` (`encryptPII`/`decryptPII`, keyed off `PII_ENCRYPTION_KEY`). `PII_FIELDS` declares the fields the Prisma extension encrypts on write and decrypts on read — **not** the complete list of encrypted PII. `BankAccount.iban` is encrypted at the call site in `lib/services/bank/consent.ts` and never decrypted (matching uses `ibanHash`, display uses `ibanLast4`); adding it to `PII_FIELDS` would make `/api/debug/db` start returning it in plaintext. See `docs/PRODUCT_AUDIT_2026.md` §5 for wiring status. **Fails closed in production**: `lib/utils/env.ts` exits if `PII_ENCRYPTION_KEY` is absent, because `encryptPII` silently returns plaintext without it. `ALLOW_UNENCRYPTED_PII=true` waives the check and warns loudly on every start.
- **Reference-month rent ledger** (Situs): `RentPeriod` is the persisted-derived spine — one row per lease per reference month, `status` recomputed in the same transaction as every allocation write (never hand-set). The waterfall invariant: always fill the oldest not-fully-allocated period first (`lib/services/allocation/engine.ts`, pure). `Tenant.paymentStatus` is fully derived from this ledger — the API layer refuses manual overrides.
- **Bank matching**: CSV/manual import **or a live provider sync** → fingerprint dedupe (idempotent) → fuzzy-duplicate check → reconciliation rules → weighted confidence scoring (`lib/services/matching/engine.ts`, pure). ≥0.85 auto-allocates via a draft `Receipt` (`source: "automation"`); below that, the row waits in the Bank Movements inbox (Finance tab) for a human to confirm/reassign/ignore.
- **Live bank connection**: PSD2 account information (`lib/services/bank/providers/`, Enable Banking today). Enable Banking is the licensed AISP, so an instance needs no PSD2 licence or eIDAS certificate; their free _restricted production_ mode is limited to accounts you whitelist as your own. Auth is **not** a token exchange — every request carries a JWT the app signs itself with the application's RSA key. A previous adapter spoke to GoCardless Bank Account Data, which closed to new signups in July 2025 and was removed rather than left as a button that can only fail. A provider's only job is to return `BankCsvRow[]`; `importBankRows`' optional `target` points those rows at the right connection/account, so a synced movement inherits the entire pipeline above and behaves identically to an uploaded one. Consent lives in `consent.ts` — unguessable reference, scoped to the caller, single-use. `sync.ts` enforces the provider's daily read budget **before** spending a call (429 costs the rest of the day) and marks a connection `expired` on `ConsentExpiredError` rather than reporting a quiet zero. `BankConnection.provider` is `psd2_<key>` for a real bank and `manual`/`csv` otherwise; never offer a sync to the latter.
- **Receipt lifecycle**: `Receipt.status` is the MONEY state (paid|pending); `Receipt.lifecycle` is the separate DOCUMENT state machine (`lib/services/receipts/lifecycle.ts`, pure) — draft→review→emitted→(PT)submitted→accepted/rejected, or →voided from any pre-terminal state. Reaching emitted/accepted archives a PDF `Document`; voiding soft-reverses live `PaymentAllocation` rows.
- **Tax connectors**: one `TaxAuthorityConnector` row per user×country×connector key, `mode` locked to sandbox/review until explicitly promoted to live (no live AT/AEAT integration exists yet). Every call appends an immutable `TaxSubmissionLog` row — read via `GET /api/tax/connectors` (Finance › Tax Summary tab).
- **OCR classification**: mock-only today (`lib/services/ocr/classifier.ts`, pure) — proposes a document type from filename/description keywords across all 4 locales and links to whatever entity the upload already carried. Runs best-effort on every document upload; ambiguous or unlinked results land in the Documents "Review Required" tab.
- **Generalized audit trail**: `components/shared/audit-trail.tsx` + `GET /api/audit-trail` — pass `resourceIds` to scope to specific records (property detail Audit tab) or omit for the account-wide trail (Account page). Backed by `AuditLog.resourceType`/`resourceId`, persisted on every workflow mutation.
- **Screen density (declutter rules)**: established from a 2026-07 cross-page audit that found Finance/People/Operations stacking 6–9 chrome bands (duplicate headers, duplicate KPI rows, permanent filter pills) before any real content. Apply to every main list/detail screen:
  1. **One heading per screen.** If a container already renders a page title, the active tab's own view does not repeat it — the tab label is the heading.
  2. **One stat row, capped at 3–4 metrics.** Never stack two KPI/status rows on one screen; merge them. A metric nobody acts on belongs in a subtitle line, not a bordered panel.
  3. **Filters collapse behind one control past two — where they don't fit.** A search box plus one dropdown is a utility row; a search box plus a dropdown plus a wall of pills is not — fold pills into the dropdown or a single "Filters" popover. This is a space rule, not a count rule: above `lg` there is room to show three or four dropdowns inline, and visible filters beat a popover you have to open to see what is filtered, so `SearchFilter` (`components/ui/search-filter.tsx`) only collapses below `lg`. Collapse by state rather than `lg:hidden` so the DOM holds one of each control, not two.
  4. **Counts as text before counts as boxes.** Prefer an inline subtitle (e.g. `"12 units · 9 occupied (75%) · €14,100/mo"`, the Portfolio pattern) over separate stat panels when the counts aren't independently actionable.
  5. **Every sub-view heading goes through i18n or gets deleted.** A hardcoded-English heading sitting under a translated tab label is a sign it was never load-bearing.

## Responsive design (mobile-first rules)

Codified from the 2026-07 mobile audit (`scripts/mobile-audit.mjs`): a comprehensive measurement harness that walks every owner-facing page and modal at 390×844 (Pixel 5) and 393×851 (standard phone), in light + dark themes, to measure horizontal overflow, touch targets, text legibility, and clipping. The harness reports per-surface violations, ranked by severity. Apply these rules as the baseline; per-surface judgement refines dense-data layouts within them.

1. **Nothing scrolls horizontally at viewport width.** The page body and all its first-level children must fit within the viewport. Wide content (tables, grids, code blocks) scrolls _inside its own_ `overflow-x-auto` container with a sticky identity column or first element (e.g. a table's leading column stays pinned while data columns scroll right). Measured: `document.scrollingElement.scrollWidth > clientWidth` triggers a violation; offending elements are reported by depth.

2. **Touch targets are ≥44px CSS on the primary tap path.** Button, link, and interactive-element hit areas must be at least 44×44px (WCAG 2.2 AA recommendation, aligned with the audit's target floor). `Button` (`components/ui/button.tsx`) enforces this itself: every size variant below `xl` carries a `max-md:min-h-11`/`max-md:min-w-11` floor, so icon-only buttons (`icon`/`icon-sm`/`icon-lg`) get a padded 44×44 hit area below `md` without changing their smaller desktop footprint. Text links in prose and small control bars (e.g. close icon in a modal header) can be exempt only with explicit design review; measure via `getBoundingClientRect()` in the audit harness.

3. **Tables declare a mobile fallback strategy explicitly.** At `<md` breakpoint:
   - **Card fallback** (record lists, small row counts): reformat each row as a card with labels + data in read-only field-row pairs. Typical pattern: property-selection dropdown at top, then an iterable card layout using the `RenderTable` card-mode primitive (see `components/ui/table.tsx`).
   - **Horizontal scroll with sticky identity** (matrices, high-cardinality cross-column comparison): keep the first column (tenant name, date, lease) sticky/pinned on the left; allow data columns to scroll right inside a `overflow-x-auto` container. Never render an unwrapped table on mobile.

4. **Tab bars collapse to a select/popover on mobile when the labels don't fit.** This is a space test, not a count: the rule used to say "past ~4 items", and every 4-tab bar in the app failed it anyway — People overflowed by 346px, Contacts 290px, Operations 202px, each hiding 2 of its 4 tabs off-screen. The cause is label length, not tab count; Portuguese and Spanish labels run longer than the English ones the "~4" was eyeballed against, so a count threshold will always be wrong in some locale. Measure instead: if `scrollWidth > clientWidth` on the `[role=tablist]` at 390px in the **longest** locale, it collapses. Below `md`, hide the bar and substitute a `<select>` or `Popover` (Situs brand pattern: select when navigational tabs, popover when sub-view tabs). `TabsMobileSelect` (`components/ui/tabs.tsx`) is the select-fallback primitive — pair it with `max-md:hidden` on the existing `TabsList`, and place the select in the same flex row as any adjacent action button so the row doesn't gain a line. Labels and badge counts must sync across; the primitive renders a badge as `Label (3)`. A bar that genuinely fits (the tenant portal's single tab) keeps the bar at every width.

5. **Overlays (modals, sheets, popovers) are full-bleed below `md` and respect safe-area insets.** At `<md`:
   - Render as `Sheet` (bottom-sheet style) or full-screen overlay, not a centered modal dialog. Use `sheet-scroll-strategy: "content"` so the body scrolls independently and the primary action button stays pinned to the bottom (safe area included).
   - Apply `env(safe-area-inset-*)` padding to avoid notch/home-indicator overlap on iPhone.
   - Header and footer remain visible; scrollable body in the middle. Never let the primary CTA scroll out of reach.
   - At `≥md`, switch to a side panel or centered dialog as the design specifies.

6. **Multi-column forms are single-column below `md`.** When a form has 2+ columns, stack them into one column at `<md`. Use CSS Grid with `grid-template-columns: repeat(auto-fit, minmax(300px, 1fr))` or explicit `md:` breakpoint rewrites — a form field should be full-width on small screens.

**Run it with `npm run audit:local`**, never by starting a server by hand. `scripts/audit-server.mjs`
boots a disposable app and drives both viewport passes off one server and one seed. Doing it by hand
means rediscovering five env variables one failed boot at a time — `NEXTAUTH_URL`, `ENABLE_DEMO_LOGIN`,
`ALLOW_DEMO_MODE`, `PII_ENCRYPTION_KEY`, an absolute disposable `DATABASE_URL` — each of which fails at
a different step and none of which names itself; the PII one boots and seeds fine and kills the server
several requests later. The script also refuses to start when something already answers on the port,
because a stale server answers every readiness check correctly and then the whole run measures the
wrong build while looking entirely normal. It runs `.next/standalone/server.js`, the same entrypoint
as `.github/actions/start-app` and the Dockerfile — `next start` does not drive a standalone build and
does not reproduce its routing.

All surfaces are measured in the mobile audit (`scripts/mobile-audit.mjs`) on every PR that touches UI; violations are reported in the job summary (advisory, not blocking, per the current ratchet policy). As violations are fixed, re-run the harness to confirm zero horizontal overflow, touch-target and clipping metrics strictly decreasing.

## CI Gates

Four workflows: `ci.yml` (PRs + push to main), `security-scan.yml`, `release.yml`,
`deploy-ghcr.yml`, plus `reusable-verify.yml` which only runs via `workflow_call`. There is no
`production.yml` — it duplicated `ci.yml`'s verify and build on the same event. See
`docs/workflow-naming.md` for the conventions, including four that were learned the hard way:
install with a bare `npm ci` (never a fallback that regenerates the lockfile), set
`cancel-in-progress` only for `pull_request`, a step that judges a report must fail when the
report is missing, and jobs that boot the app use `.github/actions/start-app`.

**Nothing publishes on merge.** A release is: dispatch `release.yml` → merge the version-bump
PR → `publish` tags → the tag push triggers `deploy-ghcr.yml`. Only a tag push may write
`:latest` or a bare `:<version>`; a manual deploy dispatch publishes `sha-<short>`.

- ESLint: `--max-warnings=0` — zero warnings allowed
- Vitest: ~54% line coverage, enforced as a **ratchet** in `vitest.config.ts` (statements 52 /
  branches 39 / functions 38 / lines 54) — a PR may not lower it. Raise the floor when real
  tests land. Note the threshold keys must stay flat: Vitest reads a nested key under
  `thresholds` as a glob pattern, so the old `global: { ... }` wrapper matched nothing and
  enforced nothing.
- TypeScript: strict mode, `noEmit` check must pass

## Repo hygiene

Four rules, each of which the repo has already broken. `npm run hygiene` enforces them and runs
inside `verify:ci`, so CI, the `situs-implementer` agent and any local run all pick it up.

1. **Point-in-time records are deleted, not archived.** Git history is the archive. `docs/archive/`
   held 27 files and was removed; do not recreate it. `git log --diff-filter=D --name-only` finds
   anything you need.
2. **Every file under `docs/` is reachable from `docs/README.md`.** Adding a doc means adding the
   link in the same commit. 24 were reachable from nothing before this was checked — and three of
   those documented live code, so "unreferenced" never means "safe to delete" on its own.
3. **A document that states a fact about what exists is a claim with an expiry.** "There is no live
   bank connection", "nothing publishes on merge", a version number, a branch name. The commit that
   makes one false is the commit that rewrites it. When you retire one, add it to `RETIRED_CLAIMS`
   in `scripts/check-docs.js` so it cannot come back. Prefer deriving a status from state over
   asserting it in prose — `bankCheck` in `lib/services/admin/system-status.ts` is the pattern.
4. **A checker nothing runs is not a checker.** `scripts/check-*` belongs in `npm run hygiene` or
   it does not belong in the repo. Nine existed and CI ran two; the other seven passed or failed
   into the void for months. Two are deliberately **not** gates and must stay out:
   `check-hostport.js` (a prestart runtime check, skips unless `PRESTART_CHECK_HOSTPORT=true`) and
   `i18n-leak-scan.mjs` (a dev tool taking path arguments). Wiring either would produce a gate that
   passes because it skipped.

**Tailwind drops an unknown utility silently**, which is how six overlay primitives (dialog,
alert-dialog, dropdown-menu, select, sheet, notification-center) shipped `animate-in`,
`fade-in-0`, `zoom-in-95` and `slide-in-from-*` while animating nothing: those classes live in
`tailwindcss-animate`, a Tailwind **3** plugin that was never installed here. A class that does
nothing looks exactly like a class that works, in review and in the diff — the first repair even
added `slide-in-from-left-1` against markup that says `slide-in-from-left-1/2`, and nothing
noticed for another whole commit. `npm run css:check` (`scripts/check-class-contract.mjs`) closes
that in both directions: **used but not defined** is blocking at zero, **defined but not used** is
a ratchet over `app/globals.css`. Tailwind itself is the oracle — candidates go through the real
compiler via `@source inline(...)` and the generated selectors are read back — so the checker
needs no hand-maintained list of valid utilities and survives Tailwind upgrades untouched. Add a
v4 `@utility`, never a v3 plugin.

**Regenerating `package-lock.json` takes npm 11**, which `packageManager` in `package.json` pins.
npm 10 rewrites the lockfile without the `libc` fields, and the only packages that carry them are
the four `@next/swc-linux-*` binaries — Next.js publishes `libc` in their manifests, and nothing
else in this tree does. Losing them costs npm the glibc/musl filter for those four, so both
variants get considered instead of the right one. Nothing breaks; the diff is just noise that
reappears every time an npm 10 user installs.

Corepack only honours the pin once `corepack enable` has run, so on a machine without it `npm`
is still whatever Node bundled. Check with `npm -v` before regenerating, or use `npx npm@11 install`
and skip the question. CI never regenerates — every workflow runs a bare `npm ci` — so this is a
local concern only.

## Three ways a screen lies, and the contracts that catch them

The 2026-08 cross-surface audit found three defect classes that share one shape: **the code
asserted something the runtime had already made false, and every gate agreed.** Type-check
passed, lint passed, the mobile harness scored the surfaces `ok`. Each was found by looking at
the running app, and each is now a contract test under `tests/` that `npm test` runs — so the
reasoning is here and the enforcement is there.

1. **`apiFetch` unwraps the envelope. Do not unwrap it again.** Routes reply
   `createSuccessResponse(x)` — `{ data: x }` — and `apiFetch` returns `body.data` when it is
   present. Three call sites annotated the call `apiFetch<{ data: T }>` and then read `.data`
   off the result, so they received `undefined`: the document detail panel showed
   "Document not found" for every document that exists, and the bank picker listed zero
   institutions, which hid the connect button being broken one line below it. A type argument
   asserts a shape rather than producing one, which is why nothing disagreed. Defensive forms
   (`res.data ?? res`) stay legal. `tests/api-envelope-contract.test.ts`.

2. **Nothing the server wrote in English reaches the screen.** `createErrorResponse` puts an
   English sentence in the envelope; twenty-seven components rendered `err.message` into a
   banner or toast, so the failure path was the last English left in a Portuguese app. Use
   `useApiError()` (`lib/utils/api-error.ts`), which maps the HTTP status `apiFetch` already
   attaches. A raw `fetch` must throw `httpError(res.status)` rather than baking the status into
   a string, or the resolver cannot tell a 500 from a dropped connection. English under
   `app/api/**` is correct and deliberately exempt — that is a log for whoever reads stderr.
   `tests/error-copy-contract.test.ts`.

3. **Dates take the app's locale, never the browser's.** `toLocaleDateString()` with no argument
   follows the browser, which is not the language the user chose — twenty-two sites did this,
   four through near-identical private helpers. Use `lib/utils/format-date.ts`, where `locale`
   is required rather than defaulted, because a default is how the argument goes missing again.

Two related habits worth keeping, both learned the same way. **A stored enum is not a label**:
`capitalize` and `replace(/_/g, " ")` are formatting rules standing in for a translation, and
they shipped `partially_paid` and "Rent" into Portuguese screens. When two components render one
enum, extract the map (`lib/utils/receipt-labels.ts`, `lib/utils/maintenance-labels.ts`) rather
than copying it — copying is what let them drift. And **`i18n:check:strict` cannot see this**: it
compares the four catalogues to each other, never to what a component asks for, so a key can be
complete in four languages and unreachable from the UI. `tests/i18n-no-hardcoded-copy.test.tsx`
asserts Portuguese for exactly that reason — asserting English cannot catch a component that
hardcodes English, because the hardcoded string is the expected string.

**A guard that is too narrow is worse than none**, because it reports clean. The envelope
contract first understood only `const x = await apiFetch(…)` and would have passed
`document-detail-panel.tsx` while it rendered an apology for every document; the i18n tripwire's
first version passed `resourceIds={[]}`, which returns before fetching, so it asserted against a
component that never made a request. Prove a new guard by restoring the defect it describes and
watching it name the file and line.

## Development Branch

All Claude Code changes go to: **`claude/proman-design-polish-6zpz2f`**

The name says `proman` because the branch predates the rename to Situs and renaming it now would
orphan the open history. Do not "correct" it to `situs-…` — this line said that for a while and
sent sessions looking for a branch that does not exist.

## Subagents (`.claude/agents/`)

Three project agents, auto-delegated when the task matches their `description`:

| Agent               | Use when                                                           | Writes? |
| ------------------- | ------------------------------------------------------------------ | ------- |
| `api-route-auditor` | A PR adds/edits `app/api/**/route.ts`; any scoping or status sweep | No      |
| `ci-gate-auditor`   | A workflow, composite action, threshold or scan script changes     | No      |
| `situs-implementer` | One self-contained change, in its own worktree, ending in one PR   | Yes     |

**Delegate** broad read-only sweeps — the agent reads 40 files and returns 15 lines, instead of
40 files landing in the main context. That is the whole token argument, and it is the reason the
auditors are `tools: Read, Grep, Glob`-only and run on `sonnet` rather than opus.

**Don't delegate** anything spanning the CI/release interlocks (required-check name matching,
the tag→deploy chain, the false-green history), anything needing the current session's
accumulated context, or edits small enough to just do — a spawn costs more than a two-line fix.
A cold agent handed "fix the CI workflows" writes plausible YAML and misses all three interlocks.

Both auditors carry `memory: project`, so what they learn lands in `.claude/agent-memory/<name>/`
and is committed. That is what stops the cold start from being paid twice. Review those files
like any other source — a wrong lesson recorded there propagates.

At most **3 concurrent worktrees**: `node_modules` is 1.7 GB and each worktree needs its own
`npm ci`. Worktrees branch from the default branch, not the parent's HEAD, so let dependent work
merge first rather than running it in parallel.

## Dependabot PRs

**Never push commits directly onto a `dependabot/*` branch to fix an issue the bump introduced.**
Dependabot treats external commits on its own branches as interference and can abandon/close the
PR in response (observed firsthand: pushing a fix to `dependabot/npm_and_yarn/production-minor-*`
got PR #276 silently closed, its branch desynced from GitHub's own PR/CI view even though the
git ref itself was correct — wasted a long back-and-forth before the closure was noticed). If a
Dependabot bump needs a fix (a lockfile conflict, a genuine break like a duplicate transitive
dependency), don't touch its branch — recreate the same version bumps plus the fix on a fresh
branch of your own (e.g. `chore/deps-<group-name>`), verify, and open a new PR instead. Let the
original Dependabot PR close on its own once superseded.

## Roadmap

See `ROADMAP.md` for full task history. All Q3 sprints (Phases 0–7) are complete. The `ROADMAP.md` Decisions Log records architectural choices and their rationale.

## Environment

Copy `.env.example` to `.env` before first run. Required vars:

- `DATABASE_URL` — SQLite file path (e.g. `file:./dev.db`)
- `NEXTAUTH_SECRET` — random secret for session signing
- `NEXTAUTH_URL` — base URL (e.g. `http://localhost:3000`)

Required in production: `PII_ENCRYPTION_KEY` (64-char hex; the app exits without it)

**Registration is closed by default.** The first account ever created owns the instance and is
provisioned `ADMIN`; every other email is refused at the `signIn` callback, before any row is
written (`lib/services/auth/registration.ts`). `AUTH_ALLOWED_EMAILS` is the additive escape hatch
for a deliberate second user. This exists because the OAuth `signIn` callback used to `return true`
unconditionally while the JWT callback hardcoded `role: "ADMIN"` — so any Google account that
signed in to a publicly reachable instance became an administrator, and a live bank connection
_requires_ public reachability for the consent callback. The gate fails closed: a database it
cannot read refuses the sign-in rather than admitting it.

Optional: `SENDGRID_API_KEY`, `STRIPE_SECRET_KEY`, `REDIS_URL`

Optional (live bank connection — PSD2 account information via Enable Banking):
`ENABLE_BANKING_APPLICATION_ID`, plus the RSA key — `ENABLE_BANKING_PRIVATE_KEY_FILE` pointing at a
mounted `.pem` for any real deployment, or `ENABLE_BANKING_PRIVATE_KEY` inline for a local run. The
file wins when both are set. **Do not base64 the key to fit a config field**: a PEM is ~1,700 chars
and base64 makes it ~2,272, against TrueNAS' 1,000-char cap, so no encoding fits — mounting is the
only route, and it keeps the key out of `/proc/<pid>/environ` besides. Absent, the app is
CSV-import-only and renders no connect button.
`CRON_SECRET` gates all three `/api/cron/*` endpoints (notifications, data retention, bank sync);
each returns 503 while it is unset, so nothing runs on a schedule until it is set.

Optional (app subscription billing — Free/Pro/Business landing-page tiers, distinct from
tenant rent collection): `STRIPE_PRICE_ID_PRO`, `STRIPE_PRICE_ID_BUSINESS`,
`STRIPE_TRIAL_DAYS_PRO`, `ENABLE_BILLING` (plan-limit enforcement; off by default, so
self-hosted instances are always unlimited).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
