/**
 * Runs once when a server instance starts, and must finish before it answers any request.
 *
 * `lib/utils/env.ts` validates the environment when it is first imported and exits the process on
 * a production misconfiguration — above all a missing PII_ENCRYPTION_KEY, without which IBAN, NIF
 * and phone are written to disk in plaintext. Nothing used to import it at startup: only five
 * routes did, so a keyless server booted, answered /api/ready and served until the first request
 * to one of them. Importing it here makes it a startup check.
 *
 * The guards inside it still skip builds (`NEXT_BUILD=true`) and CI, exactly as before.
 */
export async function register(): Promise<void> {
  // Node.js only: env.ts reads mounted secret files through `fs`, which the edge runtime lacks.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./lib/utils/env");
  }
}
