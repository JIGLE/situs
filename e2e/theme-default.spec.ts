import { test, expect } from "@playwright/test";

/**
 * How the app opens. A device with no stored choice opens dark, whatever its own colour scheme is
 * (a phone in light mode used to get a light page, then a flash), and a device that chose light
 * keeps it. The status bar of an installed app follows the page, so the `theme-color` tag is
 * checked with it.
 */
test.describe("Launch theme", () => {
  test.use({ colorScheme: "light" });

  test("opens dark on a device with no choice, even when the phone is in light mode", async ({
    page,
  }) => {
    await page.goto("/auth/signin");

    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-mode", "dark");
    await expect(html).toHaveClass(/\bdark\b/);
    expect(await page.evaluate(() => document.documentElement.style.colorScheme)).toBe("dark");

    const colours = await page.evaluate(() =>
      Array.from(document.querySelectorAll('meta[name="theme-color"]')).map((tag) =>
        tag.getAttribute("content"),
      ),
    );
    expect(colours.length).toBeGreaterThan(0);
    expect(new Set(colours)).toEqual(new Set(["#0b110d"]));
  });

  test("keeps a device's own choice of light, and moves the status bar with it", async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem("situs-mode", "normal"));
    await page.goto("/auth/signin");

    await expect(page.locator("html")).toHaveAttribute("data-mode", "normal");
    const colours = await page.evaluate(() =>
      Array.from(document.querySelectorAll('meta[name="theme-color"]')).map((tag) =>
        tag.getAttribute("content"),
      ),
    );
    expect(new Set(colours)).toEqual(new Set(["#f6f0e4"]));
  });

  test("the install manifest opens on the same dark colour", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest");
    expect(response.ok()).toBe(true);

    const manifest = await response.json();
    expect(manifest.background_color).toBe("#0b110d");
    expect(manifest.theme_color).toBe("#0b110d");
  });
});
