import { test, expect, type APIRequestContext } from "@playwright/test";
import en from "../messages/en.json";

test.use({ storageState: "playwright/.auth/user.json" });

/**
 * What a receipt still needs from the owner: listed on the dashboard, and answered one field at a
 * time on /complete.
 *
 * The lease below has everything but AT's contract number: its landlord and its tenant carry
 * valid NIFs. So exactly one item is new, and answering it makes the item go and the count drop.
 * The count is read before and after rather than assumed, since the seeded demo leases may be
 * waiting for numbers of their own.
 */

const STAMP = Date.now();
const TENANT_NAME = `AAA Guided${STAMP}`;
const CONTRACT_NUMBER = "9876543";

interface Attention {
  items: { id: string; kind: string }[];
  counts: { total: number };
}

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

test("a lease without AT's number is on the dashboard, and answering it on /complete clears it", async ({
  request,
  page,
}) => {
  test.slow(); // sequential round trips, then two screens

  const headers = await csrfHeader(request);
  const before = await getJson<Attention>(request, "/api/attention");

  const property = await postJson<{ id: string }>(
    request,
    "/api/properties",
    {
      name: `Guided Property ${STAMP}`,
      address: `Rua da Lista ${STAMP}, Braga`,
      type: "apartment",
      bedrooms: 1,
      bathrooms: 1,
      rent: 600,
      status: "occupied",
    },
    headers,
  );
  const owner = await postJson<{ id: string }>(
    request,
    "/api/owners",
    {
      name: `Guided Owner ${STAMP}`,
      email: `guided-owner-${STAMP}@example.test`,
      taxIdentificationNumber: "123456789",
    },
    headers,
  );
  await postJson(
    request,
    "/api/property-owners",
    { propertyId: property.id, ownerId: owner.id, ownershipPercentage: 100 },
    headers,
  );
  const tenant = await postJson<{ id: string }>(
    request,
    "/api/tenants",
    {
      name: TENANT_NAME,
      email: `guided-${STAMP}@example.test`,
      propertyId: property.id,
      rent: 600,
      taxId: "234567899",
    },
    headers,
  );
  const lease = await postJson<{ id: string }>(
    request,
    "/api/leases",
    {
      tenantId: tenant.id,
      propertyId: property.id,
      startDate: "2026-01-01",
      endDate: "2027-12-31",
      monthlyRent: 600,
      deposit: 600,
      status: "active",
    },
    headers,
  );
  const itemId = `contract_number:${lease.id}`;

  await test.step("the list holds one new item: the contract number", async () => {
    const listed = await getJson<Attention>(request, "/api/attention");
    expect(listed.items.map((item) => item.id)).toContain(itemId);
    expect(listed.counts.total).toBe(before.counts.total + 1);
  });

  await test.step("the dashboard says so, in a line that opens /complete", async () => {
    await page.goto("/dashboard");
    const line = page.getByTestId("dashboard-attention").locator('a[href="/complete"]');
    await expect(line).toBeVisible();
    await line.click();
    await page.waitForURL((url) => url.pathname === "/complete");
    // Scoped to the page: below `md` the shell's top bar carries an h1 of its own.
    await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toHaveText(
      en.completion.title,
    );
  });

  const left = async () =>
    Number((await page.getByTestId("complete-left").textContent())?.match(/\d+/)?.[0]);

  await test.step("the owner's own question comes up, with what Situs knows", async () => {
    const item = page.getByTestId("complete-item");
    await expect(item).toBeVisible();
    // Other leases may be waiting too; skipping moves them behind this one.
    const skip = page.getByRole("button", { name: en.completion.skip });
    for (let tries = 0; tries < 40; tries++) {
      if ((await item.textContent())?.includes(TENANT_NAME)) break;
      await skip.click();
    }
    await expect(item).toContainText(TENANT_NAME);
    await expect(item).toContainText(`Guided Property ${STAMP}`);
    expect(await left()).toBe(before.counts.total + 1);
  });

  await test.step("an answer is saved on the lease, and the count drops", async () => {
    await page.getByLabel(en.completion.kind.contract_number.label).fill(CONTRACT_NUMBER);
    await page.getByRole("button", { name: en.completion.save }).click();

    await expect(page.getByTestId("complete-item")).not.toContainText(TENANT_NAME);
    const leases = await getJson<{ id: string; atContractNumber: string | null }[]>(
      request,
      "/api/leases",
    );
    expect(leases.find((row) => row.id === lease.id)?.atContractNumber).toBe(CONTRACT_NUMBER);
    const after = await getJson<Attention>(request, "/api/attention");
    expect(after.items.map((row) => row.id)).not.toContain(itemId);
    expect(after.counts.total).toBe(before.counts.total);
  });
});
