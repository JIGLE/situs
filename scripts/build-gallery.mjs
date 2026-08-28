#!/usr/bin/env node
/**
 * Builds one self-contained HTML page pairing every audited surface's desktop and mobile
 * screenshots with the numbers the harness measured for it.
 *
 * The question it answers is "was anything skipped or missed", which is why it is built from
 * the harness's own surface list rather than from whatever images happen to be on disk: a
 * surface that failed to render, or never ran at all, has to appear *as a gap*, loudly. A
 * gallery assembled by globbing `shots/` would show 24 healthy surfaces and say nothing about
 * the two that died, which is the exact failure it exists to catch.
 *
 *   node scripts/build-gallery.mjs [--out gallery.html]
 *
 * Expects `npm run audit:local` to have produced audit-desktop/ and audit-mobile/ first.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";

const ROOT = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const outPath = args.includes("--out")
  ? args[args.indexOf("--out") + 1]
  : join(ROOT, "gallery.html");

const PASSES = [
  { key: "desktop", dir: "audit-desktop", width: 1440, report: "report-1440.json", maxW: 900 },
  { key: "mobile", dir: "audit-mobile", width: 390, report: "report-390.json", maxW: 390 },
];

/**
 * Raw PNGs run to roughly 25MB across both passes and the artifact ceiling is 16MB — before
 * base64 adds a third on top. The WebP conversion is what makes the page publishable at all,
 * not a nicety, so the budget is asserted rather than hoped for.
 */
const QUALITY = 72;
const BUDGET_BYTES = 14 * 1024 * 1024;

/** The harness's own list, read from source so the two cannot drift apart. */
function surfaceIds() {
  const src = readFileSync(join(ROOT, "scripts/mobile-audit.mjs"), "utf8");
  const block = src.slice(
    src.indexOf("const SURFACES = ["),
    src.indexOf("\n];", src.indexOf("const SURFACES = [")),
  );
  return [...block.matchAll(/\{\s*id:\s*"([^"]+)"/g)].map((m) => m[1]);
}

async function toDataUri(pngPath, maxWidth) {
  const webp = await sharp(pngPath)
    .resize({ width: maxWidth, withoutEnlargement: true })
    .webp({ quality: QUALITY })
    .toBuffer();
  return { uri: `data:image/webp;base64,${webp.toString("base64")}`, bytes: webp.length };
}

const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

/**
 * Every numeric field the report carries, rather than a hardcoded list. The metric set has
 * grown twice already (density metrics, then render-failure detection); a fixed list silently
 * drops whatever is added next, and a metric nobody renders is a metric nobody acts on.
 */
const SKIP_FIELDS = new Set([
  "id",
  "theme",
  "path",
  "status",
  "screenshot",
  "screenshotFull",
  "screenshotFullIsViewport",
  "error",
  "renderFailure",
  "reachedNetworkIdle",
  "rateLimited",
  "viewportWidth",
]);
const ALARMING = new Set([
  "pageOverflow",
  "touchTargetFails",
  "clippedContainers",
  "viewportTallChildren",
  "inertAnimationCount",
]);

function metricsFor(result) {
  if (!result) return [];
  return Object.entries(result)
    .filter(
      ([k, v]) =>
        !SKIP_FIELDS.has(k) && (typeof v === "number" || (Array.isArray(v) && v.length >= 0)),
    )
    .map(([k, v]) => ({ key: k, value: Array.isArray(v) ? v.length : v }))
    .filter((m) => Number.isFinite(m.value));
}

async function main() {
  const ids = surfaceIds();
  const reports = {};
  for (const pass of PASSES) {
    const file = join(ROOT, pass.dir, pass.report);
    if (!existsSync(file)) throw new Error(`missing ${file} — run \`npm run audit:local\` first`);
    reports[pass.key] = JSON.parse(readFileSync(file, "utf8"));
  }

  const themes = ["dark", "light"];
  const rows = [];
  const gaps = [];
  let totalBytes = 0;

  for (const id of ids) {
    for (const theme of themes) {
      const cells = {};
      const problems = [];
      for (const pass of PASSES) {
        const r = reports[pass.key].results.find((x) => x.id === id && x.theme === theme);
        if (!r) {
          problems.push(`${pass.key}: no result recorded — the surface never ran`);
          continue;
        }
        if (r.status && r.status !== "ok")
          problems.push(`${pass.key}: status ${r.status}${r.error ? ` — ${r.error}` : ""}`);
        if (r.renderFailure) problems.push(`${pass.key}: ${r.renderFailure}`);
        const shot = r.screenshotFull ?? r.screenshot;
        if (shot && existsSync(join(ROOT, shot))) {
          const { uri, bytes } = await toDataUri(join(ROOT, shot), pass.maxW);
          totalBytes += bytes;
          cells[pass.key] = { uri, viewportOnly: !!r.screenshotFullIsViewport };
        } else {
          problems.push(`${pass.key}: no screenshot on disk`);
        }
        cells[`${pass.key}Metrics`] = metricsFor(r);
      }
      const row = { id, theme, ...cells, problems };
      rows.push(row);
      if (problems.length) gaps.push(row);
    }
  }

  if (totalBytes > BUDGET_BYTES) {
    throw new Error(
      `inlined images total ${(totalBytes / 1024 / 1024).toFixed(1)}MB, over the ${BUDGET_BYTES / 1024 / 1024}MB budget. ` +
        `Lower QUALITY or maxW rather than publishing a page that will be truncated.`,
    );
  }

  const html = render({ rows, gaps, ids, reports, totalBytes });
  writeFileSync(outPath, html);
  console.log(`[gallery] ${ids.length} surfaces × ${themes.length} themes → ${outPath}`);
  console.log(`[gallery] inlined ${(totalBytes / 1024 / 1024).toFixed(1)}MB of WebP`);
  if (gaps.length)
    console.log(
      `[gallery] ${gaps.length} surface-run(s) with problems — listed at the top of the page`,
    );
}

function metricList(metrics) {
  if (!metrics?.length) return "";
  return metrics
    .map((m) => {
      const bad = ALARMING.has(m.key) && m.value > 0;
      return `<span class="m${bad ? " m-bad" : ""}"><b>${esc(m.key)}</b>${esc(m.value)}</span>`;
    })
    .join("");
}

function render({ rows, gaps, ids, reports, totalBytes }) {
  const gapIds = new Set(gaps.map((g) => g.id));

  // The coverage strip: every surface as one block, clean or not. This is the answer to the
  // question the page exists for, and it belongs above the images rather than after them —
  // scrolling 52 bands to discover nothing was missed is not an answer, it is a search.
  const strip = ids
    .map((id) => {
      const bad = gapIds.has(id);
      return `<a class="blk${bad ? " blk-bad" : ""}" href="#s-${esc(id)}" title="${esc(id)}${bad ? " — did not come back clean" : ""}"><span>${esc(id)}</span></a>`;
    })
    .join("");

  const verdict = gaps.length
    ? `<div class="verdict verdict-bad">
         <p class="v-num">${gaps.length}</p>
         <div><h2>surface-run${gaps.length === 1 ? "" : "s"} did not come back clean</h2>
         <ul>${gaps.map((g) => `<li><code>${esc(g.id)}</code> <em>${esc(g.theme)}</em> — ${g.problems.map(esc).join("; ")}</li>`).join("")}</ul></div>
       </div>`
    : `<div class="verdict">
         <p class="v-num">${ids.length}</p>
         <div><h2>surfaces rendered, both themes, both widths</h2>
         <p>Nothing was skipped. Every surface in the harness's walk produced an image and a full set of measurements — including the four detail overlays, which only count as reached when a visible dialog actually mounts.</p></div>
       </div>`;

  const summaryRows = PASSES.map((p) => {
    const s = reports[p.key].summary;
    return `<tr><th>${esc(p.key)} · ${p.width}px</th>${Object.entries(s)
      .map(
        ([k, v]) =>
          `<td><b>${esc(k)}</b><span class="${ALARMING.has(k) && v > 0 ? "n-bad" : ""}">${esc(v)}</span></td>`,
      )
      .join("")}</tr>`;
  }).join("");

  const bands = rows
    .map(
      (r) => `
  <article class="band" id="s-${esc(r.id)}" data-theme-group="${esc(r.theme)}">
    <div class="band-id">
      <h3>${esc(r.id)}</h3>
      <span class="tag tag-${esc(r.theme)}">${esc(r.theme)}</span>
      ${r.problems.length ? `<span class="tag tag-bad">unclean</span>` : ""}
    </div>
    <div class="plates">
      <figure>
        <figcaption>desktop <i>1440</i>${r.desktop?.viewportOnly ? " <i>viewport only — overlay</i>" : ""}</figcaption>
        ${r.desktop ? `<img loading="lazy" src="${r.desktop.uri}" alt="${esc(r.id)}, desktop, ${esc(r.theme)} theme">` : `<p class="void">no image on disk</p>`}
        <div class="metrics">${metricList(r.desktopMetrics)}</div>
      </figure>
      <figure>
        <figcaption>mobile <i>390</i>${r.mobile?.viewportOnly ? " <i>viewport only — overlay</i>" : ""}</figcaption>
        ${r.mobile ? `<img loading="lazy" src="${r.mobile.uri}" alt="${esc(r.id)}, mobile, ${esc(r.theme)} theme">` : `<p class="void">no image on disk</p>`}
        <div class="metrics">${metricList(r.mobileMetrics)}</div>
      </figure>
    </div>
  </article>`,
    )
    .join("");

  return `<title>Surface Contact Sheet</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500&display=swap">
<style>
/* Plan-paper neutrals with a faint green-grey bias, and verdigris where the app itself uses
   emerald for a settled state. Rectilinear, zero radius, hairline rules — the gallery speaks
   the vernacular of the app it is documenting rather than importing one. */
:root{
  --paper:#f1f3f0; --sheet:#ffffff; --ink:#161a19; --dim:#5d6a66;
  --rule:#d2d8d3; --rule-soft:#e4e8e4; --accent:#1c5a4b; --alarm:#8e3030;
  --plate:#e8ebe8;
  --sans:"IBM Plex Sans",ui-sans-serif,system-ui,sans-serif;
  --disp:"Archivo",var(--sans);
  --mono:"IBM Plex Mono",ui-monospace,"SF Mono",Menlo,monospace;
}
:root:not([data-theme="light"]){
  @media (prefers-color-scheme: dark){
    --paper:#0d100f; --sheet:#151918; --ink:#e5eae7; --dim:#889691;
    --rule:#252d2b; --rule-soft:#1d2422; --accent:#6ec0a4; --alarm:#e08f8f;
    --plate:#0a0d0c;
  }
}
:root[data-theme="dark"]{
  --paper:#0d100f; --sheet:#151918; --ink:#e5eae7; --dim:#889691;
  --rule:#252d2b; --rule-soft:#1d2422; --accent:#6ec0a4; --alarm:#e08f8f;
  --plate:#0a0d0c;
}
*{box-sizing:border-box}
body{
  margin:0;background:var(--paper);color:var(--ink);
  font:400 16px/1.6 var(--sans);
  padding:0 clamp(16px,4vw,64px) 120px;
  -webkit-font-smoothing:antialiased;
}
a{color:inherit}
:where(a,button):focus-visible{outline:2px solid var(--accent);outline-offset:2px}

/* ── masthead ───────────────────────────────────────────────────────── */
.mast{padding:64px 0 0;max-width:74ch}
.eyebrow{font:500 11px/1 var(--mono);letter-spacing:.16em;text-transform:uppercase;
  color:var(--accent);margin:0 0 18px}
h1{font:600 clamp(32px,5vw,54px)/1.05 var(--disp);letter-spacing:-.025em;margin:0 0 14px;
  text-wrap:balance}
.lede{color:var(--dim);margin:0;max-width:64ch}

/* ── verdict ────────────────────────────────────────────────────────── */
.verdict{display:flex;gap:22px;align-items:flex-start;margin:44px 0 0;padding:24px 26px;
  background:var(--sheet);border:1px solid var(--rule);border-left:3px solid var(--accent)}
.verdict-bad{border-left-color:var(--alarm)}
.v-num{font:600 clamp(38px,6vw,58px)/.9 var(--disp);margin:0;color:var(--accent);
  font-variant-numeric:tabular-nums}
.verdict-bad .v-num{color:var(--alarm)}
.verdict h2{font:500 17px/1.35 var(--sans);margin:0 0 6px}
.verdict p{color:var(--dim);margin:0;font-size:14.5px}
.verdict ul{margin:8px 0 0;padding-left:18px;font-size:14px;color:var(--dim)}
.verdict li{margin:3px 0}
.verdict code{font:400 13px/1 var(--mono);color:var(--ink)}
.verdict em{font:400 11px/1 var(--mono);font-style:normal;text-transform:uppercase;
  letter-spacing:.08em}

/* ── coverage strip ─────────────────────────────────────────────────── */
.strip-h{font:500 11px/1 var(--mono);letter-spacing:.16em;text-transform:uppercase;
  color:var(--dim);margin:44px 0 12px}
.strip{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:1px;
  background:var(--rule);border:1px solid var(--rule)}
.blk{background:var(--sheet);padding:11px 10px;text-decoration:none;display:block;
  border-left:2px solid var(--accent);transition:background .12s ease}
.blk:hover{background:var(--plate)}
.blk-bad{border-left-color:var(--alarm)}
.blk span{font:400 11px/1.3 var(--mono);color:var(--dim);display:block;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.blk-bad span{color:var(--alarm)}

/* ── totals table ───────────────────────────────────────────────────── */
.totals{margin:28px 0 0;overflow-x:auto;border:1px solid var(--rule);background:var(--sheet)}
table{border-collapse:collapse;width:100%;font:400 12px/1 var(--mono)}
th{text-align:left;padding:13px 16px;color:var(--ink);font-weight:500;white-space:nowrap;
  border-right:1px solid var(--rule)}
td{padding:13px 16px;white-space:nowrap;border-right:1px solid var(--rule-soft)}
td b{display:block;font-weight:400;color:var(--dim);font-size:10px;letter-spacing:.08em;
  text-transform:uppercase;margin:0 0 5px}
td span{font-variant-numeric:tabular-nums}
.n-bad{color:var(--alarm)}

/* ── controls ───────────────────────────────────────────────────────── */
.controls{position:sticky;top:0;z-index:9;background:var(--paper);
  padding:22px 0 14px;margin:52px 0 0;border-bottom:1px solid var(--rule);
  display:flex;gap:7px;flex-wrap:wrap;align-items:center}
button{font:400 12px/1 var(--mono);letter-spacing:.04em;padding:9px 14px;cursor:pointer;
  border:1px solid var(--rule);background:var(--sheet);color:var(--dim);border-radius:0}
button[aria-pressed="true"]{border-color:var(--accent);color:var(--accent)}
.ctl-note{font:400 12px/1.4 var(--mono);color:var(--dim);margin-left:auto}

/* ── bands ──────────────────────────────────────────────────────────── */
.band{border-bottom:1px solid var(--rule);padding:34px 0;scroll-margin-top:80px}
.band-id{display:flex;align-items:center;gap:9px;margin:0 0 18px;flex-wrap:wrap}
.band h3{font:500 17px/1.2 var(--mono);margin:0;letter-spacing:-.01em}
.tag{font:400 10px/1 var(--mono);text-transform:uppercase;letter-spacing:.1em;
  color:var(--dim);border:1px solid var(--rule);padding:5px 7px}
.tag-bad{color:var(--alarm);border-color:var(--alarm)}
.plates{display:grid;grid-template-columns:1fr;gap:26px}
@media(min-width:940px){.plates{grid-template-columns:minmax(0,1fr) 300px}}
figure{margin:0;min-width:0}
figcaption{font:400 10px/1 var(--mono);text-transform:uppercase;letter-spacing:.1em;
  color:var(--dim);margin:0 0 9px}
figcaption i{font-style:normal;color:var(--ink);opacity:.55;margin-left:5px}
img{display:block;width:100%;height:auto;border:1px solid var(--rule);background:var(--plate)}
.void{border:1px dashed var(--alarm);color:var(--alarm);padding:40px 12px;text-align:center;
  font:400 11px/1 var(--mono);margin:0}
.metrics{display:flex;flex-wrap:wrap;gap:4px;margin:11px 0 0}
.m{font:400 11px/1 var(--mono);color:var(--ink);border:1px solid var(--rule-soft);
  padding:6px 8px;white-space:nowrap;font-variant-numeric:tabular-nums}
.m b{font-weight:400;color:var(--dim);margin-right:7px}
.m-bad{color:var(--alarm);border-color:var(--alarm)}

@media (prefers-reduced-motion: reduce){*{transition:none !important}}
</style>

<header class="mast">
  <p class="eyebrow">Situs · audit walk · locale pt</p>
  <h1>Every surface, desktop and mobile</h1>
  <p class="lede">The full walk the audit harness makes — ${ids.length} surfaces, both themes, at
  1440&times;900 and 390&times;844. Pages are captured full-height; the four detail overlays are captured
  at viewport size, because a modal is a viewport-sized thing and expanding to the page behind it
  buries the dialog. Every number beside an image is what the harness measured for that exact run.</p>
</header>

${verdict}

<p class="strip-h">Coverage — ${ids.length} surfaces</p>
<nav class="strip">${strip}</nav>

<div class="totals"><table><tbody>${summaryRows}</tbody></table></div>

<div class="controls">
  <button id="both" aria-pressed="true">Both themes</button>
  <button id="dark" aria-pressed="false">Dark</button>
  <button id="light" aria-pressed="false">Light</button>
  <span class="ctl-note">${(totalBytes / 1024 / 1024).toFixed(1)}MB WebP</span>
</div>

${bands}

<script>
const btns = { both: document.getElementById("both"), dark: document.getElementById("dark"), light: document.getElementById("light") };
function pick(which){
  for (const [k, b] of Object.entries(btns)) b.setAttribute("aria-pressed", String(k === which));
  for (const el of document.querySelectorAll(".band"))
    el.hidden = !(which === "both" || el.dataset.themeGroup === which);
}
for (const k of Object.keys(btns)) btns[k].addEventListener("click", () => pick(k));
</script>`;
}

main().catch((err) => {
  console.error(`[gallery] ${err.message}`);
  process.exit(1);
});
