import { NextResponse } from "next/server";

/**
 * What is actually running.
 *
 * `buildTime` used to fall back to `new Date().toISOString()` — the time of the REQUEST, formatted
 * exactly like a build timestamp. It was used to check whether a deploy had landed and answered
 * with a fresh, plausible, wrong value every time. A confident wrong answer is worse than none,
 * because nobody re-checks a number that looks right.
 *
 * All three now report "unknown" when the build did not supply them, which is the honest state for
 * a locally built image (`docker build` without `--build-arg`). The workflow passes all three; see
 * the runner stage of the Dockerfile for the ENV lines that carry them into the process.
 *
 * `public/version.json` carries the version alone, as a static file. This line used to say it
 * carried all three "written at build time" — and nothing wrote it, at build time or ever. It sat
 * at 1.3.0 against a shipped 1.24.0 while three surfaces showed the number to the user, because a
 * comment asserting a mechanism that does not exist tells the next reader not to check. `prebuild`
 * writes it now and `npm run hygiene` fails when the committed copy disagrees
 * (`scripts/check-version-sync.js`).
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    version: process.env.BUILD_VERSION || "unknown",
    gitCommit: process.env.GIT_COMMIT || "unknown",
    buildTime: process.env.BUILD_TIME || "unknown",
  });
}
