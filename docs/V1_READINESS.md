# Situs V1 pilot — readiness assessment

**Date**: 2026-08-13 · **Against**: `main` @ `3e76b2a` · **Version**: 1.24.0

**Verdict: READY WITH KNOWN LIMITATIONS.**

The domain core is in better shape than a first read of the codebase suggests. The rent ledger
is genuinely the source of truth, allocation is transactional, bank import is idempotent, and the
receipt lifecycle is a real state machine with a full transition table.

> ## Update — all three P0 items are now closed
>
> This report was written before the fixes. **D1, D2 and D3 below describe the state that has
> since been repaired**, and are kept as written because the reasoning is the record of why the
> fixes look the way they do. Each is annotated with what changed.
>
> | Item                                 | Status     | Fix                                                                                                                                                                         |
> | ------------------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | D1 — connector fabricates acceptance | **Closed** | `SIMULATED_MODES` in `pt-at.ts`; `submit`/`poll` refuse and log any other mode. 14 cases in `pt-at.test.ts`; 11 fail against the old code                                   |
> | D2 — lifecycle transition not atomic | **Closed** | Void now runs the reversal and the lifecycle write in one `$transaction`; `reverseAllocationsForReceipt` takes an optional `tx`. 4 cases; 2 discriminate                    |
> | D3 — unrounded tax aggregation       | **Closed** | `lib/utils/money.ts` (`round2`, `sumMoney`, `MONEY_EPSILON`), applied at the income-summary and distribution tax boundaries. Engine re-points at it, its 13 tests unchanged |
>
> **The B-section testing gap is only partly closed.** `service.transaction.test.ts` now pins the
> transaction boundary structurally — every write lands on the `tx` handle, never the base
> client — but it uses a mocked Prisma client and **does not exercise SQL**. A real integration
> test needs a database, and `prisma db push` is blocked by Prisma's AI-agent guard (the same
> reason two existing integration files fail locally). That guard was not bypassed. **The
> DB-level integration test remains open as P1.**
>
> Suite: **1,014 passing**, up 28.

## How to read this

Every claim below cites a file. Anything not directly verified is marked **UNVERIFIED** rather
than assumed — several sections of the V1 brief were not covered in this pass and say so.

---

## A. Working — verified

| Area                            | Evidence                                                                                                                                                                                                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Allocation engine**           | `lib/services/allocation/engine.ts` — pure, no I/O. Float-safe by deliberate design: `EPSILON = 0.005` (half a cent) and `round2()` at every comparison. 13 test cases in `engine.test.ts`.                                                                                   |
| **Allocation write is atomic**  | `lib/services/allocation/service.ts:133` — `prisma.$transaction`. The `PaymentAllocation` insert, `RentPeriod` recompute and derived `tenant.paymentStatus` all occur inside the same `tx`. The ledger invariant holds under partial failure.                                 |
| **Reversal is non-destructive** | `reverseAllocationsForReceipt` (same file, ~line 247) sets `reversedAt` + `reversalReason` and recomputes period status, inside a transaction. Financial history is preserved by compensating record, not overwritten — this satisfies the brief's §8 correction requirement. |
| **Bank import idempotency**     | `lib/services/bank/import.ts:316-325` — `computeFingerprint` plus a `fingerprint` unique constraint and a pre-insert `findUnique`. Re-importing the same statement is a no-op.                                                                                                |
| **Matching engine**             | `lib/services/matching/engine.ts` — 12 test cases including the equal-rent ambiguity guard ("top-two too close → needs_review, never auto") and the fuzzy-duplicate window.                                                                                                   |
| **Receipt state machine**       | `lib/services/receipts/lifecycle.ts` — explicit `TRANSITIONS` table, 12 test cases pinning every edge including terminality of `accepted`/`voided`. Money state (`status`) and document state (`lifecycle`) are correctly separate.                                           |
| **API authorization**           | ~141 routes swept; the IDOR in `/api/distributions`, six body-trusted foreign-key create paths, and the tax-rules privilege gap were fixed in PR #330. Guarded by `app/api/tenant-scoping.test.ts` and `income-distribution.scoping.test.ts`.                                 |
| **Prisma error handling**       | Prisma codes are _mapped_, not leaked — `P2002`/`P2025` handled in `units`, `tax-rules` and elsewhere.                                                                                                                                                                        |
| **CI gates**                    | Repaired in PR #329 and independently re-verified. 986 unit tests pass.                                                                                                                                                                                                       |

---

## B. Incomplete

**No integration test for the allocation write path.** `engine.test.ts` tests a pure function.
`service.ts` — the `$transaction`, the period recompute, the derived `tenant.paymentStatus` — has
no test at all. The single most important invariant in the product ("status recomputed in the same
transaction as every allocation write") is asserted nowhere. **This was the biggest testing gap.**

**PARTLY CLOSED.** `service.transaction.test.ts` pins the boundary structurally — 6 cases
asserting every write lands on `tx` and never the base client, that the tenant recompute reads
inside the same transaction, that reversal is soft (`reversedAt` + reason, never a delete), and
that audit runs only after the transaction resolves. It uses a mocked Prisma client and does
**not** exercise SQL. A DB-backed integration test is still needed, and still blocked by the
Prisma agent guard.

**Spain has no tax connector.** `lib/tax/connectors/` contains only `pt-at.ts` and `types.ts`.
ES functionality exists (`lib/compliance/nrua-export.ts`, `/api/compliance/nrua`, the
`NRUARegistration` model) but sits outside the `TaxConnector` abstraction, so the brief's
"separate country connectors" requirement is half-met. The abstraction is sound; ES simply has not
been moved behind it.

**Scenario 4 (multi-month payment) is only indirectly covered.** `engine.test.ts` proves
overpayment carry-forward at 1.5× rent and beyond-horizon reporting, but no case asserts the exact
brief scenario: €2,500 against two €1,250 months producing two full allocations.

**Portal tokens cannot be revoked.** Expiry is enforced, but a leaked token stays valid until
`exp`. There is no revocation list or token version.

---

## C. Broken

**Nothing found broken in the core workflow.** No non-atomic ledger write, no duplicate-processing
path, no destructive financial mutation.

---

## D. Dangerous — the three P0 items

### D1. The tax connector fabricates an acceptance, and never checks `mode`

`lib/tax/connectors/pt-at.ts` — `submit()` synthesises a submission id
(`${mode.toUpperCase()}-${id}-${Date.now()}`), marks the receipt `submitted`, and returns
`202`. `poll()` then unconditionally sets the receipt to `accepted` with response code `200`.

**Neither function branches on `connector.mode`.** The comment says "sandbox/review connectors
auto-accept" — but nothing restricts that behaviour to sandbox/review.

Why this is P0 for a pilot: the risk is not that test data reaches the Autoridade Tributária. It
is the opposite. If `mode` is ever set to `live`, the system reports rent receipts as **accepted by
the tax authority when nothing was ever submitted**. A landlord would believe they had filed. A
false fiscal record is worse than a visible failure.

What currently prevents it, and why that is not enough:

- No API route sets `mode`; `app/api/tax/connectors/route.ts` is read-only.
- `ensureConnector` always creates with `mode: "review"`.
- No connector makes any network call.

So the system is safe **by absence of an integration**, not by enforcement. `mode` is an
unconstrained `String` in the schema (`@default("review")`, comment `sandbox|review|live`) with no
enum and no check constraint, so `"live"`, `"Live"` or `"sandbox "` are all storable by a direct
DB edit — and "let's switch it to live" is exactly what someone will try first.

**FIXED.** `SIMULATED_MODES = {sandbox, review}` in `pt-at.ts`; `submit()` and `poll()` refuse
anything else, write a `TaxSubmissionLog` row (a silent refusal is its own failure mode — the
operator who flipped the mode has to be able to find out why nothing is submitting) and return
an error before any receipt state changes. Going live now means implementing the endpoint and
widening that set, not editing a column.

**The schema enum was deliberately NOT added.** Narrowing a live `String` column needs
`prisma db push`, which `AUTO_DB_SCHEMA_SYNC` applies on the next container start and which
fails if any existing row holds an off-list value — migration risk on a running instance for
marginal gain, since no API route writes `mode` at all. The code guard is the load-bearing
part. Deferred, with that reasoning.

### D2. The receipt lifecycle transition is not atomic

`lib/services/receipts/service.ts:145-175` performs four independent writes with no enclosing
transaction:

1. `archiveReceipt(receipt)` — creates a `Document`
2. `reverseAllocationsForReceipt(...)` — its own separate `$transaction`
3. `prisma.receipt.update({ lifecycle: to })`
4. `logAudit(...)` — further writes

A failure between (2) and (3) on a **void** leaves allocations reversed while the receipt still
reads `emitted`: the rent period shows unpaid, the receipt claims otherwise. That is precisely the
"missing transaction boundary" the brief's §6 asks about, on the one path that moves money
backwards.

The emit path is less severe — `findExistingArchive` makes archiving idempotent — but a crash
still leaves an orphaned archive `Document`.

**FIXED.** The void branch now runs the reversal and the `receipt.lifecycle` write inside one
`$transaction`, with `reverseAllocationsForReceipt` taking an optional `tx` so it joins the
caller's transaction (Prisma cannot nest). `logAudit` stays outside on purpose: an audit write
failing must not roll back a correct reversal — a missing audit row is recoverable, a
half-reversed ledger is not. Archiving also stays outside, because holding a transaction open
across file I/O is its own problem and `findExistingArchive` already makes it idempotent.

### D3. Float aggregation outside the ledger

33 schema fields are Prisma `Float`. **The ledger defends itself** (D-above: `EPSILON`, `round2`),
so this is not a call to migrate to integer cents — that would be a 33-field change across every
money-handling service on a live instance, and the brief's §15 warns against exactly that.

The real exposure is the code that does _not_ apply the engine's discipline:

- `app/api/tax-filings/income-summary/route.ts:48,52` — same pattern

Dashboard drift is cosmetic. A tax-filing figure is not.

**FIXED at the tax boundaries.** `lib/utils/money.ts` now holds `round2`, `sumMoney` and
`MONEY_EPSILON`; the allocation engine imports them rather than defining its own (its 13 tests
pass unchanged, proving no behaviour change). Applied to `income-summary`'s `grossIncome` and
`deductibleExpenses`, and to the three `getAnnualTaxSummary` totals that feed
`generatePortugalTaxForm` / `generateSpainTaxForm`, plus the `calculateDistribution` totals.

`lib/services/analytics-service.ts` was deleted with the Intelligence surface in the scope
cutdown, so the remaining P2 exposure went with it.

---

## E. Cosmetic

- `CLAUDE.md` states **"Current version: 1.16.3"** against a shipped **1.24.0** — eight minor
  versions stale, in the file loaded into every AI session.
- 15 API routes echo `error.message` into a 500 body. Most are health/debug/download endpoints, so
  low exposure, but `/api/distributions` is user-facing.
- ~~`docs/archive/` (376K) and `docs/archived-workflows/` (28K) still describe the Helm/Kubernetes~~
  **Resolved 2026-08-17**: both directories deleted. Git history retains them. Originally:
  deployment path removed in PR #328.

**UNVERIFIED**: empty states, loading states, table sorting/filtering, form validation behaviour
and financial-display completeness (§11) were **not** sampled in this pass. 15 components reference
an empty-state pattern; whether coverage is adequate across ~20 feature areas is unknown. i18n gap
analysis was also not performed.

---

## F. Deferred — explicitly outside V1

- **Owner/admin control page** (user payments, usage, tickets) — requested, deliberately after
  polish of existing functionality.
- **Live bank connection** — V1 bank integration is manual/CSV import.
- **Live tax submission** for PT and ES.
- **Money → integer cents migration** — decided against; rationale in D3.

---

## Scenario coverage (brief §5)

| #   | Scenario                 | Covered     | Where                                                                                                  |
| --- | ------------------------ | ----------- | ------------------------------------------------------------------------------------------------------ |
| 1   | Normal payment           | ✅          | `engine.test.ts` — "exact rent → allocates to next unfilled", "oldest unpaid month is settled first"   |
| 2   | Partial payment          | ✅          | "partial payment fills the oldest period partially"                                                    |
| 3   | Second partial completes | ✅          | "second partial completes the period"                                                                  |
| 4   | Multi-month payment      | ⚠️ Indirect | Overpayment carry-forward at 1.5×; no explicit 2× → two months case                                    |
| 5   | Ambiguous movement       | ✅          | `matching/engine.test.ts` — "equal-rent ambiguity guard: top-two too close → needs_review, never auto" |
| 6   | Duplicate movement       | ⚠️ Partial  | Fuzzy-duplicate flagging tested; exact `fingerprint` idempotency has no test                           |
| 7   | Receipt lifecycle        | ✅          | `lifecycle.test.ts` — all edges incl. terminal states                                                  |
| 8   | Correction / reversal    | ⚠️ Partial  | `receipts/service.test.ts` references reversal; the DB-level effect on `RentPeriod` is untested        |

**All engine-level coverage is on pure functions.** No test exercises the persisted path from bank
movement through allocation to rent-period status.

---

## External integrations — honest status

```
Bank:        CSV import only — no PSD2 adapter ships. Provider abstraction:
             VERIFIED — lib/services/bank/providers/ holds the contract and a
             registry, exercised by a fake provider rather than a vendor, and
             importBankRows takes a target so a synced movement would use the
             same pipeline as an uploaded one.

Portugal:    Sandbox / review / preparation only. No live AT endpoint.
             Enforced: pt-at.ts calls refuseUnsupportedMode (D1 closed).

Spain:       Sandbox / review / preparation only. No live MITMA endpoint.
             es-nrua.ts is registered in the connector registry and calls the
             same shared mode guard.
```

Three of these lines were stale as of 2026-08-17 and are corrected here: the bank was described as
CSV-only with an unverified abstraction, Portugal as unenforced, and Spain as having no connector at
all. Each had been fixed in code without this block being reread. **Treat every line here as a claim
with an expiry** — the commit that makes one false is the commit that rewrites it.

---

## Priorities

**P0 — before pilot: all three closed.**

1. ~~Tax connector fails closed on `mode: "live"`~~ — **done**. The schema enum was deliberately
   skipped; reasoning in D1.
2. ~~Wrap the receipt lifecycle transition in a single transaction~~ — **done**.
3. ~~`round2()` on tax-path aggregations~~ — **done**.

**P1 — required for a credible pilot** 4. Integration test for the allocation write path — the untested core invariant. _(medium)_ 5. Explicit multi-month and fingerprint-idempotency test cases. _(small)_ 6. E2E happy path asserted end to end through receipt and audit trail. _(medium)_

**P2 — strongly desirable** 7. UX pass: empty/loading/error states, financial display completeness. _(medium — scope unknown until sampled)_ 8. Move ES/NRUA behind `TaxConnector`. _(medium)_ 9. Portal token revocation. _(small)_ 10. Analytics float rounding; stop echoing `error.message` in user-facing 500s. _(small)_

**P3 — done 2026-08-17** 11. Doc consolidation, `docs/archive*` pruning, `CLAUDE.md` version.

---

## V1 workflow verdict

```
Property → Unit → Tenant → Lease → Rent Period → Bank Movement
        → Match → Allocation → Receipt → Audit Trail
```

**Holds structurally.** Every stage exists, the ledger is the source of truth, allocation is
transactional and derived state is never hand-set.

**Not yet proven end to end.** Every assertion above the E2E layer is on pure functions; the
persisted path has no integration test. The verdict rests on code reading plus unit tests, not on a
demonstrated run. Closing P1 #4 and #6 is what turns "holds structurally" into "verified".

## Test results (actually run)

| Gate              | Result                                                                                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit (`npm test`) | **1,014 passed**, 3 skipped (up 28)                                                                                                                                   |
| Integration       | 2 files fail — `product-events` and `pii-extension` shell out to `prisma db push`, blocked by Prisma's AI-agent guard. Identical on clean `main`. Guard not bypassed. |
| Lint              | Pass (`--max-warnings=0`)                                                                                                                                             |
| Type-check        | Pass                                                                                                                                                                  |
| Prettier          | Pass                                                                                                                                                                  |
| E2E               | **Not run in this pass** — label-gated in CI                                                                                                                          |
| Build             | Verified green in CI on `main`                                                                                                                                        |
