#!/usr/bin/env node
/**
 * Proves the audit's density metrics can actually fire.
 *
 * Every metric in `measure()` is a count, and a count that is always zero is indistinguishable
 * from a clean result. This harness has been bitten by that exact confusion twice in one day:
 * a run that hit the app's rate limiter scored twelve error screens as flawless, and the first
 * draft of `contentWidthRatio` measured wrappers instead of leaves and read 100% on all 26
 * surfaces — a number that could not have been anything else.
 *
 * So each density metric is run against a page built to trigger it, and against one built not
 * to. A metric that does not move between the two is not measuring anything.
 */
import { chromium } from "playwright";
import { measure } from "./mobile-audit.mjs";

const ARGS = { touchFail: 24, touchWarn: 44, minFontPx: 12, tolerance: 1 };

const page = (body) => `<!doctype html><html><body style="margin:0">
<div id="main-content" style="position:relative;width:1440px;height:900px;overflow-y:auto">${body}</div>
</body></html>`;

// Enough painted children that the render-failure guard (which needs 12) stays quiet.
const filler = (n, style = "") =>
  Array.from({ length: n }, (_, i) => `<p style="${style}">row ${i}</p>`).join("");

/**
 * A band of page chrome `px` tall that is NOT a repeating structure: a heading, a paragraph and a
 * rule, all different heights. `filler()` cannot be used for this — six identical paragraphs are
 * a repeating structure by any honest definition, and the first draft of these cases used it and
 * measured the spacer instead of the content it was meant to sit above.
 */
const chrome = (px) =>
  `<div style="height:${px}px"><h2 style="font-size:28px;margin:0">Heading</h2>` +
  `<p style="font-size:13px">A subtitle line of prose.</p><hr style="height:2px">` +
  `<p style="font-size:11px">A smaller note.</p></div>`;

const CASES = [
  {
    name: "wastedRun",
    // 400px of nothing between two bands of content, inside the fold.
    trigger: page(`${filler(12)}<div style="height:400px"></div>${filler(12)}`),
    clean: page(filler(40)),
    read: (m) => m.wastedRun,
    expect: (bad, good) => bad > 300 && good < 50,
  },
  {
    name: "contentWidthRatio",
    trigger: page(`<div style="width:300px">${filler(14)}</div>`),
    clean: page(`<div style="width:1440px">${filler(14)}</div>`),
    read: (m) => m.contentWidthRatio,
    expect: (bad, good) => bad < 0.5 && good > 0.9,
  },
  {
    name: "leftEdgeCount",
    trigger: page(
      [40, 120, 260, 400, 610]
        .map(
          (x) =>
            `<div style="margin-left:${x}px;width:400px;height:60px;background:#123">${filler(3)}</div>`,
        )
        .join(""),
    ),
    clean: page(
      [40, 40, 40]
        .map(
          () =>
            `<div style="margin-left:40px;width:400px;height:60px;background:#123">${filler(4)}</div>`,
        )
        .join(""),
    ),
    read: (m) => m.leftEdgeCount,
    expect: (bad, good) => bad >= 5 && good <= 2,
  },
  {
    name: "inertAnimationCount",
    // `animate-spin` with no stylesheet defining it — precisely the overlay bug's shape.
    trigger: page(`${filler(12)}<div class="animate-spin" style="width:40px;height:40px">x</div>`),
    clean: page(
      `<style>@keyframes s{to{transform:rotate(360deg)}}.animate-spin{animation:s 1s linear infinite}</style>` +
        `${filler(12)}<div class="animate-spin" style="width:40px;height:40px">x</div>`,
    ),
    read: (m) => m.inertAnimationCount,
    expect: (bad, good) => bad === 1 && good === 0,
  },
  {
    // The list shape: chrome, then a repeating structure.
    name: "contentStartY (list page)",
    trigger: page(
      chrome(420) +
        `<table><tbody>${Array.from({ length: 4 }, () => "<tr><td>row</td></tr>").join("")}</tbody></table>` +
        filler(12),
    ),
    clean: page(
      `<table><tbody>${Array.from({ length: 4 }, () => "<tr><td>row</td></tr>").join("")}</tbody></table>` +
        filler(12),
    ),
    read: (m) => m.contentStartY,
    expect: (bad, good) => bad > 380 && good < 60,
  },
  {
    // The form shape, which the old rule could not see at all: no repeating structure near the
    // top, so it ran on until it found one somewhere else — or reported 0 having found none.
    name: "contentStartY (form page)",
    trigger: page(
      `<h1>Settings</h1>` + chrome(400) + `<label>Name <input type="text"></label>` + filler(12),
    ),
    clean: page(`<h1>Settings</h1><label>Name <input type="text"></label>${filler(12)}`),
    read: (m) => m.contentStartY,
    expect: (bad, good) => bad > 380 && good < 150,
  },
  {
    // A header button is chrome. If it counted, every page would report ~0 and the metric would
    // rank nothing.
    name: "contentStartY ignores header buttons",
    trigger: page(
      `<h1>Tax filing <button>New filing</button></h1>` +
        chrome(400) +
        `<label>Year <input type="text"></label>` +
        filler(12),
    ),
    clean: page(
      `<h1>Tax filing <button>New filing</button></h1><label>Year <input></label>${filler(12)}`,
    ),
    read: (m) => m.contentStartY,
    expect: (bad, good) => bad > 380 && good < 150,
  },
  {
    name: "renderFailure",
    trigger: page(
      `<div role="alert" style="height:600px">Não foi possível carregar os seus dados</div>`,
    ),
    clean: page(filler(40)),
    read: (m) => (m.renderFailure ? 1 : 0),
    expect: (bad, good) => bad === 1 && good === 0,
  },
];

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
});
const tab = await browser.newPage({ viewport: { width: 1440, height: 900 } });

let failed = 0;
for (const c of CASES) {
  await tab.setContent(c.trigger);
  const bad = c.read(await tab.evaluate(measure, ARGS));
  await tab.setContent(c.clean);
  const good = c.read(await tab.evaluate(measure, ARGS));
  const pass = c.expect(bad, good);
  if (!pass) failed++;
  console.log(`${pass ? "✓" : "✗"} ${c.name.padEnd(20)} triggered=${bad}  clean=${good}`);
}
await browser.close();

if (failed) {
  console.error(
    `\n${failed} metric(s) did not move between a page that should trigger them and one that should not.`,
  );
  process.exit(1);
}
console.log("\nAll density metrics move as intended.");
