#!/usr/bin/env node
/**
 * One command that boots a disposable audit server and runs the measurement harness
 * against it — at both viewports, off one server and one seed.
 *
 * Why this exists: the env recipe the harness needs lived in exactly one place,
 * `.github/actions/start-app`, expressed as GitHub Actions inputs. Nothing carried it
 * locally, so bringing the app up by hand meant rediscovering it one failed boot at a
 * time — five separate variables, each of which fails differently and none of which
 * announces itself until the step that needs it:
 *
 *   NEXTAUTH_URL          prestart's validate-env refuses to run without it
 *   ENABLE_DEMO_LOGIN     absent, /auth/signin renders no credentials form and the
 *                         harness dies at "sign-in form not found"
 *   ALLOW_DEMO_MODE       absent, /api/debug/db/seed answers 403 and every number
 *                         the run produces describes empty screens
 *   PII_ENCRYPTION_KEY    absent, the server boots, seeds, and *then* exits mid-run
 *                         (see below) — the failure lands nowhere near the cause
 *   DATABASE_URL          absolute, and pointed somewhere disposable
 *
 * The PII one is the nastiest and is the reason this script always generates a key.
 * `lib/utils/env.ts` fails closed outside development: no key and no explicit waiver
 * means process.exit(1). It does that lazily, on the first request that touches an
 * encrypted field — so the boot succeeds, the seed succeeds, and the server dies on
 * the next API call with ECONNRESET at the harness. Setting a fresh key instead of
 * waiving with ALLOW_UNENCRYPTED_PII also means the encryption path is the one under
 * measurement, which is the point of having it.
 *
 * Note the same guard is skipped entirely under CI (`_isCI` covers GITHUB_ACTIONS), so
 * the CI audit job seeds plaintext PII into its throwaway database. Synthetic data on
 * an ephemeral runner, so not an exposure — but it does mean CI never exercises the
 * encrypted path. `.github/actions/start-app` now takes a generated key for that reason.
 *
 * Usage:
 *   node scripts/audit-server.mjs                  # both viewports (default)
 *   node scripts/audit-server.mjs --mobile         # 390x844 only
 *   node scripts/audit-server.mjs --desktop        # 1440x900 only
 *   node scripts/audit-server.mjs --only portfolio # filter, passed to the harness
 *   node scripts/audit-server.mjs --keep           # leave the scratch database in place
 */

import { spawn, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  statSync,
  readdirSync,
  readFileSync,
  cpSync,
  openSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";

const ROOT = resolve(import.meta.dirname, "..");
const PORT = Number(process.env.AUDIT_PORT ?? 3000);
// `localhost`, not `127.0.0.1`, even though the listener binds to the loopback address
// below. NextAuth issues its cookies and callback URLs against NEXTAUTH_URL's host, and a
// run that reaches the app by one spelling while the app answers with the other drops the
// session cookie on the redirect — the login then loops back to /auth/signin and the whole
// pass dies 20s later at waitForURL, with nothing in the message pointing at the host.
const BASE = `http://localhost:${PORT}`;

const args = process.argv.slice(2);
const has = (n) => args.includes(`--${n}`);
const opt = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
};

const wantMobile = has("mobile") || !has("desktop");
const wantDesktop = has("desktop") || !has("mobile");
const only = opt("only");

/**
 * Playwright's own resolution looks for `chrome-headless-shell-linux64/` inside the
 * headless-shell package. The sandbox image lays that build out as `chrome-linux/` and
 * ships two builds side by side, so the resolution misses and the documented
 * `/opt/pw-browsers/chromium` symlink points at the *older* of the two. Probe instead
 * of hardcoding: an empty string means "let Playwright decide", which is what CI needs.
 */
function resolveChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const dir = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!dir || !existsSync(dir)) return "";
  const builds = readdirSync(dir)
    .filter((n) => /^chromium-\d+$/.test(n))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const b of builds) {
    const bin = join(dir, b, "chrome-linux", "chrome");
    if (existsSync(bin)) return bin;
  }
  return "";
}

/**
 * Newest mtime across every tracked file a rebuild would pick up.
 *
 * This used to walk a hardcoded list of directories and immediately proved why that is the
 * wrong shape: `proxy.ts` sits at the repo root, was not on the list, and a run right after
 * editing it reported "build is newer than every source file" and measured the previous
 * build. A staleness check that can silently answer "fresh" about a stale build is worse
 * than no check.
 *
 * `git ls-files` cannot drift as the tree grows. The excluded prefixes are the ones that
 * cannot change the built output — including `scripts/`, so editing this file does not
 * trigger a rebuild of the app it measures. Over-rebuilding costs minutes; under-rebuilding
 * costs a wrong answer, so anything ambiguous stays in.
 */
const NO_REBUILD = ["docs/", "e2e/", "tests/", "scripts/", ".github/", "prisma/migrations/"];

function newestSourceMtime() {
  const listed = spawnSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" });
  if (listed.status !== 0) return Infinity; // not a checkout — always rebuild rather than guess
  let newest = 0;
  for (const rel of listed.stdout.split("\0")) {
    if (!rel || NO_REBUILD.some((p) => rel.startsWith(p))) continue;
    try {
      const m = statSync(join(ROOT, rel)).mtimeMs;
      if (m > newest) newest = m;
    } catch {
      /* deleted since it was listed */
    }
  }
  return newest;
}

/**
 * A build is minutes; skipping one that would produce the same output is the single
 * biggest saving here. Compare against BUILD_ID rather than the .next directory, whose
 * mtime moves whenever the server writes a cache entry.
 */
function ensureBuild() {
  const stamp = join(ROOT, ".next", "BUILD_ID");
  if (existsSync(stamp) && statSync(stamp).mtimeMs >= newestSourceMtime()) {
    console.log("[audit-env] build is newer than every source file — skipping rebuild");
    return;
  }
  console.log("[audit-env] sources changed since the last build — rebuilding");
  const r = spawnSync("npm", ["run", "build"], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, CI: "true" },
  });
  if (r.status !== 0) throw new Error("next build failed");
}

function makeScratchDb() {
  const dir = mkdtempSync(join(tmpdir(), "situs-audit-"));
  const file = join(dir, "audit.db");
  // Assert rather than trust. This script sets DATABASE_URL for a server that has demo
  // seeding open and a seed that begins by deleting the user's records — pointed at a
  // real database that is data loss, so the path is checked, not assumed.
  if (!file.startsWith(tmpdir() + sep))
    throw new Error(`refusing: scratch db outside tmpdir (${file})`);
  const r = spawnSync("npx", ["prisma", "db", "push", "--url", `file:${file}`], {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (r.status !== 0) throw new Error("prisma db push failed");
  return { dir, url: `file:${file}` };
}

/**
 * Refuse to start if anything already answers on the port.
 *
 * This is not politeness about port conflicts. A stale server from an earlier attempt
 * answers `/api/auth/providers` instantly and correctly, so every readiness check below
 * passes against it while the freshly spawned child dies on EADDRINUSE — and the entire
 * run then measures the old build, against the old database, and reports numbers that
 * look completely ordinary. It has already produced one published-and-retracted result.
 * Checking the log for EADDRINUSE is not enough, because the wait returns before the
 * child gets far enough to log anything.
 */
async function assertPortFree() {
  try {
    await fetch(`${BASE}/api/auth/providers`, { signal: AbortSignal.timeout(2000) });
  } catch {
    return; // nothing there — which is what we need
  }
  throw new Error(
    `something is already serving ${BASE}. This run would have measured that server rather ` +
      `than this build, and would have looked entirely normal doing it. Stop it first ` +
      `(pkill -f 'standalone/server.js'; pkill -f next-server) or set AUDIT_PORT.`,
  );
}

async function waitForCredentialsProvider(child, log, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(
        `server exited early (code ${child.exitCode})\n${readFileSync(log, "utf8").slice(-2000)}`,
      );
    // A port answering is not the health signal that matters. Every failure mode above
    // boots a server that serves pages fine and fails only the thing the run needs, so
    // the check is for the credentials provider itself.
    try {
      const res = await fetch(`${BASE}/api/auth/providers`);
      if (res.ok && (await res.json()).credentials) return;
    } catch {
      /* not up yet */
    }
    if (readFileSync(log, "utf8").includes("EADDRINUSE")) {
      throw new Error(
        "port in use — another server is holding it; this run would have measured that one",
      );
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server never exposed the credentials provider within ${timeoutMs}ms`);
}

async function main() {
  await assertPortFree();
  ensureBuild();
  const scratch = makeScratchDb();
  const log = join(scratch.dir, "server.log");
  const chromium = resolveChromium();
  console.log(`[audit-env] chromium: ${chromium || "(playwright default)"}`);

  // Mirrors the Dockerfile and .github/actions/start-app: standalone bundles server code
  // but neither static/ nor public/, and `next start` does not drive a standalone build
  // at all. Running the same entrypoint as CI is what keeps the two measuring one app.
  cpSync(join(ROOT, ".next/static"), join(ROOT, ".next/standalone/.next/static"), {
    recursive: true,
    force: true,
  });
  if (existsSync(join(ROOT, "public"))) {
    cpSync(join(ROOT, "public"), join(ROOT, ".next/standalone/public"), {
      recursive: true,
      force: true,
    });
  }

  const out = openSync(log, "w");
  const child = spawn("node", [".next/standalone/server.js"], {
    cwd: ROOT,
    stdio: ["ignore", out, out],
    env: {
      ...process.env,
      DATABASE_URL: scratch.url,
      NEXTAUTH_URL: BASE,
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? "audit-secret-minimum-32-characters-long",
      // Generated per run and never written to disk: the encrypted path is the one under
      // measurement, and no key outlives the process that used it.
      PII_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
      ALLOW_DEMO_MODE: "true",
      ENABLE_DEMO_LOGIN: "true",
      E2E_DISABLE_RATE_LIMIT: "true",
      NODE_ENV: "production",
      PORT: String(PORT),
      // Loopback, not 0.0.0.0. This server has demo credentials login and an open seed
      // endpoint; CI can bind wide because its runner is disposable and firewalled, a
      // developer machine on a shared network cannot.
      HOSTNAME: "127.0.0.1",
    },
  });

  const passes = [];
  if (wantMobile) passes.push({ dir: "audit-mobile", width: 390, height: 844 });
  if (wantDesktop) passes.push({ dir: "audit-desktop", width: 1440, height: 900 });

  try {
    await waitForCredentialsProvider(child, log);
    console.log(`[audit-env] up on ${BASE} against ${scratch.url}`);

    passes.forEach((pass, i) => {
      const argv = [
        "scripts/mobile-audit.mjs",
        // Seed once. It is idempotent, but it is also the slowest step in the run and
        // the second pass inherits the first pass's data unchanged.
        ...(i === 0 ? ["--seed"] : []),
        "--width",
        String(pass.width),
        "--height",
        String(pass.height),
        // Portuguese: the longest of the four catalogues, and label length — not label
        // count — is what actually breaks a nav or a tab bar.
        "--locale",
        "pt",
        ...(only ? ["--only", only] : []),
      ];
      console.log(
        `\n[audit-env] pass ${i + 1}/${passes.length}: ${pass.width}x${pass.height} → ${pass.dir}`,
      );
      const r = spawnSync("node", argv, {
        cwd: ROOT,
        stdio: "inherit",
        env: {
          ...process.env,
          AUDIT_OUT_DIR: pass.dir,
          AUDIT_BASE_URL: BASE,
          PLAYWRIGHT_CHROMIUM: chromium,
        },
      });
      if (r.status !== 0) throw new Error(`${pass.width}px pass failed`);
    });
  } finally {
    child.kill("SIGTERM");
    if (has("keep")) {
      console.log(`[audit-env] --keep: scratch database left at ${scratch.dir}`);
    } else {
      // Seeded records are synthetic, but they are shaped like tenant PII — names, IBANs,
      // NIFs, phone numbers. Nothing is gained by leaving them on disk after the run.
      rmSync(scratch.dir, { recursive: true, force: true });
    }
  }

  console.log(`\n[audit-env] done — reports in ${passes.map((p) => p.dir).join(", ")}`);
}

main().catch((err) => {
  console.error(`\n[audit-env] ${err.message}`);
  process.exit(1);
});
