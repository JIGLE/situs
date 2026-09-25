import { test, expect, type APIRequestContext } from "@playwright/test";

test.use({ storageState: "playwright/.auth/user.json" });

/**
 * Deleting a receipt takes its payment off the rent ledger.
 *
 * `PaymentAllocation.receipt` is `onDelete: SetNull`, so a bare delete left every allocation live:
 * the month the receipt paid still read paid with nothing behind it, the tenant's status with it,
 * and no alert chased the month. `receiptService.delete` now reverses the allocations in the same
 * transaction, and sends a bank movement the receipt came from back to the inbox.
 *
 * Driven through the API, as `workflow-full-chain.spec.ts` is, and read back from the rent matrix:
 * the real routes, allocation waterfall and SQLite, which the route's unit tests mock.
 */

const STAMP = Date.now();
const RENT = 875;
/** Every token unique per run, and unlike the full chain's, so neither run's matcher sees the other. */
const TENANT_NAME = `Undo${STAMP} Payer${STAMP}`;
/** 25 characters like a real PT IBAN, and never the full chain's zero-padded one. */
const TENANT_IBAN = `PT509${String(STAMP).padStart(20, "0")}`;

/** UTC first-of-month, N months back from today. */
function monthStart(monthsAgo: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1));
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

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

async function deleteOk(
  request: APIRequestContext,
  url: string,
  headers: Record<string, string>,
): Promise<void> {
  const res = await request.delete(url, { headers });
  expect(res.ok(), `DELETE ${url} → ${res.status()}: ${await res.text()}`).toBe(true);
}

/** The lease's cell for one reference month, as the rent matrix reads it from the ledger. */
async function monthCell(request: APIRequestContext, leaseId: string, month: Date) {
  const matrix = await getJson<{
    rows: {
      leaseId: string;
      months: Record<string, { status: string; allocatedAmount: number }>;
    }[];
  }>(request, `/api/finance/rent-matrix?year=${month.getUTCFullYear()}`);
  const row = matrix.rows.find((r) => r.leaseId === leaseId);
  expect(row, "the lease has no row in the rent matrix").toBeTruthy();
  const cell = row!.months[String(month.getUTCMonth() + 1)];
  expect(cell, "the month is missing from the rent matrix").toBeTruthy();
  return cell;
}

const SETTLED = ["paid", "paid_late"];

test("deleting a receipt takes its payment off the ledger, and its movement back to the inbox", async ({
  request,
}) => {
  test.slow(); // a dozen sequential round trips

  const headers = await csrfHeader(request);
  const leaseStart = monthStart(1); // last month: the oldest open month, due already

  const property = await postJson<{ id: string }>(
    request,
    "/api/properties",
    {
      name: `Undo Property ${STAMP}`,
      address: `Rua do Recibo ${STAMP}, Porto`,
      type: "apartment",
      bedrooms: 1,
      bathrooms: 1,
      rent: RENT,
      status: "occupied",
    },
    headers,
  );
  const tenant = await postJson<{ id: string }>(
    request,
    "/api/tenants",
    {
      name: TENANT_NAME,
      email: `undo-${STAMP}@example.test`,
      propertyId: property.id,
      rent: RENT,
    },
    headers,
  );
  const lease = await postJson<{ id: string }>(
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

  await test.step("a payment recorded by hand, then deleted, leaves the month unpaid", async () => {
    const receipt = await postJson<{ id: string }>(
      request,
      "/api/receipts",
      {
        // No leaseId: the create ignores it, and allocation settles the tenant's one active lease.
        tenantId: tenant.id,
        propertyId: property.id,
        amount: RENT,
        date: isoDate(leaseStart),
        type: "rent",
        status: "paid",
      },
      headers,
    );
    const paid = await monthCell(request, lease.id, leaseStart);
    expect(paid.allocatedAmount).toBeCloseTo(RENT, 2);
    expect(SETTLED).toContain(paid.status);

    await deleteOk(request, `/api/receipts/${receipt.id}`, headers);

    const after = await monthCell(request, lease.id, leaseStart);
    expect(after.allocatedAmount, "the deleted payment is still on the ledger").toBe(0);
    expect(SETTLED).not.toContain(after.status);
  });

  await test.step("a matched movement's receipt, deleted, sends the movement back to the inbox", async () => {
    const reference = `undo ${STAMP}`;
    const summary = await postJson<{ imported: number; needsReview: number }>(
      request,
      "/api/bank/import",
      {
        rows: [
          {
            bookingDate: isoDate(leaseStart),
            amount: RENT,
            counterpartyName: TENANT_NAME,
            counterpartyIban: TENANT_IBAN,
            reference,
          },
        ],
      },
      headers,
    );
    expect(summary.imported).toBe(1);
    expect(summary.needsReview, "a first-time payer waits for a human").toBe(1);

    const inbox = await getJson<{ id: string; reference: string }[]>(
      request,
      "/api/bank/transactions?status=needs_review",
    );
    const movement = inbox.find((t) => t.reference === reference);
    expect(movement, "the imported movement is not in the inbox").toBeTruthy();

    const confirmed = await putJson<{ status: string; receiptId: string | null }>(
      request,
      `/api/bank/transactions/${movement!.id}`,
      { action: "confirm", leaseId: lease.id },
      headers,
    );
    expect(confirmed.receiptId, "confirming the movement produced no receipt").toBeTruthy();
    expect(SETTLED).toContain((await monthCell(request, lease.id, leaseStart)).status);

    await deleteOk(request, `/api/receipts/${confirmed.receiptId}`, headers);

    const back = await getJson<{ id: string; status: string }[]>(
      request,
      "/api/bank/transactions?status=needs_review",
    );
    expect(
      back.find((t) => t.id === movement!.id),
      "the movement's money is allocated to nothing, but it is not back in the inbox",
    ).toMatchObject({ status: "needs_review" });
    const after = await monthCell(request, lease.id, leaseStart);
    expect(after.allocatedAmount, "the deleted receipt's payment is still on the ledger").toBe(0);
    expect(SETTLED).not.toContain(after.status);
  });
});
