// From ./modes, not ./mode-guard: this file is imported by "use client" components, and
// mode-guard reaches Prisma and better-sqlite3 through connector-service.
import { SIMULATED_MODES, TEST_MODES } from "./modes";

/**
 * Presentation facts about connectors, shared by the two UIs that show them
 * (Finance › Tax Summary and Settings › Integrations) so they cannot drift apart.
 *
 * This exists because both surfaces used to render the raw `mode` string — "review",
 * "sandbox" — as a coloured badge and nothing else. To a landlord that does not read as
 * "nothing was sent to the tax authority; this was simulated". It is the UI half of the D1
 * finding: the connector no longer fabricates an acceptance, but the screen still has to say
 * that no filing left the building.
 *
 * Worse, `live` was styled as SUCCESS — green, the colour of "working" — when it is precisely
 * the mode that now refuses to act. Colour was telling the opposite of the truth.
 */

/** The body a connector files with, for display. Keys are ISO country codes. */
export const AUTHORITY_BY_COUNTRY: Record<string, string> = {
  PT: "Autoridade Tributária",
};

export function authorityName(country: string): string {
  return AUTHORITY_BY_COUNTRY[country.toUpperCase()] ?? country;
}

/**
 * How a mode should be presented.
 *
 * - `simulated`  — the connector will act, but nothing is transmitted. Informational.
 * - `test` — real requests to the authority's test service; nothing filed there counts. Shown
 *   apart from `simulated` because something does leave the instance.
 * - `unsupported` — the connector refuses and logs. An error state the user must be able to
 *   see, because the symptom is silence: nothing gets submitted and without this they would
 *   have no idea why.
 *
 * Derived from the guard's own sets rather than a second hardcoded list, so widening the guard
 * for a real integration updates the UI in the same move.
 */
export type ModeKind = "simulated" | "test" | "unsupported";

export function modeKind(mode: string): ModeKind {
  if (SIMULATED_MODES.has(mode)) return "simulated";
  if (TEST_MODES.has(mode)) return "test";
  return "unsupported";
}

/** Tailwind-ish token classes per mode kind. No green: nothing here is a live connection. */
export const MODE_KIND_STYLES: Record<ModeKind, string> = {
  simulated: "bg-[var(--semantic-info-soft)] text-[var(--semantic-info-readable)]",
  test: "bg-[var(--semantic-warning-soft)] text-[var(--semantic-warning-readable)]",
  unsupported: "bg-[var(--semantic-danger-soft)] text-[var(--semantic-danger-readable)]",
};
