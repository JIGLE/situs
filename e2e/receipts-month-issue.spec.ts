import { test, expect, type APIRequestContext } from "@playwright/test";
import { settle } from "./helpers/wait";
import en from "../messages/en.json";

test.use({ storageState: "playwright/.auth/user.json" });

/**
 * A draft receipt from a matched bank movement is listed under the rent month it paid, and issuing
 * it from Finance › Receipts makes it Issued.
 *
 * The movement goes in through `/api/debug/bank/movements`, as the other bank specs do, and is
 * confirmed against the lease, which makes the draft. The rest is the screen: the list opens on
 * this month, the draft is last month's rent, and ticking it offers **Issue 1**, which asks first.
 * The spec ticks its own row rather than selecting all: other specs may leave drafts in that month,
 * and issuing theirs would change what they read.
 */

const STAMP = Date.now();
const RENT = 735;
const TENANT_NAME = `Issue${STAMP} Payer${STAMP}`;
const PROPERTY_NAME = `Issue Property ${STAMP}`;
/** 25 characters like a real PT IBAN, unlike every other spec's. */
const TENANT_IBAN = `PT517${String(STAMP).padStart(20, "0")}`;

/** UTC first-of-month, N months back from today. */
function monthStart(monthsAgo: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1));
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const monthKey = (d: Date) => isoDate(d).slice(0, 7);

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

interface ReceiptRow {
  id: string;
  lifecycle: string;
  referenceMonth: string | null;
  source: string;
}

test("a matched draft is listed under its rent month, and issuing it makes it Issued", async ({
  request,
  page,
}) => {
  test.slow(); // sequential round trips, then one screen

  const headers = await csrfHeader(request);
  const leaseStart = monthStart(1); // last month: the oldest open month, which the payment settles

  const property = await postJson<{ id: string }>(
    request,
    "/api/properties",
    {
      name: PROPERTY_NAME,
      address: `Rua do Recibo ${STAMP}, Coimbra`,
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
      email: `issue-${STAMP}@example.test`,
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

  const receiptId =
    await test.step("a bank movement confirmed against the lease makes a draft", async () => {
      const reference = `issue ${STAMP}`;
      await postJson(
        request,
        "/api/debug/bank/movements",
        {
          rows: [
            {
              bookingDate: isoDate(new Date()),
              amount: RENT,
              counterpartyName: TENANT_NAME,
              counterpartyIban: TENANT_IBAN,
              reference,
            },
          ],
        },
        headers,
      );
      const inbox = await getJson<{ id: string; reference: string }[]>(
        request,
        "/api/bank/transactions?status=needs_review",
      );
      const movement = inbox.find((t) => t.reference === reference);
      expect(movement, "the imported movement is not in the inbox").toBeTruthy();
      const confirmed = await putJson<{ receiptId: string | null }>(
        request,
        `/api/bank/transactions/${movement!.id}`,
        { action: "confirm", leaseId: lease.id },
        headers,
      );
      expect(confirmed.receiptId, "confirming the movement produced no receipt").toBeTruthy();

      const receipts = await getJson<ReceiptRow[]>(request, "/api/receipts");
      expect(receipts.find((r) => r.id === confirmed.receiptId)).toMatchObject({
        lifecycle: "draft",
        source: "automation",
        referenceMonth: monthKey(leaseStart),
      });
      return confirmed.receiptId as string;
    });

  await test.step("the draft waits under last month, and Issue makes it Issued", async () => {
    await page.goto("/financials?tab=receipts");
    await settle(page);

    // The list opens on this month; the draft paid last month's rent.
    await page.getByRole("button", { name: en.common.previousMonth }).click();
    const row = `${TENANT_NAME} · ${PROPERTY_NAME}`;
    await expect(page.getByText(TENANT_NAME).filter({ visible: true }).first()).toBeVisible({
      timeout: 10000,
    });

    // The box is drawn over its visually hidden input, so the click lands on the drawing.
    await page
      .getByRole("checkbox", { name: en.financial.receipts.selectOne.replace("{receipt}", row) })
      .filter({ visible: true })
      .first()
      .check({ force: true });
    await page
      .getByRole("button", { name: en.financial.receipts.issueSelected.replace("{count}", "1") })
      .click();

    const dialog = page.getByRole("alertdialog");
    await dialog
      .getByRole("button", { name: en.financial.receipts.issueDialog.confirmLabel, exact: true })
      .click();
    await expect(dialog).toBeHidden();

    await expect
      .poll(async () => {
        const receipts = await getJson<ReceiptRow[]>(request, "/api/receipts");
        return receipts.find((r) => r.id === receiptId)?.lifecycle;
      })
      .toBe("emitted");
    await expect(
      page.getByText(en.financial.receipts.lifecycle.emitted).filter({ visible: true }).first(),
    ).toBeVisible();
  });
});
