import { test, expect, type APIRequestContext } from "@playwright/test";

test.use({ storageState: "playwright/.auth/user.json" });

/**
 * A lease's contract and the fields AT's receipts need, against the running app.
 *
 * The contract used to travel inside the lease JSON: posted as an array of numbers, and listed
 * back with every lease, where the browser built an empty download from it. It now has its own
 * route. This drives that route through the real proxy (CSRF, body buffering), the real Prisma
 * client (which leaves the bytes out of every other lease read) and the encryption at rest,
 * none of which the unit tests' mocks can.
 */

const STAMP = Date.now();
const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

/** The CSRF double-submit token every state-changing route checks. */
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

test.describe("Lease contract and AT fields", () => {
  let leaseId: string;

  test.beforeAll(async ({ request }) => {
    const headers = await csrfHeader(request);
    const property = await postJson<{ id: string }>(
      request,
      "/api/properties",
      {
        name: `Contract Property ${STAMP}`,
        address: `Rua do Contrato ${STAMP}, Lisboa`,
        type: "apartment",
        bedrooms: 1,
        bathrooms: 1,
        rent: 900,
        status: "occupied",
        cadasterReference: "2321",
        fraction: "C",
      },
      headers,
    );
    const tenant = await postJson<{ id: string; taxId?: string }>(
      request,
      "/api/tenants",
      {
        name: `Contract Tenant ${STAMP}`,
        email: `contract_${STAMP}@test.local`,
        rent: 900,
        taxId: "123 456 789",
      },
      headers,
    );
    expect(tenant.taxId, "the NIF is stored as its nine digits").toBe("123456789");

    const year = new Date().getFullYear();
    const lease = await postJson<{ id: string; atContractNumber?: string; parties?: unknown[] }>(
      request,
      "/api/leases",
      {
        propertyId: property.id,
        tenantId: tenant.id,
        startDate: `${year}-01-01`,
        endDate: `${year + 1}-12-31`,
        monthlyRent: 900,
        atContractNumber: "20240012345",
        parties: [
          { role: "tenant", name: "Rui Costa", taxId: "450000001" },
          { role: "guarantor", name: "Hans Weber", taxId: "DE 4711", taxCountry: "DE" },
        ],
      },
      headers,
    );
    expect(lease.atContractNumber).toBe("20240012345");
    expect(lease.parties).toHaveLength(2);
    leaseId = lease.id;
  });

  test("stores a contract PDF and serves back the same bytes", async ({ request }) => {
    const headers = await csrfHeader(request);

    const put = await request.put(`/api/leases/${leaseId}/contract`, {
      data: pdf,
      headers: {
        ...headers,
        "Content-Type": "application/pdf",
        "X-File-Name": encodeURIComponent("Contrato de arrendamento.pdf"),
      },
    });
    expect(put.ok(), `PUT contract → ${put.status()}: ${await put.text()}`).toBe(true);

    // The list names the contract and carries no bytes.
    const list = await request.get("/api/leases");
    const listed = ((await list.json()).data as Array<Record<string, unknown>>).find(
      (lease) => lease.id === leaseId,
    );
    expect(listed?.contractFileName).toBe("Contrato de arrendamento.pdf");
    expect(listed).not.toHaveProperty("contractFile");
    expect(listed?.parties).toHaveLength(2);

    const get = await request.get(`/api/leases/${leaseId}/contract`);
    expect(get.ok()).toBe(true);
    expect(get.headers()["content-type"]).toBe("application/pdf");
    expect(Buffer.from(await get.body()).equals(pdf)).toBe(true);
  });

  test("refuses a file that is not a PDF", async ({ request }) => {
    const headers = await csrfHeader(request);

    const put = await request.put(`/api/leases/${leaseId}/contract`, {
      data: Buffer.from("<html>not a contract</html>"),
      headers: { ...headers, "Content-Type": "application/pdf" },
    });

    expect(put.status()).toBe(415);
  });

  test("refuses an upload without the CSRF token", async ({ request }) => {
    const put = await request.put(`/api/leases/${leaseId}/contract`, {
      data: pdf,
      headers: { "Content-Type": "application/pdf" },
    });

    expect(put.status()).toBe(403);
  });
});
