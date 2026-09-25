import { test, expect, type APIRequestContext } from "@playwright/test";
import { settle } from "./helpers/wait";
import en from "../messages/en.json";

test.use({ storageState: "playwright/.auth/user.json" });

/**
 * A payment recorded from a month in the rent matrix settles that lease's month.
 *
 * The tenant rents a flat and a garage, on two active leases. Allocation settles the lease a
 * receipt names; without one it guesses the tenant's only active lease, and gives up when there
 * are two. The receipts create used to drop `leaseId`, so a payment recorded for the garage
 * reached no month at all. Here the month sheet opens from its address, **Record payment** starts
 * from what the month owes, and the ledger is read back from the rent matrix.
 */

const STAMP = Date.now();
const FLAT_RENT = 910;
const GARAGE_RENT = 95;
const TENANT_NAME = `Matrix${STAMP} Payer${STAMP}`;
const GARAGE_NAME = `Garage ${STAMP}`;

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

async function getJson<T>(request: APIRequestContext, url: string): Promise<T> {
  const res = await request.get(url);
  expect(res.ok(), `GET ${url} → ${res.status()}: ${await res.text()}`).toBe(true);
  return (await res.json()).data as T;
}

/** The lease's cell for one reference month, as the rent matrix reads it from the ledger. */
async function monthCell(request: APIRequestContext, leaseId: string, month: Date) {
  const matrix = await getJson<{
    rows: {
      leaseId: string;
      months: Record<string, { status: string; allocatedAmount: number; outstanding: number }>;
    }[];
  }>(request, `/api/finance/rent-matrix?year=${month.getUTCFullYear()}`);
  const row = matrix.rows.find((r) => r.leaseId === leaseId);
  expect(row, "the lease has no row in the rent matrix").toBeTruthy();
  const cell = row!.months[String(month.getUTCMonth() + 1)];
  expect(cell, "the month is missing from the rent matrix").toBeTruthy();
  return cell;
}

const SETTLED = ["paid", "paid_late"];

test("a payment recorded from the rent matrix settles that lease's month", async ({
  request,
  page,
}) => {
  test.slow(); // sequential round trips, then one screen

  const headers = await csrfHeader(request);
  const leaseStart = monthStart(1); // last month: due already, so it is owed

  const property = (name: string, rent: number) =>
    postJson<{ id: string }>(
      request,
      "/api/properties",
      {
        name,
        address: `Rua da Matriz ${STAMP}, Braga`,
        type: "apartment",
        bedrooms: 1,
        bathrooms: 1,
        rent,
        status: "occupied",
      },
      headers,
    );
  const flat = await property(`Flat ${STAMP}`, FLAT_RENT);
  const garage = await property(GARAGE_NAME, GARAGE_RENT);
  const tenant = await postJson<{ id: string }>(
    request,
    "/api/tenants",
    {
      name: TENANT_NAME,
      email: `matrix-${STAMP}@example.test`,
      propertyId: flat.id,
      rent: FLAT_RENT,
    },
    headers,
  );
  const lease = (propertyId: string, rent: number) =>
    postJson<{ id: string }>(
      request,
      "/api/leases",
      {
        tenantId: tenant.id,
        propertyId,
        startDate: isoDate(leaseStart),
        endDate: isoDate(new Date(Date.UTC(leaseStart.getUTCFullYear() + 1, 0, 1))),
        monthlyRent: rent,
        deposit: rent,
        status: "active",
      },
      headers,
    );
  const flatLease = await lease(flat.id, FLAT_RENT);
  const garageLease = await lease(garage.id, GARAGE_RENT);

  const before = await monthCell(request, garageLease.id, leaseStart);
  expect(before.outstanding, "the garage's month should be owed before anything is paid").toBe(
    GARAGE_RENT,
  );

  await test.step("the garage's month opens from its address, and its payment is recorded", async () => {
    const month = `${leaseStart.getUTCFullYear()}-${String(leaseStart.getUTCMonth() + 1).padStart(2, "0")}`;
    await page.goto(`/financials?tab=rent-matrix&month=${garageLease.id}:${month}`);
    await settle(page);

    const sheet = page.getByRole("dialog", { name: new RegExp(TENANT_NAME) });
    await expect(sheet).toBeVisible({ timeout: 10000 });
    await sheet.getByRole("button", { name: en.financial.matrix.recordPayment }).click();

    const form = page.getByRole("dialog", { name: en.financial.recordPayment.title });
    await expect(form.getByLabel(en.financial.recordPayment.lease)).toContainText(GARAGE_NAME);
    await expect(form.getByLabel(en.financial.recordPayment.amount)).toHaveValue(
      String(GARAGE_RENT),
    );
    await form.getByRole("button", { name: en.financial.recordPayment.submit }).click();

    await expect(form).toBeHidden();
    // The month owes nothing now, so the sheet offers no payment for it.
    await expect(
      sheet.getByRole("button", { name: en.financial.matrix.recordPayment }),
    ).toHaveCount(0);
  });

  await test.step("the ledger settled the garage's month, and left the flat's alone", async () => {
    const paid = await monthCell(request, garageLease.id, leaseStart);
    expect(paid.allocatedAmount).toBeCloseTo(GARAGE_RENT, 2);
    expect(SETTLED).toContain(paid.status);

    const flatMonth = await monthCell(request, flatLease.id, leaseStart);
    expect(flatMonth.allocatedAmount, "the garage's payment reached the flat").toBe(0);

    const receipts = await getJson<{ tenantId: string; leaseId?: string; amount: number }[]>(
      request,
      "/api/receipts",
    );
    const receipt = receipts.find((r) => r.tenantId === tenant.id);
    expect(receipt, "no receipt was recorded").toBeTruthy();
    expect(receipt).toMatchObject({ leaseId: garageLease.id, amount: GARAGE_RENT });
  });
});
