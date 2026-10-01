import { test, expect, type APIRequestContext } from "@playwright/test";
import { settle } from "./helpers/wait";
import en from "../messages/en.json";

test.use({ storageState: "playwright/.auth/user.json" });

/**
 * A tenant, an owner and a property need no email, phone or rooms.
 *
 * Finanças names a person by NIF and name and a property by its address, so the import that reads
 * it has no email, phone or rooms to put in. They were required, and an email was unique across
 * every account. The records are created through the API with only what Finanças would give, and
 * the screens that show them are driven in the browser: a tenant or an owner with no address is
 * listed and opened without the word "null" where an address goes, and a second tenant with an
 * email the account already has is refused in words, not with a 500.
 */

const STAMP = Date.now();
const TENANT_NAME = `NoMail${STAMP} Tenant`;
const OWNER_NAME = `NoMail${STAMP} Owner`;
const PROPERTY_NAME = `NoRooms ${STAMP}`;
const SHARED_EMAIL = `shared-${STAMP}@example.test`;

/** State-changing routes are CSRF-guarded with a double-submit cookie. */
async function csrfHeader(request: APIRequestContext): Promise<Record<string, string>> {
  await request.get("/api/csrf-token");
  const { cookies } = await request.storageState();
  const token = cookies.find((c) => c.name === "csrf-token")?.value;
  expect(token, "no csrf-token cookie after GET /api/csrf-token").toBeTruthy();
  return { "x-csrf-token": token as string };
}

async function create<T>(
  request: APIRequestContext,
  url: string,
  data: unknown,
  headers: Record<string, string>,
): Promise<T> {
  const res = await request.post(url, { data, headers });
  expect(res.status(), `POST ${url} → ${res.status()}: ${await res.text()}`).toBe(201);
  return (await res.json()).data as T;
}

async function read<T>(request: APIRequestContext, url: string): Promise<T> {
  const res = await request.get(url);
  expect(res.ok(), `GET ${url} → ${res.status()}`).toBe(true);
  return (await res.json()).data as T;
}

/** What a screen shows where a missing value used to print: the word null. */
const NULL_WORD = /\bnull\b/;

test("a tenant, an owner and a property with no email, phone or rooms are kept, listed and opened", async ({
  request,
  page,
}) => {
  test.slow(); // a handful of round trips and four screens

  const headers = await csrfHeader(request);
  const made: string[] = [];

  try {
    const tenant = await test.step("they are created with only what Finanças gives", async () => {
      const t = await create<{ id: string }>(
        request,
        "/api/tenants",
        { name: TENANT_NAME },
        headers,
      );
      made.push(`/api/tenants/${t.id}`);
      const o = await create<{ id: string }>(request, "/api/owners", { name: OWNER_NAME }, headers);
      made.push(`/api/owners/${o.id}`);
      const p = await create<{ id: string }>(
        request,
        "/api/properties",
        {
          name: PROPERTY_NAME,
          address: `Rua do Sem Quartos ${STAMP}, Porto`,
          type: "apartment",
          rent: 600,
          status: "vacant",
        },
        headers,
      );
      made.push(`/api/properties/${p.id}`);

      // Stored as nothing: NULL, not "" and not 0, which a screen would show as a value.
      expect(await read(request, `/api/tenants/${t.id}`)).toMatchObject({
        email: null,
        phone: null,
      });
      expect(await read(request, `/api/owners`)).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: o.id, email: null })]),
      );
      expect(await read(request, `/api/properties/${p.id}`)).toMatchObject({
        bedrooms: null,
        bathrooms: null,
      });
      return { tenantId: t.id, propertyId: p.id };
    });

    await test.step("the People screen lists the tenant and the owner without a null", async () => {
      await page.goto("/people");
      await settle(page);
      await expect(page.getByText(TENANT_NAME).first()).toBeVisible();
      await expect(page.getByText(NULL_WORD)).toHaveCount(0);

      await page.goto("/people?view=owners");
      await settle(page);
      await expect(page.getByText(OWNER_NAME).first()).toBeVisible();
      await expect(page.getByText(NULL_WORD)).toHaveCount(0);
    });

    await test.step("the tenant opens, and says it has no email address", async () => {
      await page.goto(`/people?detail=tenant:${tenant.tenantId}`);
      await settle(page);
      await expect(page.getByText(en.tenants.modal.noEmail).first()).toBeVisible();
      await expect(page.getByText(TENANT_NAME).first()).toBeVisible();
      await expect(page.getByText(NULL_WORD)).toHaveCount(0);
    });

    await test.step("the property opens with no rooms, and shows none", async () => {
      await page.goto(`/dashboard?detail=property:${tenant.propertyId}`);
      await settle(page);
      await expect(page.getByText(PROPERTY_NAME).first()).toBeVisible();
      await expect(page.getByText(NULL_WORD)).toHaveCount(0);
    });

    await test.step("a second tenant with an email the account has is refused in words", async () => {
      const first = await create<{ id: string }>(
        request,
        "/api/tenants",
        { name: `Shared${STAMP} First`, email: SHARED_EMAIL },
        headers,
      );
      made.push(`/api/tenants/${first.id}`);

      // The API answers a 409 the screen can word, not the 500 a global unique index gave.
      const again = await request.post("/api/tenants", {
        data: { name: `Shared${STAMP} Second`, email: SHARED_EMAIL },
        headers,
      });
      expect(again.status(), await again.text()).toBe(409);
      expect(await again.json()).toMatchObject({ reason: "email_in_use" });

      // And so does the screen, in the user's language.
      await page.goto("/people");
      await settle(page);
      await page.getByRole("button", { name: "Add Tenant" }).first().click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await page.getByLabel("Full Name").fill(`Shared${STAMP} Third`);
      await page.getByLabel("Email").fill(SHARED_EMAIL);
      await dialog.getByRole("button", { name: /add tenant|create/i }).click();

      await expect(page.getByText(en.errors.api.emailInUse).first()).toBeVisible();
      // Nothing was created.
      const all = await read<{ name: string }[]>(request, "/api/tenants");
      expect(all.some((t) => t.name === `Shared${STAMP} Third`)).toBe(false);
    });
  } finally {
    for (const url of made.reverse()) {
      await request.delete(url, { headers }).catch(() => {});
    }
  }
});
