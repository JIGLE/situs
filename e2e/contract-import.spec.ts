import { test, expect } from "@playwright/test";
import { sampleExtraction } from "../tests/fixtures/contract-extraction";

test.use({ storageState: "playwright/.auth/user.json" });

/**
 * Importing a lease from its contract, through the running app.
 *
 * Only the reading is stubbed: CI has no Anthropic key, and a reading is a paid call to a model
 * whose answer varies. Everything after it is real — the review sheet, the import route's
 * validation and transaction, the contract upload, and the lease that opens at the end — so this
 * proves what the unit tests' mocks cannot: that a reading the sheet accepts is one the server
 * writes, and that what it writes reads back.
 */

const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

test.describe("Import a lease from its contract", () => {
  test("reads, holds Confirm until the review is complete, then creates the lease", async ({
    page,
    request,
  }, testInfo) => {
    // Tenant and owner emails are unique across the instance, and both projects run this.
    const stamp = `${Date.now()}-${testInfo.project.name}`;
    const [ana, rui] = sampleExtraction.tenants;
    const reading = {
      ...sampleExtraction,
      tenants: [{ ...ana, email: `ana.${stamp}@test.local` }, rui],
    };

    // A holder rather than a `let`: TypeScript cannot see an assignment made inside the route.
    const sent: { body: Buffer | null } = { body: null };
    await page.route("**/api/contracts/extract", async (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({ json: { data: { configured: true } } });
      }
      sent.body = route.request().postDataBuffer();
      return route.fulfill({
        json: {
          data: {
            reading,
            matches: { property: null, landlords: [null, null], tenants: [null, null] },
          },
        },
      });
    });

    await page.goto("/leases");
    await page.getByRole("button", { name: "Import from contract" }).click();
    await expect(page).toHaveURL(/import=contract/);

    const sheet = page.getByRole("dialog", { name: "Import a lease from its contract" });
    // The owner is told where the PDF goes before sending it.
    await expect(
      sheet.getByText("sent to Anthropic, in the United States", { exact: false }),
    ).toBeVisible();

    await sheet.locator("#import-contract-file").setInputFiles({
      name: "contrato.pdf",
      mimeType: "application/pdf",
      buffer: pdf,
    });
    await sheet.getByRole("button", { name: "Read contract" }).click();

    // The contract names no landlord email, and a new owner needs one.
    const problems = sheet.getByTestId("import-problems");
    await expect(problems).toContainText("Maria Fernandes needs an email address.");
    const confirm = sheet.getByRole("button", { name: "Confirm and create the lease" });
    await expect(confirm).toBeDisabled();
    expect(sent.body?.includes("%PDF-1.4"), "the PDF itself was sent to be read").toBe(true);

    await sheet.locator("#import-landlord-0-email").fill(`maria.${stamp}@test.local`);
    await sheet.locator("#import-landlord-1-email").fill(`paulo.${stamp}@test.local`);
    await expect(problems).toBeHidden();
    await confirm.click();

    // The sheet closes and the new lease opens, with the clauses the contract was read for.
    await expect(page).toHaveURL(/detail=lease(%3A|:)/, { timeout: 20_000 });
    await expect(sheet).toBeHidden();
    await expect(page.getByText("Contract clauses")).toBeVisible();
    await expect(page.getByText("Rent update", { exact: true })).toBeVisible();

    // And the server holds exactly what was confirmed.
    const leaseId = decodeURIComponent(
      new URL(page.url()).searchParams.get("detail") ?? "",
    ).replace(/^lease:/, "");
    const leases = (await (await request.get("/api/leases")).json()).data as Array<
      Record<string, unknown>
    >;
    const lease = leases.find((l) => l.id === leaseId);
    expect(lease, `lease ${leaseId} is listed`).toBeTruthy();
    expect(lease).toMatchObject({
      monthlyRent: 950,
      deposit: 1900,
      atContractNumber: "20240012345",
      atContractVersion: 1,
      contractFileName: "contrato.pdf",
      tenant: { name: "Ana Costa", email: `ana.${stamp}@test.local` },
    });
    expect(lease?.parties).toHaveLength(2);
    expect(lease?.clauses).toHaveLength(2);

    const stored = await request.get(`/api/leases/${leaseId}/contract`);
    expect(stored.ok()).toBe(true);
    expect((await stored.body()).equals(pdf), "the stored contract is the file chosen").toBe(true);
  });
});
