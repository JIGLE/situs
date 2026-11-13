// @vitest-environment node
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

/**
 * prestart must reach the database step in the environment the image runs in.
 *
 * Each step used to be `require`d into prestart, and check-hostport ends in `process.exit(0)`
 * whenever it passes. The image always sets HOSTNAME and PORT, so it always passed, and prestart
 * ended there: the database was never created or updated on start, and every update needed a
 * manual `npx prisma db push`. `prestart-db-failure.test.ts` ran ensure-sqlite on its own, so it
 * never saw that.
 *
 * The probe is a database path that cannot be created: only ensure-sqlite says "1001:1001".
 */

const SCRIPT = join(process.cwd(), "scripts", "prestart.js");

function runPrestart(env: Record<string, string>) {
  return spawnSync(process.execPath, [SCRIPT], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: `file:${join("/etc/hostname", "situs.sqlite")}`,
      NEXTAUTH_URL: "http://localhost:3000",
      NEXTAUTH_SECRET: "a".repeat(40),
      PII_ENCRYPTION_KEY: "e".repeat(64),
      ...env,
    },
    encoding: "utf8",
  });
}

describe("prestart, as the image runs it", () => {
  it("reaches the database step when HOSTNAME and PORT are set", () => {
    const result = runPrestart({ HOSTNAME: "0.0.0.0", PORT: "3000" });

    expect(`${result.stdout}${result.stderr}`).toContain("1001:1001");
    expect(result.status).toBe(1);
  });

  it("reaches the database step when they are not", () => {
    const result = runPrestart({ HOSTNAME: "", PORT: "" });

    expect(`${result.stdout}${result.stderr}`).toContain("1001:1001");
    expect(result.status).toBe(1);
  });
});
