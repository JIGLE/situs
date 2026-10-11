import { test, expect } from "@playwright/test";

/**
 * The sign-in page fits the phone's visible screen: it does not scroll at the sizes phones come in,
 * and nothing runs off the side at any width, narrow or magnified, in either theme.
 *
 * It scrolled inside the owner's installed app. The cause (a `100vh` shell, taller than the
 * visible area under Android's system bars) cannot be reproduced here, because Chromium's `vh`
 * equals its window; `tests/viewport-units-contract.test.ts` guards that by reading the source.
 * What this file holds is the part a browser CAN measure: a layout that fits, and the installed
 * app's behaviour (`display-mode: standalone`) that does not bounce.
 */
const PORTRAIT_PHONES: Array<[number, number]> = [
  [320, 568],
  [360, 640],
  [360, 780],
  [412, 915],
];
const NARROW_OR_MAGNIFIED: Array<[number, number]> = [
  [277, 600], // 360px at 1.3× text size
  [740, 360], // a phone on its side
];

test.describe("Sign-in viewport", () => {
  test.use({ hasTouch: true, isMobile: true });

  for (const mode of ["dark", "normal"] as const) {
    for (const [width, height] of PORTRAIT_PHONES) {
      test(`${width}×${height} (${mode}) does not scroll`, async ({ browser }) => {
        const context = await browser.newContext({
          viewport: { width, height },
          isMobile: true,
          hasTouch: true,
        });
        const page = await context.newPage();
        await page.addInitScript((m) => localStorage.setItem("situs-mode", m), mode);
        await page.goto("/auth/signin");
        await expect(page.locator("h1")).toBeVisible();
        // The email and password form exists only on demo and self-hosted instances (CI turns it
        // on, the owner's instance does not). The production layout is what must fit, so it is
        // taken out of this measurement; the narrow and magnified cases below keep it in and
        // require that the button stays reachable.
        await page.addStyleTag({ content: "form { display: none !important; }" });

        const overflow = await page.evaluate(() => ({
          vertical: document.documentElement.scrollHeight - window.innerHeight,
          horizontal: document.documentElement.scrollWidth - window.innerWidth,
        }));
        expect(overflow.vertical, "the page scrolls vertically").toBeLessThanOrEqual(0);
        expect(overflow.horizontal, "the page scrolls sideways").toBeLessThanOrEqual(0);
        await context.close();
      });
    }
  }

  for (const [width, height] of NARROW_OR_MAGNIFIED) {
    test(`${width}×${height} never runs off the side, and the sign-in button stays reachable`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        viewport: { width, height },
        isMobile: true,
        hasTouch: true,
      });
      const page = await context.newPage();
      await page.goto("/auth/signin");
      const button = page.getByRole("button", { name: /google/i });
      await button.scrollIntoViewIfNeeded();
      await expect(button).toBeInViewport();

      const horizontal = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(horizontal, "the page scrolls sideways").toBeLessThanOrEqual(0);
      await context.close();
    });
  }

  test("the stylesheet stops an installed app bouncing when a page that fits is pulled", async ({
    page,
  }) => {
    await page.goto("/auth/signin");

    // Chromium cannot emulate `display-mode`, so read the rule the app ships rather than the
    // computed style: the standalone media rule must set `overscroll-behavior-y: none` on <html>.
    const shipped = await page.evaluate(() => {
      const found: string[] = [];
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const rule of Array.from(rules)) {
          if (
            !(rule instanceof CSSMediaRule) ||
            !/display-mode:\s*standalone/.test(rule.conditionText)
          )
            continue;
          for (const inner of Array.from(rule.cssRules)) {
            const style = (inner as CSSStyleRule).style;
            if ((inner as CSSStyleRule).selectorText === "html" && style) {
              found.push(style.getPropertyValue("overscroll-behavior-y"));
            }
          }
        }
      }
      return found;
    });

    expect(shipped).toContain("none");
  });
});
