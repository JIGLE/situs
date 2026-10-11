import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * The sign-in page as the server sends it, and what it does.
 *
 * It used to be a spinner until the script loaded and the session request returned, so a cold
 * launch of the installed app showed a second loading screen after its splash, and with scripts
 * slow or blocked there was no form at all. These read the response itself.
 */
const GOOGLE = /google/i;

test.describe("the first response", () => {
  test("contains the form: no script is needed to see it, and there is no loading screen", async ({
    request,
  }) => {
    const response = await request.get("/auth/signin");
    expect(response.ok()).toBe(true);
    const html = await response.text();

    // The markup the server drew, before the first script: the page also ships its whole
    // translation catalogue to the browser, so the loading text exists in the response as data.
    const start = html.indexOf("<body");
    const markup = html.slice(start, html.indexOf("<script", start));
    expect(markup).toMatch(/<main\b/);
    expect(markup).toMatch(/<h1\b/);
    expect(markup).toMatch(GOOGLE);
    expect(markup).not.toMatch(/A carregar…|Loading…/);
  });

  test("tells a visitor with no account that access is by invitation, on a closed instance", async ({
    page,
  }) => {
    await page.goto("/auth/signin");

    await expect(page.getByText(/by invitation only|acesso por convite/i)).toBeVisible();
    await expect(page.locator('a[href="/auth/signup"]')).toHaveCount(0);
  });

  test("answers the sign-up page of a closed instance with the sign-in page", async ({
    request,
  }) => {
    const plain = await request.get("/auth/signup", { maxRedirects: 0 });
    expect(plain.status()).toBe(307);
    expect(plain.headers()["location"]).toBe("/auth/signin");

    const headed = await request.get("/auth/signup?callbackUrl=%2Fportfolio", {
      maxRedirects: 0,
    });
    expect(headed.headers()["location"]).toBe("/auth/signin?callbackUrl=%2Fportfolio");
  });
});

test.describe("a visitor who is already signed in", () => {
  test.use({ storageState: "playwright/.auth/user.json" });

  test("is sent on by the server, without seeing the form", async ({ request }) => {
    const plain = await request.get("/auth/signin", { maxRedirects: 0 });
    expect(plain.status()).toBe(307);
    expect(plain.headers()["location"]).toBe("/dashboard");

    const headed = await request.get("/auth/signin?callbackUrl=%2Fportfolio", {
      maxRedirects: 0,
    });
    expect(headed.headers()["location"]).toBe("/portfolio");
  });

  test("is not sent to another site by a callbackUrl", async ({ request }) => {
    for (const evil of ["https%3A%2F%2Fevil.example%2F", "%2F%2Fevil.example"]) {
      const response = await request.get(`/auth/signin?callbackUrl=${evil}`, { maxRedirects: 0 });
      expect(response.headers()["location"]).toBe("/dashboard");
    }
  });
});

test.describe("the page on a phone", () => {
  test.use({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });

  test("lists the three steps of the workflow, with the way in under them", async ({ page }) => {
    await page.goto("/auth/signin");

    await expect(page.getByRole("list").locator("li")).toHaveCount(3);
    const button = page.getByRole("button", { name: GOOGLE });
    await expect(button).toBeInViewport();
    const box = await button.boundingBox();
    expect(box?.height, "a 52px target").toBeGreaterThanOrEqual(52);
  });

  test("gives way on a short screen: the list goes, the button stays", async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 360, height: 640 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    await page.goto("/auth/signin");

    await expect(page.getByRole("list")).toBeHidden();
    await expect(page.getByRole("button", { name: GOOGLE })).toBeInViewport();
    await context.close();
  });

  test("answers a tap at once: the button is busy and cannot be tapped twice", async ({ page }) => {
    // Hold the request, as a slow phone connection would.
    await page.route("**/api/auth/**", () => new Promise(() => {}));
    await page.goto("/auth/signin");
    const button = page.getByRole("button", { name: GOOGLE });

    await button.click();

    await expect(button).toHaveAttribute("aria-busy", "true");
    await expect(button).toBeDisabled();
  });
});

test.describe("accessibility", () => {
  for (const mode of ["dark", "normal"] as const) {
    test(`has no critical or serious violations (${mode})`, async ({ page }) => {
      await page.addInitScript((m) => localStorage.setItem("situs-mode", m), mode);
      await page.goto("/auth/signin");
      await expect(page.locator("h1")).toBeVisible();

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .exclude("iframe")
        .analyze();
      const blocking = results.violations.filter(
        (v) => v.impact === "critical" || v.impact === "serious",
      );
      expect(JSON.stringify(blocking, null, 2)).toBe("[]");
    });
  }
});
