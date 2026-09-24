import { test, expect, type APIRequestContext } from "@playwright/test";

test.use({ storageState: "playwright/.auth/user.json" });

/**
 * Critical Path: the whole money chain in one run.
 *
 * Sixteen specs existed before this one and every stage below was touched by at least one of
 * them — but always in isolation, against whatever the database happened to contain. Nothing
 * asserted that the stages CONNECT: that the movement you import is the one that gets matched,
 * that the match produces the receipt, that the receipt moves the reference month, and that the
 * audit trail can still name every step afterwards. A broken join between two stages would leave
 * all sixteen green.
 *
 * So this walks one payment from one landlord's bank statement to a filed receipt, carrying the
 * ids forward and asserting each stage acted on the previous stage's output:
 *
 *   property → tenant → lease → bank movement → confirm → allocation → rent period → receipt
 *   → emit → audit trail
 *
 * DRIVEN THROUGH THE API, NOT THE UI. Deliberate. The chain is what is under test, and this
 * suite's documented failure mode is selector drift silently disarming a spec (see auth.setup.ts
 * and workflow-payment.spec.ts). Every request below goes through the real route handlers, real
 * Zod validation, real auth middleware, real Prisma and real SQLite — the whole stack minus the
 * rendering layer, which the other specs already cover.
 *
 * THE FIRST PAYMENT IS NOT AUTO-MATCHED, AND THAT IS THE POINT. A first-time payer scores
 * name .25 + amount .20 + reference .10 = 0.55 against a 0.85 threshold, because the engine has
 * never seen their IBAN. The row waits in the inbox for a human — that IS the product's happy
 * path for a new tenant, not a degraded one. The second payment then auto-matches on the IBAN it
 * learned from the first, which is the behaviour worth proving and which no spec covered.
 */

const STAMP = Date.now();
const RENT = 1250;
/**
 * Every TOKEN in the name must be unique per run, not just the name as a whole.
 *
 * The matcher scores names by token overlap: `hits / min(tokenCount)`, matching at ≥ 0.5. With
 * `Chain Tenant ${STAMP}` two of three tokens ("chain", "tenant") are shared with every previous
 * run, giving 0.67 — so old runs' leases scored an identical 0.55, tied with this run's, and the
 * matcher suggested one of THEM. The confirm then registered as OVERRIDE_MATCH rather than
 * CONFIRM_MATCH, which is what the scoped audit assertion below caught.
 *
 * Welding the stamp into each token leaves nothing to overlap.
 */
const TENANT_NAME = `Chain${STAMP} Tenant${STAMP}`;

/**
 * The IBAN must be unique per run, and this is not cosmetic — it is the whole reason this spec
 * is repeatable.
 *
 * The IBAN is the matcher's LEARNING KEY: step 9 exists because confirming a movement teaches
 * the engine that this IBAN belongs to this lease. A fixed IBAN therefore means every run
 * teaches the next one. On the second run the engine finds two leases that both score a perfect
 * 1.0, the equal-rent guard correctly refuses to choose between them (`ambiguous_candidates`),
 * and step 9 fails — against completely correct product behaviour.
 *
 * Observed, not theorised: with a fixed IBAN the first run passed and the second reported
 * confidence 1.0 with `ambiguous_candidates`. A spec that only passes against a clean database
 * is a spec that will be deleted the first time someone runs it twice.
 */
const TENANT_IBAN = `PT50${String(STAMP).padStart(21, "0")}`;

/** UTC first-of-month, N months back from today. */
function monthStart(monthsAgo: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1));
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * State-changing routes are CSRF-guarded with a double-submit cookie, so the token has to be
 * fetched and echoed back. Without this every POST below returns 403 and the test would fail on
 * step one rather than telling you why.
 */
async function csrfHeader(request: APIRequestContext): Promise<Record<string, string>> {
  await request.get("/api/csrf-token");
  const { cookies } = await request.storageState();
  const token = cookies.find((c) => c.name === "csrf-token")?.value;
  expect(token, "no csrf-token cookie after GET /api/csrf-token").toBeTruthy();
  return { "x-csrf-token": token as string };
}

/** Unwraps `{ data }` and fails with the body text rather than a bare status code. */
async function postJson<T>(
  request: APIRequestContext,
  url: string,
  data: unknown,
  headers: Record<string, string>,
): Promise<T> {
  const res = await request.post(url, { data, headers });
  expect(res.ok(), `POST ${url} → ${res.status()}: ${await res.text()}`).toBe(true);
  return (await res.json()).data as T;
}

async function putJson<T>(
  request: APIRequestContext,
  url: string,
  data: unknown,
  headers: Record<string, string>,
): Promise<T> {
  const res = await request.put(url, { data, headers });
  expect(res.ok(), `PUT ${url} → ${res.status()}: ${await res.text()}`).toBe(true);
  return (await res.json()).data as T;
}

async function getJson<T>(request: APIRequestContext, url: string): Promise<T> {
  const res = await request.get(url);
  expect(res.ok(), `GET ${url} → ${res.status()}: ${await res.text()}`).toBe(true);
  return (await res.json()).data as T;
}

test("Critical Path: a bank movement becomes a filed receipt, and the audit trail proves it", async ({
  request,
}) => {
  test.slow(); // ten sequential round trips plus a PDF archive

  const headers = await csrfHeader(request);
  const leaseStart = monthStart(1); // last month, so two reference months exist
  const firstPaymentDate = monthStart(1);
  const secondPaymentDate = monthStart(0);

  // ---------------------------------------------------------------- 1. the property
  const property = await test.step("create a Portuguese property", async () => {
    const created = await postJson<{ id: string }>(
      request,
      "/api/properties",
      {
        name: `Chain Property ${STAMP}`,
        address: `Rua da Cadeia ${STAMP}, Lisboa`,
        type: "apartment",
        bedrooms: 2,
        bathrooms: 1,
        rent: RENT,
        // POST /api/properties validates with `propertySchema`, not `createPropertySchema`, so
        // `status` is required here even though it reads like a server-derived field.
        status: "occupied",
      },
      headers,
    );
    expect(created.id, "property was created without an id").toBeTruthy();
    return created;
  });

  // ---------------------------------------------------------------- 2. the tenant
  const tenant = await test.step("create the tenant", async () => {
    const created = await postJson<{ id: string }>(
      request,
      "/api/tenants",
      {
        name: TENANT_NAME,
        email: `chain-${STAMP}@example.test`,
        propertyId: property.id,
        rent: RENT,
      },
      headers,
    );
    expect(created.id).toBeTruthy();
    return created;
  });

  // ---------------------------------------------------------------- 3. the lease
  const lease = await test.step("create an active lease over both", async () => {
    const created = await postJson<{ id: string }>(
      request,
      "/api/leases",
      {
        tenantId: tenant.id,
        propertyId: property.id,
        startDate: isoDate(leaseStart),
        endDate: isoDate(new Date(Date.UTC(leaseStart.getUTCFullYear() + 1, 0, 1))),
        monthlyRent: RENT,
        deposit: RENT,
        status: "active",
      },
      headers,
    );
    expect(created.id).toBeTruthy();
    return created;
  });

  // ---------------------------------------------------------------- 4. the bank movement
  const firstReference = `renda ${STAMP}`;
  let importJobId = "";
  const movement = await test.step("import the tenant's first transfer", async () => {
    const summary = await postJson<{
      jobId: string;
      imported: number;
      autoMatched: number;
      needsReview: number;
    }>(
      request,
      "/api/bank/import",
      {
        rows: [
          {
            bookingDate: isoDate(firstPaymentDate),
            amount: RENT,
            counterpartyName: TENANT_NAME,
            counterpartyIban: TENANT_IBAN,
            reference: firstReference,
          },
        ],
      },
      headers,
    );

    importJobId = summary.jobId; // the resourceId IMPORT_BANK_TRANSACTIONS is logged against
    expect(summary.imported, "the movement did not import").toBe(1);
    // A first-time payer has no known IBAN, so 0.55 < 0.85 and the row waits for a human.
    // Asserting this rather than tolerating either outcome: if it started auto-matching, the
    // confidence weights changed and someone should find out from this test.
    expect(summary.autoMatched).toBe(0);
    expect(summary.needsReview).toBe(1);

    const inbox = await getJson<{ id: string; reference: string; status: string }[]>(
      request,
      "/api/bank/transactions?status=needs_review",
    );
    const row = inbox.find((t) => t.reference === firstReference);
    expect(row, "the imported movement is not in the needs_review inbox").toBeTruthy();
    return row!;
  });

  // ---------------------------------------------------------------- 5. the human confirms
  const receiptId = await test.step("confirm the movement against the lease", async () => {
    const result = await putJson<{ status: string; receiptId: string | null }>(
      request,
      `/api/bank/transactions/${movement.id}`,
      { action: "confirm", leaseId: lease.id },
      headers,
    );

    expect(result.status).toBe("matched_confirmed");
    // The join that matters: confirming a MOVEMENT produced a RECEIPT. If this is null the
    // chain is broken at its most important link and everything downstream is meaningless.
    expect(result.receiptId, "confirming the movement produced no receipt").toBeTruthy();
    return result.receiptId!;
  });

  // ---------------------------------------------------------------- 6. the ledger moved
  await test.step("the payment landed on the lease's oldest open month", async () => {
    const receipt = await getJson<{
      id: string;
      leaseId: string;
      amount: number;
      referenceMonth: string | null;
      lifecycle: string;
      source: string;
    }>(request, `/api/receipts/${receiptId}`);

    expect(receipt.leaseId, "the receipt is not linked to the lease we confirmed against").toBe(
      lease.id,
    );
    expect(receipt.amount).toBe(RENT);
    expect(receipt.source).toBe("automation");
    expect(receipt.lifecycle).toBe("draft");
    // The waterfall back-links the receipt to the month it settled. Null here means the
    // allocation never ran, even though the receipt exists.
    expect(receipt.referenceMonth, "the receipt was never allocated to a reference month").toBe(
      `${leaseStart.getUTCFullYear()}-${String(leaseStart.getUTCMonth() + 1).padStart(2, "0")}`,
    );

    // This route wraps its payload once more than the others: `{ data: { year, rows } }`.
    const matrix = await getJson<{
      year: number;
      rows: {
        leaseId: string;
        months: Record<string, { status: string; allocatedAmount: number }>;
      }[];
    }>(request, `/api/finance/rent-matrix?year=${leaseStart.getUTCFullYear()}`);
    const row = matrix.rows.find((r) => r.leaseId === lease.id);
    expect(row, "the lease has no row in the rent matrix").toBeTruthy();

    const cell = row!.months[String(leaseStart.getUTCMonth() + 1)];
    expect(cell, "the settled month is missing from the rent matrix").toBeTruthy();
    expect(cell.allocatedAmount).toBeCloseTo(RENT, 2);
    // paid or paid_late depending on when in the month this runs — both mean settled.
    expect(["paid", "paid_late"]).toContain(cell.status);
  });

  // ---------------------------------------------------------------- 7. the receipt is filed
  await test.step("emit the receipt and archive its PDF", async () => {
    await putJson(request, `/api/receipts/${receiptId}/lifecycle`, { to: "review" }, headers);
    const emitted = await putJson<{ lifecycle: string; archived: boolean }>(
      request,
      `/api/receipts/${receiptId}/lifecycle`,
      { to: "emitted" },
      headers,
    );

    expect(emitted.lifecycle).toBe("emitted");
    expect(emitted.archived, "reaching emitted did not archive a PDF document").toBe(true);
  });

  // ---------------------------------------------------------------- 8. the trail remembers
  await test.step("the audit trail names every stage of the chain", async () => {
    // SCOPED TO THIS RUN'S RECORDS, NOT THE ACCOUNT-WIDE TRAIL. The first version of this
    // assertion read GET /api/audit-trail — the last 50 entries for the whole account — and
    // checked the five actions appeared somewhere in it. That passes on a database where any
    // PREVIOUS run of this spec left those actions behind, whether or not this run's chain
    // worked at all. Passing the four ids this run created makes every matched row necessarily
    // ours.
    const ids = [importJobId, movement.id, lease.id, receiptId];
    const trail = await getJson<{ action: string; resourceType: string; resourceId: string }[]>(
      request,
      `/api/audit-trail?resourceIds=${ids.join(",")}`,
    );

    expect(trail.every((e) => ids.includes(e.resourceId))).toBe(true);
    const actions = new Set(trail.map((e) => e.action));

    // The single assertion the checklist asked for. Each of these is written by a different
    // service, in a different transaction, at a different stage of the chain. All five present,
    // all against ids this run minted, means every stage ran AND persisted — a chain that
    // silently stopped halfway would be missing one.
    for (const action of [
      "IMPORT_BANK_TRANSACTIONS", // → bank_sync_job
      "CONFIRM_MATCH", // → bank_transaction
      "GENERATE_RENT_PERIODS", // → lease
      "ALLOCATE_PAYMENT", // → receipt
      "EMIT_RECEIPT", // → receipt
    ]) {
      expect(actions, `audit trail is missing ${action} for this run's records`).toContain(action);
    }

    // Narrower still: the receipt's own history, which is what the property detail Audit tab
    // renders — so a regression here is visible to a landlord, not just to a test.
    const scoped = await getJson<{ action: string; resourceId: string }[]>(
      request,
      `/api/audit-trail?resourceIds=${receiptId}`,
    );
    expect(scoped.length, "the receipt has no scoped audit history").toBeGreaterThan(0);
    expect(scoped.every((e) => e.resourceId === receiptId)).toBe(true);
    expect(scoped.map((e) => e.action)).toContain("EMIT_RECEIPT");
  });

  // ---------------------------------------------------------------- 9. the engine learned
  await test.step("next month's transfer auto-matches on the IBAN it just learned", async () => {
    const summary = await postJson<{ imported: number; autoMatched: number }>(
      request,
      "/api/bank/import",
      {
        rows: [
          {
            bookingDate: isoDate(secondPaymentDate),
            amount: RENT,
            counterpartyName: TENANT_NAME,
            counterpartyIban: TENANT_IBAN,
            reference: `renda ${STAMP} m2`,
          },
        ],
      },
      headers,
    );

    expect(summary.imported).toBe(1);
    // The confirmed first movement taught the matcher this IBAN belongs to this lease, taking
    // the score from 0.55 to 1.0. This is the whole point of confirming rather than ignoring,
    // and nothing tested it before.
    expect(summary.autoMatched, "the second transfer did not auto-match on the known IBAN").toBe(1);
  });

  // ---------------------------------------------------------------- 10. re-import is a no-op
  await test.step("re-importing the same statement changes nothing", async () => {
    const summary = await postJson<{ imported: number; duplicates: number; autoMatched: number }>(
      request,
      "/api/bank/import",
      {
        rows: [
          {
            bookingDate: isoDate(firstPaymentDate),
            amount: RENT,
            counterpartyName: TENANT_NAME,
            counterpartyIban: TENANT_IBAN,
            reference: firstReference,
          },
        ],
      },
      headers,
    );

    // The unit tests prove this against a mocked client; this proves it against real SQLite and
    // the @unique constraint behind it — the half the unit tests explicitly cannot reach.
    expect(summary.duplicates).toBe(1);
    expect(summary.imported).toBe(0);
    expect(summary.autoMatched).toBe(0);
  });
});
