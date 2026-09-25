import { test, expect, type APIRequestContext } from "@playwright/test";
import { settle } from "./helpers/wait";
import en from "../messages/en.json";

test.use({ storageState: "playwright/.auth/user.json" });

/**
 * A tenant, a property or a lease with money history is kept.
 *
 * Deleting any of them cascaded to the receipts, the rent ledger and the AT filing records behind
 * it (`lib/services/database/history.ts` has the chains). Now each delete answers 409 with a
 * reason while anything is recorded against the record, and the screen says why in the user's
 * language. A lease entered by mistake, with nothing paid, can still be deleted.
 *
 * The refusals are driven through the API, as `workflow-full-chain.spec.ts` is; the last step goes
 * through the People screen, because the sentence it shows is the other half of the fix.
 */

const STAMP = Date.now();
const RENT = 640;
const TENANT_NAME = `Kept${STAMP} Tenant${STAMP}`;

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

/** A delete the route refuses, and the rule it names. */
async function expectKept(
  request: APIRequestContext,
  url: string,
  headers: Record<string, string>,
  reason: string,
) {
  const res = await request.delete(url, { headers });
  expect(res.status(), `DELETE ${url} → ${res.status()}: ${await res.text()}`).toBe(409);
  expect(await res.json()).toMatchObject({ reason });
}

test("a tenant, property or lease with payments is kept; a lease with none can go", async ({
  request,
  page,
}) => {
  test.slow(); // a dozen sequential round trips and one screen

  const headers = await csrfHeader(request);
  const leaseStart = monthStart(1);
  const leaseBody = (tenantId: string, propertyId: string) => ({
    tenantId,
    propertyId,
    startDate: isoDate(leaseStart),
    endDate: isoDate(new Date(Date.UTC(leaseStart.getUTCFullYear() + 1, 0, 1))),
    monthlyRent: RENT,
    deposit: RENT,
    status: "active",
  });

  const property = await postJson<{ id: string }>(
    request,
    "/api/properties",
    {
      name: `Kept Property ${STAMP}`,
      address: `Rua da Memória ${STAMP}, Braga`,
      type: "apartment",
      bedrooms: 2,
      bathrooms: 1,
      rent: RENT,
      status: "occupied",
    },
    headers,
  );
  const tenant = await postJson<{ id: string }>(
    request,
    "/api/tenants",
    { name: TENANT_NAME, email: `kept-${STAMP}@example.test`, propertyId: property.id, rent: RENT },
    headers,
  );

  await test.step("a lease entered by mistake, with nothing paid, can be deleted", async () => {
    const mistake = await postJson<{ id: string }>(
      request,
      "/api/leases",
      leaseBody(tenant.id, property.id),
      headers,
    );
    const res = await request.delete(`/api/leases/${mistake.id}`, { headers });
    expect(res.ok(), `DELETE the unpaid lease → ${res.status()}: ${await res.text()}`).toBe(true);
  });

  const lease = await test.step("a lease with a payment against it is kept", async () => {
    const created = await postJson<{ id: string }>(
      request,
      "/api/leases",
      leaseBody(tenant.id, property.id),
      headers,
    );
    await postJson(
      request,
      "/api/receipts",
      {
        tenantId: tenant.id,
        propertyId: property.id,
        amount: RENT,
        date: isoDate(leaseStart),
        type: "rent",
        status: "paid",
      },
      headers,
    );
    await expectKept(request, `/api/leases/${created.id}`, headers, "lease_has_history");
    return created;
  });

  await test.step("so are its tenant and its property", async () => {
    await expectKept(request, `/api/tenants/${tenant.id}`, headers, "tenant_has_history");
    await expectKept(request, `/api/properties/${property.id}`, headers, "property_has_history");

    // And all three are still there.
    expect((await request.get(`/api/tenants/${tenant.id}`)).ok()).toBe(true);
    expect((await request.get(`/api/properties/${property.id}`)).ok()).toBe(true);
    const leases = (await (await request.get("/api/leases")).json()).data as { id: string }[];
    expect(
      leases.some((l) => l.id === lease.id),
      "the kept lease is gone",
    ).toBe(true);
  });

  await test.step("the People screen says why, and keeps the row", async () => {
    await page.goto("/people");
    await settle(page);

    await page.getByRole("button", { name: `${TENANT_NAME} options` }).click();
    await page.getByRole("menuitem", { name: /delete/i }).click();
    const dialog = page.getByRole("alertdialog");
    await dialog.getByRole("button", { name: en.tenants.deleteOne.confirmLabel }).click();

    await expect(page.getByText(en.errors.api.tenantHasHistory).first()).toBeVisible();
    await expect(page.getByText(TENANT_NAME).first()).toBeVisible();
  });
});
