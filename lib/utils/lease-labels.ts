import type { LeaseFormData } from "@/lib/schemas/lease.schema";

type TaxRegime = NonNullable<LeaseFormData["taxRegime"]>;

/**
 * Catalogue key for a lease's stored tax regime, under the `leases` namespace.
 *
 * The lease wizard and the leases filter each named the two regimes by hand, while the lease
 * detail printed the stored value itself ("portugal_rendimentos") and the leases export wrote it
 * into the file. One map, typed by the lease schema's enum, so a new regime is a compile error here
 * rather than a word that renders as itself.
 */
export const TAX_REGIME_KEY: Record<TaxRegime, "taxRegimePt" | "taxRegimeEs"> = {
  portugal_rendimentos: "taxRegimePt",
  spain_inmuebles: "taxRegimeEs",
};

/** The key for a stored regime, or undefined for a value no current regime matches. */
export function taxRegimeKey(regime: string | null | undefined) {
  return regime && Object.hasOwn(TAX_REGIME_KEY, regime)
    ? TAX_REGIME_KEY[regime as TaxRegime]
    : undefined;
}
