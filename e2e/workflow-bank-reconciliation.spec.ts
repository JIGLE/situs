import { test, expect, type APIRequestContext } from "@playwright/test";
import { settle } from "./helpers/wait";

test.use({ storageState: "playwright/.auth/user.json" });

/**
 * Critical Path: the Situs reference-month workflow (PRs 6-8) — a bank movement arrives, is put
 * through the import pipeline, and lands in the Bank movements inbox.
 *
 * A live bank connection is the only way movements reach an instance: the CSV import this spec used
 * to drive is gone, and CI cannot reach a bank. So the movement goes in through
 * `/api/debug/bank/movements`, which runs the same `importBankRows` a sync does and is open only in
 * demo mode, as the suite runs. It does not assert a match outcome (that depends on the seeded
 * leases); `workflow-full-chain.spec.ts` does. It asserts that the pipeline runs, that the inbox
 * shows the movement, and that the inbox no longer offers a CSV import.
 */

async function csrfHeader(request: APIRequestContext): Promise<Record<string, string>> {
  await request.get("/api/csrf-token");
  const { cookies } = await request.storageState();
  const token = cookies.find((c) => c.name === "csrf-token")?.value;
  expect(token, "no csrf-token cookie after GET /api/csrf-token").toBeTruthy();
  return { "x-csrf-token": token as string };
}

test("Critical Path: a bank movement lands in the inbox", async ({ page, request }) => {
  // Unique per run: the import is idempotent by fingerprint, so a fixed row imports once and is
  // deduplicated on every later run against the same database.
  const today = new Date().toISOString().split("T")[0];
  const reference = `e2e smoke ${Date.now()}`;

  const res = await request.post("/api/debug/bank/movements", {
    data: {
      rows: [{ bookingDate: today, amount: 1, counterpartyName: "E2E Test Payer", reference }],
    },
    headers: await csrfHeader(request),
  });
  expect(res.ok(), `POST /api/debug/bank/movements → ${res.status()}: ${await res.text()}`).toBe(
    true,
  );
  expect((await res.json()).data).toMatchObject({ imported: 1 });

  await page.goto("/financials?tab=bank");
  await settle(page);

  await expect(page.getByText(reference).first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("button", { name: /import csv/i })).toHaveCount(0);
});
