import { test, expect, type APIRequestContext } from "@playwright/test";
import { settle } from "./helpers/wait";

test.use({ storageState: "playwright/.auth/user.json" });

/**
 * A paid month says where its money came from.
 *
 * The month sheet listed what paid a month as a date, a stage and an amount, so a month paid from
 * the bank looked the same as one the owner typed in, and a payment that was linked to its
 * movement did not show it. Now each payment names the bank movement behind it (who paid, into
 * which account, with what reference, and the day the bank booked it when that is not the payment's
 * own date), or says it was recorded by hand.
 *
 * Driven through the real routes, the allocation waterfall and SQLite, and read from the screen:
 * the unit tests mock the database. The movements go in through `/api/debug/bank/movements`, which
 * runs the same `importBankRows` a sync does.
 */

const STAMP = Date.now();
const RENT = 640;

/** UTC first-of-month, N months back from today. */
function monthStart(monthsAgo: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1));
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
const monthAddress = (leaseId: string, d: Date) =>
  `${leaseId}:${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

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

/** What the month route answers for one payment, as far as this spec reads it. */
interface MonthPayment {
  amount: number;
  receipt: { id: string; source: string } | null;
  movements: {
    bookingDate: string;
    counterpartyName: string | null;
    reference: string | null;
    accountLabel: string;
  }[];
}

async function monthPayments(
  request: APIRequestContext,
  leaseId: string,
  month: Date,
): Promise<MonthPayment[]> {
  const query = `leaseId=${leaseId}&year=${month.getUTCFullYear()}&month=${month.getUTCMonth() + 1}`;
  const answer = await getJson<{ payments: MonthPayment[] }>(
    request,
    `/api/finance/rent-matrix/month?${query}`,
  );
  return answer.payments;
}

async function makeLease(request: APIRequestContext, headers: Record<string, string>) {
  const start = monthStart(3);
  const name = `Origin${STAMP} Payer${STAMP}`;
  const property = await postJson<{ id: string }>(
    request,
    "/api/properties",
    {
      name: `Origin Property ${STAMP}`,
      address: `Rua da Origem ${STAMP}, Porto`,
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
    { name, email: `origin-${STAMP}@example.test`, propertyId: property.id, rent: RENT },
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
      monthlyRent: RENT,
      deposit: RENT,
      status: "active",
    },
    headers,
  );
  return { name, propertyId: property.id, tenantId: tenant.id, leaseId: lease.id };
}

async function importMovement(
  request: APIRequestContext,
  headers: Record<string, string>,
  row: { bookingDate: string; name: string; reference: string },
) {
  await postJson(
    request,
    "/api/debug/bank/movements",
    {
      rows: [
        {
          bookingDate: row.bookingDate,
          amount: RENT,
          counterpartyName: row.name,
          reference: row.reference,
        },
      ],
    },
    headers,
  );
  const list = await getJson<{ id: string; reference: string; bankAccount: { label: string } }[]>(
    request,
    "/api/bank/transactions?status=needs_review",
  );
  const movement = list.find((m) => m.reference === row.reference);
  expect(movement, `the movement "${row.reference}" is not waiting in the inbox`).toBeTruthy();
  // The account's name as the inbox gives it, read apart from the month the sheet is asked about.
  return { id: movement!.id, accountLabel: movement!.bankAccount.label };
}

test("a paid month names the bank movement behind each payment, or says it was recorded by hand", async ({
  page,
  request,
}) => {
  test.slow(); // two dozen sequential round trips, then three screens

  const headers = await csrfHeader(request);
  const lease = await makeLease(request, headers);
  const [m0, m1, m2] = [3, 2, 1].map(monthStart);

  /** Opens the month from its address, and gives the sheet. */
  async function openMonth(month: Date) {
    await page.goto(`/financials?tab=rent-matrix&month=${monthAddress(lease.leaseId, month)}`);
    await settle(page);
    const sheet = page.getByRole("dialog", { name: new RegExp(lease.name) });
    await expect(sheet).toBeVisible({ timeout: 10000 });
    // The month is read after the sheet opens: wait for its payments, not just the frame.
    await expect(sheet.getByRole("heading", { name: /^(Payments|Pagamentos)$/ })).toBeVisible();
    return sheet;
  }

  const bankLine = (account: string, reference: string) =>
    new RegExp(
      `(Bank movement|Movimento bancário) · ${lease.name} · ${escapeRegExp(account)} · ${reference}`,
    );

  await test.step("a movement the owner confirmed is named on the month it paid", async () => {
    const reference = `renda ${STAMP} a`;
    const movement = await importMovement(request, headers, {
      bookingDate: isoDate(m0),
      name: lease.name,
      reference,
    });
    const confirmed = await putJson<{ status: string; receiptId: string }>(
      request,
      `/api/bank/transactions/${movement.id}`,
      { action: "confirm", leaseId: lease.leaseId },
      headers,
    );
    expect(confirmed.status).toBe("matched_confirmed");

    const [payment] = await monthPayments(request, lease.leaseId, m0);
    expect(payment.movements).toHaveLength(1);
    expect(payment.movements[0]).toMatchObject({
      bookingDate: isoDate(m0),
      reference,
      accountLabel: movement.accountLabel,
    });

    const sheet = await openMonth(m0);
    await expect(sheet.getByText(bankLine(movement.accountLabel, reference))).toBeVisible();
    await expect(sheet.getByText(/Recorded by hand|Registado à mão/)).toHaveCount(0);
  });

  await test.step("a payment typed in by the owner says so, and names no bank", async () => {
    const receipt = await postJson<{ id: string }>(
      request,
      "/api/receipts",
      {
        tenantId: lease.tenantId,
        propertyId: lease.propertyId,
        amount: RENT,
        date: isoDate(m1),
        type: "rent",
        status: "paid",
      },
      headers,
    );
    const [payment] = await monthPayments(request, lease.leaseId, m1);
    expect(payment.receipt).toMatchObject({ id: receipt.id, source: "manual" });
    expect(payment.movements).toEqual([]);

    const sheet = await openMonth(m1);
    await expect(sheet.getByText(/Recorded by hand|Registado à mão/)).toBeVisible();
    await expect(sheet.getByText(/Bank movement|Movimento bancário/)).toHaveCount(0);
  });

  await test.step("a payment linked to its movement names it, with the day the bank booked it", async () => {
    // The owner recorded the next month's rent on the 1st; the bank's copy arrives three days later.
    const receipt = await postJson<{ id: string }>(
      request,
      "/api/receipts",
      {
        tenantId: lease.tenantId,
        propertyId: lease.propertyId,
        amount: RENT,
        date: isoDate(m2),
        type: "rent",
        status: "paid",
      },
      headers,
    );
    const reference = `renda ${STAMP} b`;
    const movement = await importMovement(request, headers, {
      bookingDate: isoDate(addDays(m2, 3)),
      name: lease.name,
      reference,
    });
    const linked = await putJson<{ status: string; receiptId: string | null }>(
      request,
      `/api/bank/transactions/${movement.id}`,
      { action: "link", receiptId: receipt.id },
      headers,
    );
    expect(linked).toEqual({ status: "matched_confirmed", receiptId: receipt.id });

    const [payment] = await monthPayments(request, lease.leaseId, m2);
    expect(payment.receipt?.id).toBe(receipt.id);
    expect(payment.movements).toHaveLength(1);
    expect(payment.movements[0].bookingDate).toBe(isoDate(addDays(m2, 3)));

    const sheet = await openMonth(m2);
    // The payment is dated the 1st and the movement the 4th, so the line says which day it was.
    await expect(
      sheet.getByText(
        new RegExp(
          `(Bank movement of|Movimento bancário de) .+ · ${lease.name} · ${escapeRegExp(movement.accountLabel)} · ${reference}`,
        ),
      ),
    ).toBeVisible();
    await expect(sheet.getByText(/Recorded by hand|Registado à mão/)).toHaveCount(0);
  });
});
