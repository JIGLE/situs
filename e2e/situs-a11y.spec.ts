import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import en from "../messages/en.json";
import { settle } from "./helpers/wait";

/**
 * Accessibility pass over the Situs surfaces added in this rebranding
 * initiative (PRs 1-11): the reference-month/bank/tax/OCR workflow views.
 * Scoped to what's new, not a from-scratch audit of the whole app — the
 * pre-existing surfaces have their own established baseline.
 *
 * critical/serious violations fail the test; moderate/minor are reported
 * but not blocking, consistent with the repo's advisory color-token linter
 * pattern (ratchet down over time rather than a hard gate on day one).
 */

test.use({ storageState: "playwright/.auth/user.json" });

async function scanForSeriousViolations(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .exclude("iframe")
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  return { blocking, all: results.violations };
}

test.describe("Situs surfaces — accessibility (WCAG2A/AA)", () => {
  test("Finance › Bank Movements inbox has no critical/serious violations", async ({ page }) => {
    await page.goto("/financials?tab=bank");
    await settle(page);
    const { blocking } = await scanForSeriousViolations(page);
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });

  test("Finance › Receipts (the month's list) has no critical/serious violations", async ({
    page,
  }) => {
    await page.goto("/financials?tab=receipts");
    await settle(page);
    const { blocking } = await scanForSeriousViolations(page);
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });

  test("Finance › Tax Summary (connector dashboard) has no critical/serious violations", async ({
    page,
  }) => {
    await page.goto("/financials?tab=tax");
    await settle(page);
    const { blocking } = await scanForSeriousViolations(page);
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });

  test("Account page (audit trail) has no critical/serious violations", async ({ page }) => {
    await page.goto("/account");
    await settle(page);
    // The activity starts closed and loads when opened; open it, or the trail goes unscanned.
    await page.getByRole("button", { name: en.settings.panel.activity }).click();
    await settle(page);
    const { blocking } = await scanForSeriousViolations(page);
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });

  test("Settings › Integrations, both tabs, has no critical/serious violations", async ({
    page,
  }) => {
    await page.goto("/settings?tab=integrations");
    await settle(page);
    const banks = await scanForSeriousViolations(page);
    expect(banks.blocking, JSON.stringify(banks.blocking, null, 2)).toEqual([]);

    await page.getByRole("tab", { name: en.settings.panel.integrationTabs.at }).click();
    await settle(page);
    const finances = await scanForSeriousViolations(page);
    expect(finances.blocking, JSON.stringify(finances.blocking, null, 2)).toEqual([]);
  });
});
