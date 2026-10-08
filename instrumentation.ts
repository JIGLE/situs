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
 *
 * It then converts any IBAN hash stored before hashes were keyed; a failure is logged and does not
 * stop the server (Admin › Status reports what is left).
 */
export async function register(): Promise<void> {
  // Node.js only: env.ts reads mounted secret files through `fs`, which the edge runtime lacks.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./lib/utils/env");

    // Stored IBAN hashes made before they were keyed are converted here, at every start: it is
    // idempotent, and it is what converts a backup restored from before (lib/utils/iban-hash.ts).
    // Never during a build, which has no database to convert.
    if (process.env.NEXT_BUILD !== "true") {
      const { runIbanHashMigrationAtStart } =
        await import("./lib/services/bank/iban-hash-migration");
      await runIbanHashMigrationAtStart();
    }
  }
}
