import { test, expect, type Page } from "@playwright/test";
import en from "../messages/en.json";

test.use({ storageState: "playwright/.auth/user.json" });

/**
 * Admin's heading, and the section tab marked as the current page.
 *
 * Each section had an `h1` of its own until Admin joined the app's shell. Now one heading covers
 * them all, so the tab marked current is what says which section this is. The tab is looked up
 * inside Admin's own section nav, so no other link on the page can answer for it.
 */
async function expectSection(page: Page, tab: string) {
  await expect(page.getByRole("heading", { level: 1, name: en.admin.shell.title })).toBeVisible({
    timeout: 20000,
  });
  const sections = page.getByRole("navigation", { name: en.admin.shell.sections });
  await expect(sections.getByRole("link", { name: tab, exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
}

/**
 * The operator area — and specifically *which* page each assertion belongs to.
 *
 * `/admin` and `/admin/status` are two different components. Since the admin area became its own
 * route group, `/admin` renders `AdminControlCenter` ("the instance at a glance" — every check's
 * name and severity, nothing else) and `/admin/status` renders `SystemStatusView` (the same checks
 * with their detail and remedy). This spec used to point all three tests at `/admin` while its
 * docblock described the second one.
 *
 * It went unnoticed for as long as it did because two of the three kept passing against the wrong
 * page. The control center imports `SEVERITY_STYLE`/`SUMMARY_ORDER` from `system-status-view` and
 * renders its status list under `Panel title={t("title")}` — `Panel` emits an `h2` and
 * `admin.title` is "System status" — so both the heading lookup and the check names matched a
 * component these tests were never written for. Only the simulation disclosure, which exists
 * solely in `SystemStatusView`, gave it away, and only once the E2E job was made capable of
 * running at all.
 *
 * So every test below names its URL and anchors `toHaveURL` to the exact route. A test that can be
 * satisfied by its neighbour is not testing what its name says.
 *
 * Both pages sit under `app/[locale]/(admin)`, whose layout wraps them in `PortalAccessGuard` and
 * never mounts `AppDataGate` at all. The exemption pinned here is therefore structural — a
 * property of the route group rather than a note in one component. It matters because these pages
 * are opened precisely when the app is broken: verified during development against an instance
 * whose database was missing a column, where every other screen showed "Couldn't load your data"
 * while this one named the column and the command that fixes it.
 *
 * The assertions hold in BOTH the healthy and the broken state, which is what makes them safe in
 * CI. CI runs `prisma db push` before booting, so the schema check reports in-sync rather than
 * drifted — asserting on the drift text would pass locally and fail in CI for the wrong reason.
 */

test.describe("Admin › System status (/admin/status)", () => {
  test("renders independently of the account data fetch", async ({ page }) => {
    await page.goto("/admin/status", { waitUntil: "domcontentloaded" });

    // Reachability is not incidental. `canAccessPortalPath` derives access from the nav list, so
    // before /admin was added there it silently redirected to /dashboard.
    await expect(page).toHaveURL(/\/admin\/status$/);
    await expectSection(page, en.admin.shell.nav.status);

    // The load/error gate must not have replaced the page — this is the whole point.
    await expect(page.getByText(/couldn't load your data/i)).toHaveCount(0);
  });

  test("states plainly that no filing is real, whatever the checks say", async ({ page }) => {
    await page.goto("/admin/status", { waitUntil: "domcontentloaded" });

    // Unconditional, not derived from any check. An operator should not have to infer from a
    // row's colour that nothing reaches a tax authority.
    await expect(page.getByText(/no filing reaches a real tax authority/i)).toBeVisible({
      timeout: 20000,
    });

    // The `bank` check's own words, matched whole. `bank_provider`'s detail also says bank
    // movements can't arrive ("No bank data provider credentials on this instance, so bank
    // movements can't be imported."), so a looser phrase is a strict-mode violation here.
    //
    // Targeted rather than `.first()`. The next test uses `.first()` and that idiom is exactly
    // what lets an ambiguous match pass without anyone noticing. `bank` is the right one of the
    // two: the disclosure asserted above says "Bank connections are separate … and the check below
    // says which", and `bank` is the check that says which. `bank_provider` reports instance
    // configuration, a different claim. CI connects no bank, so this is the state it shows.
    await expect(page.getByText(/no bank is connected on this account/i)).toBeVisible();
  });

  test("reports every check group", async ({ page }) => {
    await page.goto("/admin/status", { waitUntil: "domcontentloaded" });
    await expectSection(page, en.admin.shell.nav.status);

    // Platform checks.
    await expect(page.getByText(/database schema/i).first()).toBeVisible();
    await expect(page.getByText(/pii encryption/i).first()).toBeVisible();

    // The tax check appears whether or not a connector record exists for this user — "no
    // connector yet" is itself information, and omitting the row would read as "fine". Portugal
    // is the only country; Spain's row went with its connector.
    await expect(page.getByText(/tax authority — PT/i)).toBeVisible();
    await expect(page.getByText(/tax authority — ES/i)).toHaveCount(0);
    await expect(page.getByText(/bank movements/i).first()).toBeVisible();
  });
});

test.describe("Admin › Control center (/admin)", () => {
  test("answers 'is anything wrong?' without opening a detail page", async ({ page }) => {
    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/admin$/);

    // The Overview tab marked current is what distinguishes this page from the status detail:
    // both share Admin's heading, and the status panel's `h2` below reads "System status" on both.
    await expectSection(page, en.admin.shell.nav.overview);

    // The whole point of the landing page: every check is named here, so an operator learns
    // whether anything is wrong without visiting four pages.
    await expect(page.getByText(/database schema/i).first()).toBeVisible();
    await expect(page.getByText(/tax authority — PT/i)).toBeVisible();
    await expect(page.getByText(/bank movements/i).first()).toBeVisible();

    // Same structural exemption as the detail page — both live in the `(admin)` group.
    await expect(page.getByText(/couldn't load your data/i)).toHaveCount(0);
  });

  test("keeps the full simulation disclosure one click away", async ({ page }) => {
    await page.goto("/admin", { waitUntil: "domcontentloaded" });

    // This page deliberately does NOT repeat the "no filing reaches a real tax authority"
    // sentence: it states the same fact per row, as a chip reading "simulated" derived from the
    // same `SIMULATED_MODES` set the connectors fail closed on, and it must fit one viewport
    // above `lg` without scrolling. That trade is only honest while the full wording stays
    // reachable — so the link is the thing under test, not decoration.
    //
    // Scoped to the panel, NOT the page. `AdminShellNav` renders a Status link in the shell on
    // every admin page, so a page-wide `a[href$="/admin/status"]` would pass on /admin/users just
    // as happily — it would be asserting the shell, not the control center. The first draft of
    // this test did exactly that; scoping is what makes deleting the panel's own link fail it.
    const statusPanel = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { level: 2, name: /^system status$/i }) });

    const detail = statusPanel.getByRole("link");
    await expect(detail).toHaveAttribute("href", /\/admin\/status$/, { timeout: 20000 });

    await detail.click();
    await expect(page).toHaveURL(/\/admin\/status$/);
    await expect(page.getByText(/no filing reaches a real tax authority/i)).toBeVisible({
      timeout: 20000,
    });
  });
});
