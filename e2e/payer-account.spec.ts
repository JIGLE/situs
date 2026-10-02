import { test, expect, type APIRequestContext } from "@playwright/test";
import { settle } from "./helpers/wait";
import en from "../messages/en.json";

test.use({ storageState: "playwright/.auth/user.json" });

/**
 * An account the owner confirmed is remembered for that tenant, and from then on the same amount as
 * the rent from it is matched on its own.
 *
 * Until now a payer whose bank name was not the tenant's, paying with a reference that said nothing,
 * waited in the inbox every month, however many times the owner confirmed it. Here the owner confirms
 * once; the next month's rent from that account allocates itself; any other amount still waits; the
 * tenant's Payments tab lists the account; and forgetting it sends the payments back to waiting.
 *
 * Driven through the real routes, the allocation waterfall and SQLite, and read from the screen: the
 * unit tests mock the database. The movements go in through `/api/debug/bank/movements`, which runs
 * the same `importBankRows` a sync does.
 */

const STAMP = Date.now();
const RENT = 777;
/** 25 characters like a real PT IBAN, unique to this run, and ending in 4821. */
const IBAN = `PT50${String(STAMP).padStart(17, "0").slice(-17)}4821`;
/** A name that says nothing of the tenant: only the account and the amount can match. */
const PAYER = `Unrelated Payer ${STAMP} Lda`;
/**
 * A reference that says nothing either, unique to this run: hexadecimal, so it holds no rent word and
 * none of the property's own words (its name and address carry the decimal stamp), which would add a
 * tenth to a score that has to reach 0.85 on the account and the amount alone.
 */
const TAG = STAMP.toString(16);

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

interface Account {
  id: string;
  ibanLast4: string | null;
  holderName: string | null;
}

test("an account confirmed once is remembered, matched on its own for the rent, and forgotten on request", async ({
  page,
  request,
}) => {
  test.slow(); // two dozen sequential round trips, then a screen

  const headers = await csrfHeader(request);
  const start = monthStart(4);
  const property = await postJson<{ id: string }>(
    request,
    "/api/properties",
    {
      name: `Remembered Property ${STAMP}`,
      address: `Rua da Memória ${STAMP}, Porto`,
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
      name: `Remembered${STAMP} Tenant${STAMP}`,
      email: `remembered-${STAMP}@example.test`,
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
      startDate: isoDate(start),
      endDate: isoDate(new Date(Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), 1))),
      monthlyRent: RENT,
      deposit: RENT,
      status: "active",
    },
    headers,
  );

  let counter = 0;
  /** One movement from the payer's account, through the real import, and what the inbox says of it. */
  async function pay(month: Date, amount: number) {
    const reference = `xfer ${TAG} ${counter++}`;
    const summary = await postJson<{ imported: number; autoMatched: number; needsReview: number }>(
      request,
      "/api/debug/bank/movements",
      {
        rows: [
          {
            bookingDate: isoDate(month),
            amount,
            counterpartyName: PAYER,
            counterpartyIban: IBAN,
            reference,
          },
        ],
      },
      headers,
    );
    expect(summary.imported).toBe(1);
    // By status, since the whole inbox lists only the newest 200 movements of a shared database.
    let movement:
      { id: string; reference: string; status: string; receiptId: string | null } | undefined;
    for (const status of ["needs_review", "auto_matched"]) {
      const listed = await getJson<NonNullable<typeof movement>[]>(
        request,
        `/api/bank/transactions?status=${status}`,
      );
      movement = listed.find((m) => m.reference === reference);
      if (movement) break;
    }
    expect(movement, `the movement "${reference}" is not in the inbox`).toBeTruthy();
    return { summary, movement: movement! };
  }

  const accounts = () => getJson<Account[]>(request, `/api/tenants/${tenant.id}/payer-accounts`);

  await test.step("the first payment from an account waits, and the owner confirms it", async () => {
    const { summary, movement } = await pay(monthStart(4), RENT);
    expect(summary, "a first-time payer waits for a human").toMatchObject({
      autoMatched: 0,
      needsReview: 1,
    });
    expect(await accounts()).toEqual([]);

    const confirmed = await putJson<{
      status: string;
      receiptId: string | null;
      remembered?: boolean;
    }>(
      request,
      `/api/bank/transactions/${movement.id}`,
      { action: "confirm", leaseId: lease.id },
      headers,
    );
    expect(confirmed).toMatchObject({ status: "matched_confirmed", remembered: true });
  });

  await test.step("the tenant has the account, with who the bank said it was", async () => {
    expect(await accounts()).toEqual([
      expect.objectContaining({ ibanLast4: "4821", holderName: PAYER }),
    ]);
  });

  await test.step("the next month's rent from it is matched on its own", async () => {
    const { summary, movement } = await pay(monthStart(3), RENT);

    expect(summary).toMatchObject({ imported: 1, autoMatched: 1, needsReview: 0 });
    expect(movement.status).toBe("auto_matched");
    expect(movement.receiptId, "the automatic match made no receipt").toBeTruthy();
  });

  await test.step("any other amount from it still waits for the owner", async () => {
    const { summary, movement } = await pay(monthStart(2), RENT / 2);

    expect(summary).toMatchObject({ autoMatched: 0, needsReview: 1 });
    expect(movement.status).toBe("needs_review");
    expect(movement.receiptId).toBeNull();
  });

  await test.step("the tenant's Payments tab lists it, and Forget takes it off", async () => {
    await page.goto(`/people?detail=tenant:${tenant.id}`);
    await settle(page);

    await page.getByRole("tab", { name: en.tenants.modal.tabPayments }).click();
    const panel = page.getByRole("heading", { name: en.tenants.payerAccounts.title });
    await expect(panel).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByText(`${PAYER} · ${en.tenants.payerAccounts.ending.replace("{last4}", "4821")}`),
    ).toBeVisible();

    await page
      .getByRole("button", { name: new RegExp(`^${en.tenants.payerAccounts.forget} `) })
      .click();

    await expect(panel).toHaveCount(0);
    expect(await accounts()).toEqual([]);
  });

  await test.step("once forgotten, the same rent from it waits again", async () => {
    const { summary, movement } = await pay(monthStart(1), RENT);

    expect(summary).toMatchObject({ autoMatched: 0, needsReview: 1 });
    expect(movement.status).toBe("needs_review");
  });
});
