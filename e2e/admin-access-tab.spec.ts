import { test, expect, type Page } from "@playwright/test";
import en from "../messages/en.json";

test.use({ storageState: "playwright/.auth/user.json" });

/**
 * Admin › Access, driven as the administrator the suite signs in as: the two switches, the
 * invitations and the accounts' roles, from the screen and not only from the routes
 * (`admin-access.spec.ts` covers those).
 *
 * The suite's account is the only account, so the only administrator. That is what lets the last
 * test see the instance refuse to lose its administrator through the real stack: the click, the
 * CSRF check, `requireAdmin`, the conditional UPDATE, the 409 `last_admin` and the sentence it
 * becomes. It is also why that test checks the precondition first and fails loudly when it does not
 * hold: with a second administrator, the same clicks would demote the account the rest of the suite
 * signs in as.
 *
 * Every test puts back what it changed: the gate reads the switches for anyone who signs in as a
 * stranger, and the whole suite shares one database. A restore goes through the API, so a page that
 * broke mid-test cannot leave a switch where it was not.
 */

const t = en.admin.access;
const STAMP = Date.now();
const BASE = "/api/admin/access";

type Settings = { googleSignUp: boolean; invitations: boolean };
type Account = { id: string; email: string; role: "ADMIN" | "MANAGER" | "USER"; self: boolean };
type Access = {
  settings: Settings;
  invitations: { id: string; email: string }[];
  accounts: Account[];
};

/** State-changing routes are CSRF-guarded with a double-submit cookie. */
async function csrfHeader(page: Page): Promise<Record<string, string>> {
  await page.request.get("/api/csrf-token");
  const token = (await page.context().cookies()).find((c) => c.name === "csrf-token")?.value;
  expect(token, "no csrf-token cookie after GET /api/csrf-token").toBeTruthy();
  return { "x-csrf-token": token as string };
}

async function getAccess(page: Page): Promise<Access> {
  const res = await page.request.get(BASE);
  expect(res.ok(), `GET ${BASE} → ${res.status()}`).toBe(true);
  return (await res.json()).data as Access;
}

/** Puts the two switches back through the API. */
async function restoreSettings(page: Page, settings: Settings) {
  const res = await page.request.put(`${BASE}/settings`, {
    data: settings,
    headers: await csrfHeader(page),
  });
  expect(res.ok(), `restoring the switches → ${res.status()}`).toBe(true);
}

async function openAccess(page: Page) {
  await page.goto("/admin/access", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(t.subtitle)).toBeVisible({ timeout: 20000 });
}

const switchNamed = (page: Page, name: string) => page.getByRole("switch", { name });

test.describe.configure({ mode: "serial" });

test("opens as the Access tab: the switches, the invitations and the accounts", async ({
  page,
}) => {
  await openAccess(page);

  await expect(page).toHaveURL(/\/admin\/access$/);
  await expect(page.getByRole("heading", { level: 1, name: en.admin.shell.title })).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: en.admin.shell.sections })
      .getByRole("link", { name: en.admin.shell.nav.access, exact: true }),
  ).toHaveAttribute("aria-current", "page");

  // The two switches, as stored, and nothing else on the screen can be switched.
  const { settings } = await getAccess(page);
  await expect(switchNamed(page, t.newAccounts.invitations)).toHaveAttribute(
    "aria-checked",
    String(settings.invitations),
  );
  await expect(switchNamed(page, t.newAccounts.googleSignUp)).toHaveAttribute(
    "aria-checked",
    String(settings.googleSignUp),
  );
  await expect(page.locator("main").getByRole("switch")).toHaveCount(2);

  // The reader's own account is marked, and the sign-in methods below still report.
  await expect(page.locator("main").getByText(t.accounts.you, { exact: true })).toBeVisible();
  await expect(
    page.locator("main").getByRole("heading", { name: en.admin.signIn.providers }),
  ).toBeVisible();
});

test("keeps the address Sign-in used to have", async ({ page }) => {
  await page.goto("/admin/sign-in", { waitUntil: "domcontentloaded" });

  await expect(page).toHaveURL(/\/admin\/access$/);
  await expect(page.getByText(t.subtitle)).toBeVisible({ timeout: 20000 });
});

test("changes a switch from the screen, keeps it across a reload, and puts it back", async ({
  page,
}) => {
  const before = (await getAccess(page)).settings;
  const flipped = !before.invitations;

  try {
    await openAccess(page);
    const invitations = switchNamed(page, t.newAccounts.invitations);
    await invitations.click();

    await expect(invitations).toHaveAttribute("aria-checked", String(flipped));
    await expect(page.getByText(t.newAccounts.saved, { exact: true })).toBeVisible();

    // Stored, not just drawn: a reload reads it from the database.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(switchNamed(page, t.newAccounts.invitations)).toHaveAttribute(
      "aria-checked",
      String(flipped),
    );
    expect((await getAccess(page)).settings).toEqual({ ...before, invitations: flipped });
  } finally {
    await restoreSettings(page, before);
  }

  expect((await getAccess(page)).settings).toEqual(before);
});

test("asks before opening Google sign-up: declining changes nothing, confirming opens it", async ({
  page,
}) => {
  const before = (await getAccess(page)).settings;
  // The question is asked when the switch is opened, so start from closed.
  await restoreSettings(page, { ...before, googleSignUp: false });

  try {
    await openAccess(page);
    const google = switchNamed(page, t.newAccounts.googleSignUp);
    await expect(google).toHaveAttribute("aria-checked", "false");

    await google.click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(t.newAccounts.openGoogleTitle);
    await expect(dialog).toContainText(t.newAccounts.openGoogleDescription);
    await dialog.getByRole("button", { name: en.actions.cancel }).click();

    await expect(dialog).toBeHidden();
    await expect(google).toHaveAttribute("aria-checked", "false");
    expect((await getAccess(page)).settings.googleSignUp).toBe(false);

    await google.click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: t.newAccounts.openGoogleConfirm })
      .click();

    await expect(google).toHaveAttribute("aria-checked", "true");
    // The sentence at the top follows the switch: it must not say "closed" while the door is open.
    await expect(page.getByText(en.admin.signIn.registrationGoogle)).toBeVisible();
    expect((await getAccess(page)).settings.googleSignUp).toBe(true);
  } finally {
    await restoreSettings(page, before);
  }

  expect((await getAccess(page)).settings).toEqual(before);
});

test("invites an email from the screen, as a manager, and withdraws it", async ({
  page,
}, testInfo) => {
  const email = `guest-${STAMP}-${testInfo.project.name}@example.test`;
  const headers = await csrfHeader(page);

  try {
    await openAccess(page);
    await page.getByLabel(t.invitations.email).fill(email);
    await page.getByRole("button", { name: t.invitations.invite, exact: true }).click();

    const row = page.getByRole("listitem").filter({ hasText: email });
    await expect(row).toBeVisible();
    await expect(row).toContainText(t.roles.MANAGER);
    await expect(page.getByLabel(t.invitations.email)).toHaveValue("");
    expect((await getAccess(page)).invitations.map((invitation) => invitation.email)).toContain(
      email,
    );

    await page
      .getByRole("button", { name: t.invitations.removeLabel.replace("{email}", email) })
      .click();
    await expect(row).toBeHidden();
    expect((await getAccess(page)).invitations.map((invitation) => invitation.email)).not.toContain(
      email,
    );
  } finally {
    const left = (await getAccess(page)).invitations.find(
      (invitation) => invitation.email === email,
    );
    if (left) await page.request.delete(`${BASE}/invitations/${left.id}`, { headers });
  }
});

test("will not let the only administrator give up the role, and says why", async ({ page }) => {
  const access = await getAccess(page);
  const admins = access.accounts.filter((account) => account.role === "ADMIN");
  // With a second administrator the clicks below would succeed and demote the suite's own account.
  expect(
    admins.map((account) => account.email),
    "this test needs the suite's account to be the only administrator",
  ).toHaveLength(1);
  const own = access.accounts.find((account) => account.self);
  expect(own, "the signed-in account is not listed").toBeTruthy();
  expect(own?.role).toBe("ADMIN");

  await openAccess(page);
  const role = page.getByRole("combobox", {
    name: t.accounts.roleLabel.replace("{email}", own?.email ?? ""),
  });
  await expect(role).toContainText(t.roles.ADMIN);

  await role.click();
  await page.getByRole("option", { name: t.roles.MANAGER, exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText(t.accounts.demoteSelfTitle);
  await dialog.getByRole("button", { name: t.accounts.demoteSelfConfirm }).click();

  // The sentence, in the owner's language, and the role the account still holds.
  await expect(page.getByText(en.errors.api.lastAdmin)).toBeVisible();
  await expect(role).toContainText(t.roles.ADMIN);
  await expect(page).toHaveURL(/\/admin\/access$/);
  expect((await getAccess(page)).accounts.find((account) => account.self)?.role).toBe("ADMIN");
});
