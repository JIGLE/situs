/**
 * The only modes a connector may act in — and nothing else.
 *
 * WHY THIS FILE HAS NO IMPORTS, AND MUST KEEP NONE.
 *
 * This set is needed in two places that cannot share a module graph: the server-side guard
 * (`mode-guard.ts`, which writes a TaxSubmissionLog row and therefore reaches Prisma) and the
 * client-side presentation helper (`presentation.ts`, imported by two "use client" components).
 *
 * It originally lived in `mode-guard.ts` and `presentation.ts` imported it from there. That was
 * a deliberate choice — one list, so widening it for a real integration updates the UI in the
 * same move — but it built a chain from a browser bundle to a native binary:
 *
 *   settings-integrations.tsx  (use client)
 *     → presentation.ts
 *       → mode-guard.ts
 *         → connector-service.ts
 *           → database.ts → @prisma/adapter-better-sqlite3 → better-sqlite3 → bindings (.node)
 *
 * `next build` failed on it; `tsc --noEmit`, ESLint and Vitest all passed, because none of them
 * bundle for the browser. Splitting the constant out keeps the single source of truth and cuts
 * the chain at its first link.
 *
 * So: no imports here, ever. Adding one re-creates the bug the moment it reaches a server-only
 * module.
 */

/**
 * Modes in which filing is simulated: nothing is transmitted. Every mode outside these and
 * `TEST_MODES` fails closed — see `mode-guard.ts` for the refusal, and `presentation.ts` for how
 * each kind of mode is shown to the operator.
 */
export const SIMULATED_MODES: ReadonlySet<string> = new Set(["sandbox", "review"]);

/**
 * Modes in which a connector talks to the authority's test service: real requests, and nothing
 * filed there counts. The connector row names the authority, so the mode stays country-neutral.
 * Production is not among them: going live is a code change, not a row edit.
 */
export const TEST_MODES: ReadonlySet<string> = new Set(["test"]);
