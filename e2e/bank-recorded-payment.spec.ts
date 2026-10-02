import { test, expect, type APIRequestContext } from "@playwright/test";
import { settle } from "./helpers/wait";

test.use({ storageState: "playwright/.auth/user.json" });

/**
 * A payment the owner recorded by hand is not allocated a second time when the bank shows it.
 *
 * Nothing linked a movement to a receipt it did not create, so the bank's copy of a payment already
 * recorded was allocated on top of it: the waterfall filled the next open month, and the month that
 * was really paid could never be reconciled. A movement whose lease has a payment recorded for the
 * same amount around the same date now waits, and the owner says whether it is that payment.
 *
 * Driven through the real routes, the allocation waterfall and SQLite, and read back from the rent
 * matrix, as `receipt-delete-ledger.spec.ts` is: the unit tests mock all three. The movements go in
 * through `/api/debug/bank/movements`, which runs the same `importBankRows` a sync does.
 */

const STAMP = Date.now();

/** UTC first-of-month, N months back from today. */
function monthStart(monthsAgo: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1));
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 24 * 60 * 60 * 1000);

/** State-changing routes are CSRF-guarded with a double-submit cookie. */
async function csrfHeader(request: APIRequestContext): Promise<Record<string, string>> {
  await request.get("/api/csrf-token");
  const { cookies } = await request.storageState();
  const token = cookies.find((c) => c.name === "csrf-token")?.value;
  expect(token, "no csrf-token cookie after GET /api/csrf-token").toBeTruthy();
  return { "x-csrf-token": token as string };
}

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

/** What the inbox lists for a movement, as far as this spec reads it. */
interface Movement {
  id: string;
  reference: string;
  status: string;
  receiptId: string | null;
  matchReasons: string | null;
  recordedPayments: { id: string; date: string; amount: number }[];
}

async function movementByReference(
  request: APIRequestContext,
  status: string,
  reference: string,
): Promise<Movement | undefined> {
  const list = await getJson<Movement[]>(request, `/api/bank/transactions?status=${status}`);
  return list.find((movement) => movement.reference === reference);
}

/** The lease's cell for one reference month, as the rent matrix reads it from the ledger. */
async function allocated(request: APIRequestContext, leaseId: string, month: Date) {
  const matrix = await getJson<{
    rows: { leaseId: string; months: Record<string, { allocatedAmount: number }> }[];
  }>(request, `/api/finance/rent-matrix?year=${month.getUTCFullYear()}`);
  const row = matrix.rows.find((r) => r.leaseId === leaseId);
  expect(row, "the lease has no row in the rent matrix").toBeTruthy();
  const cell = row!.months[String(month.getUTCMonth() + 1)];
  expect(cell, "the month is missing from the rent matrix").toBeTruthy();
  return cell.allocatedAmount;
}

/** A property, a tenant and a lease that began `monthsBack` months ago, all unique to this run. */
async function makeLease(
  request: APIRequestContext,
  headers: Record<string, string>,
  tag: string,
  rent: number,
  monthsBack: number,
) {
  const start = monthStart(monthsBack);
  const name = `${tag}${STAMP} Payer${STAMP}`;
  const property = await postJson<{ id: string }>(
    request,
    "/api/properties",
    {
      name: `${tag} Property ${STAMP}`,
      address: `Rua do Pagamento ${tag} ${STAMP}, Porto`,
      type: "apartment",
      bedrooms: 1,
      bathrooms: 1,
      rent,
      status: "occupied",
    },
    headers,
  );
  const tenant = await postJson<{ id: string }>(
    request,
    "/api/tenants",
    { name, email: `${tag.toLowerCase()}-${STAMP}@example.test`, propertyId: property.id, rent },
    headers,
  );
  const lease = await postJson<{ id: string }>(
    request,
    "/api/leases",
    {
      tenantId: tenant.id,
      propertyId: property.id,
      startDate: isoDate(start),
      endDate: isoDate(new Date(Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), 1))),
      monthlyRent: rent,
      deposit: rent,
      status: "active",
    },
    headers,
  );
  return { name, propertyId: property.id, tenantId: tenant.id, leaseId: lease.id };
}

/** A payment recorded by hand, as the owner does it: no lease named, the tenant's one is settled. */
async function recordByHand(
  request: APIRequestContext,
  headers: Record<string, string>,
  lease: { tenantId: string; propertyId: string },
  rent: number,
  date: Date,
) {
  return postJson<{ id: string }>(
    request,
    "/api/receipts",
    {
      tenantId: lease.tenantId,
      propertyId: lease.propertyId,
      amount: rent,
      date: isoDate(date),
      type: "rent",
      status: "paid",
    },
    headers,
  );
}

async function importMovement(
  request: APIRequestContext,
  headers: Record<string, string>,
  row: { bookingDate: string; amount: number; name: string; iban?: string; reference: string },
) {
  return postJson<{ imported: number; autoMatched: number; needsReview: number }>(
    request,
    "/api/debug/bank/movements",
    {
      rows: [
        {
          bookingDate: row.bookingDate,
          amount: row.amount,
          counterpartyName: row.name,
          ...(row.iban ? { counterpartyIban: row.iban } : {}),
          reference: row.reference,
        },
      ],
    },
    headers,
  );
}

test("a payment recorded by hand, then seen in the bank, is linked to it and counted once", async ({
  request,
}) => {
  test.slow(); // two dozen sequential round trips

  const RENT = 875;
  /** 25 characters like a real PT IBAN, and unique to this run. */
  const IBAN = `PT508${String(STAMP).padStart(20, "0")}`;
  const headers = await csrfHeader(request);
  const lease = await makeLease(request, headers, "Link", RENT, 3);
  const [m0, m1, m2, m3] = [3, 2, 1, 0].map(monthStart);

  await test.step("the payer's account is learned from a first payment the owner confirms", async () => {
    const reference = `renda ${STAMP} a`;
    const summary = await importMovement(request, headers, {
      bookingDate: isoDate(m0),
      amount: RENT,
      name: lease.name,
      iban: IBAN,
      reference,
    });
    expect(summary.needsReview, "a first-time payer waits for a human").toBe(1);

    const movement = await movementByReference(request, "needs_review", reference);
    expect(movement, "the first movement is not in the inbox").toBeTruthy();
    expect(movement!.recordedPayments).toEqual([]);

    const confirmed = await putJson<{ status: string; receiptId: string | null }>(
      request,
      `/api/bank/transactions/${movement!.id}`,
      { action: "confirm", leaseId: lease.leaseId },
      headers,
    );
    expect(confirmed.status).toBe("matched_confirmed");
    expect(await allocated(request, lease.leaseId, m0)).toBeCloseTo(RENT, 2);
  });

  let recorded: { id: string };
  await test.step("a payment recorded by hand fills the next month", async () => {
    recorded = await recordByHand(request, headers, lease, RENT, m1);
    expect(await allocated(request, lease.leaseId, m1)).toBeCloseTo(RENT, 2);
  });

  let held: Movement;
  await test.step("the bank's copy of it waits, instead of paying the month after", async () => {
    const reference = `renda ${STAMP} b`;
    const summary = await importMovement(request, headers, {
      bookingDate: isoDate(addDays(m1, 3)),
      amount: RENT,
      name: lease.name,
      iban: IBAN,
      reference,
    });
    // A known account, the payer's name, the rent and a rent word: the full signal stack, which
    // allocated by itself before. Now it waits.
    expect(summary).toMatchObject({ imported: 1, autoMatched: 0, needsReview: 1 });

    const movement = await movementByReference(request, "needs_review", reference);
    expect(movement, "the bank's copy is not waiting in the inbox").toBeTruthy();
    held = movement!;
    expect(held.recordedPayments).toEqual([{ id: recorded.id, date: isoDate(m1), amount: RENT }]);
    expect(JSON.parse(held.matchReasons ?? "{}").warnings).toContain("possible_recorded_payment");

    expect(await allocated(request, lease.leaseId, m1), "the month was counted twice").toBeCloseTo(
      RENT,
      2,
    );
    expect(await allocated(request, lease.leaseId, m2), "the next month was paid with it").toBe(0);
  });

  await test.step("Same payment links it to the receipt and allocates nothing", async () => {
    const linked = await putJson<{ status: string; receiptId: string | null }>(
      request,
      `/api/bank/transactions/${held.id}`,
      { action: "link", receiptId: recorded.id },
      headers,
    );
    expect(linked).toEqual({ status: "matched_confirmed", receiptId: recorded.id });

    const confirmed = await getJson<Movement[]>(
      request,
      "/api/bank/transactions?status=matched_confirmed",
    );
    expect(confirmed.find((movement) => movement.id === held.id)).toMatchObject({
      receiptId: recorded.id,
    });
    expect(await allocated(request, lease.leaseId, m1)).toBeCloseTo(RENT, 2);
    expect(await allocated(request, lease.leaseId, m2)).toBe(0);

    // The payment has its movement now, so it is not offered to another one.
    const again = await request.put(`/api/bank/transactions/${held.id}`, {
      data: { action: "link", receiptId: recorded.id },
      headers,
    });
    expect(again.ok(), "the same link twice is done, not an error").toBe(true);
  });

  await test.step("a plain Confirm holds too, and A new payment allocates as before", async () => {
    const second = await recordByHand(request, headers, lease, RENT, m2);
    expect(await allocated(request, lease.leaseId, m2)).toBeCloseTo(RENT, 2);

    const reference = `renda ${STAMP} c`;
    await importMovement(request, headers, {
      bookingDate: isoDate(addDays(m2, 2)),
      amount: RENT,
      name: lease.name,
      iban: IBAN,
      reference,
    });
    const movement = await movementByReference(request, "needs_review", reference);
    expect(movement, "the third movement is not waiting in the inbox").toBeTruthy();

    // Confirm, which would allocate it again, answers that it waited and with what.
    const held = await putJson<{
      status: string;
      receiptId: string | null;
      recordedPayments?: { id: string }[];
    }>(request, `/api/bank/transactions/${movement!.id}`, { action: "confirm" }, headers);
    expect(held).toMatchObject({ status: "needs_review", receiptId: null });
    expect(held.recordedPayments?.map((payment) => payment.id)).toEqual([second.id]);
    expect(await allocated(request, lease.leaseId, m3), "Confirm allocated it anyway").toBe(0);

    const added = await putJson<{ status: string; receiptId: string | null }>(
      request,
      `/api/bank/transactions/${movement!.id}`,
      { action: "confirm", newPayment: true },
      headers,
    );
    expect(added.status).toBe("matched_confirmed");
    expect(added.receiptId, "a new payment is a receipt of its own").toBeTruthy();
    expect(added.receiptId).not.toBe(second.id);
    expect(await allocated(request, lease.leaseId, m2)).toBeCloseTo(RENT, 2);
    expect(await allocated(request, lease.leaseId, m3)).toBeCloseTo(RENT, 2);
  });
});

test("the inbox asks which payment it is, and Same payment links it", async ({ page, request }) => {
  test.slow();

  const RENT = 913;
  const headers = await csrfHeader(request);
  const lease = await makeLease(request, headers, "Ask", RENT, 1);
  const today = new Date();
  const recorded = await recordByHand(request, headers, lease, RENT, today);
  const reference = `renda ${STAMP} ui`;

  // The payer's name, the rent and a rent word: enough to suggest the lease, not to allocate it.
  const summary = await importMovement(request, headers, {
    bookingDate: isoDate(today),
    amount: RENT,
    name: lease.name,
    reference,
  });
  expect(summary).toMatchObject({ imported: 1, autoMatched: 0, needsReview: 1 });

  await page.goto("/financials?tab=bank");
  await settle(page);

  // The inbox renders a table from `md` up and cards below it, both in the DOM with one hidden: the
  // innermost visible row, or card, that carries this movement's reference.
  const row = page
    .locator("tr, div.border")
    .filter({ hasText: reference })
    .filter({ visible: true })
    .last();
  await expect(row).toBeVisible({ timeout: 10000 });

  // In whichever language the suite runs.
  await expect(row.getByText(/You recorded|Registou/)).toBeVisible();
  await expect(
    row.getByRole("button", { name: /^(A new payment|Um novo pagamento)$/ }),
  ).toBeVisible();
  // Confirm, which would allocate it again, has given way to the two answers.
  await expect(row.getByRole("button", { name: /^(Confirm|Confirmar)$/ })).toHaveCount(0);

  await row.getByRole("button", { name: /^(Same payment|Mesmo pagamento)$/ }).click();

  await expect(page.getByText(reference).filter({ visible: true })).toHaveCount(0, {
    timeout: 10000,
  });
  const linked = await movementByReference(request, "matched_confirmed", reference);
  expect(linked, "the movement did not leave the review list as a confirmed one").toBeTruthy();
  expect(linked!.receiptId).toBe(recorded.id);
});
