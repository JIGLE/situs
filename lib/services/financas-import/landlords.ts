/**
 * Who owns a property, as a Finanças document says: the titulares of a caderneta or the locadores
 * of a contract proof, turned into Situs owners and shares. Pure: it plans, the screen applies the
 * plan through `/api/owners` and `/api/property-owners` once the owner has seen it.
 *
 * Landlords belong to the property in Situs (dated `PropertyOwner` shares, which an AT receipt
 * names), not to the lease, so a contract's landlords are applied to its property.
 */
import { validatePortugueseNIF } from "@/lib/utils/tax-id-validation";
import { titleCase } from "./text";

export interface DocumentPerson {
  taxId: string;
  name: string;
  /** As printed: "1/2". */
  share: string | null;
  /** A caderneta's "Tipo de titular"; a contract proof does not say. */
  kind?: "full" | "usufruct" | "bare" | null;
}

export interface KnownOwner {
  id: string;
  name: string;
  taxIdentificationNumber?: string | null;
}

export interface PlannedShare {
  /** The owner already in Situs with this NIF, when there is one. */
  ownerId: string | null;
  /** Their name: the stored one for an existing owner, else as the document gives it. */
  name: string;
  /** The NIF to store on a new owner; null when the document's fails its check digit. */
  taxId: string | null;
  /** Percent, 0–100. */
  percentage: number;
}

const digits = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "");

/** "1/2" as a fraction of the whole, or null when unreadable or not in (0, 1]. */
function fraction(share: string | null): number | null {
  const m = /^(\d+)\/(\d+)$/.exec((share ?? "").replace(/\s/g, ""));
  if (!m) return null;
  const value = Number(m[1]) / Number(m[2]);
  return value > 0 && value <= 1 ? value : null;
}

/**
 * The shares to set. While a usufruct lasts the usufructuary receives the rent, so the bare owners
 * are left out. Someone listed twice has their parts added. When a part is missing or the parts do
 * not make a whole, the people share equally: the screen shows the result before it is saved.
 */
export function planShares(people: DocumentPerson[], owners: KnownOwner[]): PlannedShare[] {
  const usufruct = people.some((p) => p.kind === "usufruct");
  const eligible = people.filter((p) => (usufruct ? p.kind === "usufruct" : p.kind !== "bare"));

  const merged = new Map<string, { person: DocumentPerson; parts: (number | null)[] }>();
  for (const person of eligible) {
    const key = digits(person.taxId) || person.name;
    const entry = merged.get(key) ?? { person, parts: [] };
    entry.parts.push(fraction(person.share));
    merged.set(key, entry);
  }
  const entries = [...merged.values()];
  if (entries.length === 0) return [];

  const parts = entries.map((e) =>
    e.parts.some((p) => p === null) ? null : e.parts.reduce<number>((a, b) => a + (b ?? 0), 0),
  );
  const total = parts.reduce<number>((sum, p) => sum + (p ?? 0), 0);
  const whole = parts.every((p) => p !== null) && Math.abs(total - 1) < 0.001;

  return entries.map(({ person }, i) => {
    const nif = digits(person.taxId);
    const existing = nif
      ? owners.find((o) => digits(o.taxIdentificationNumber) === nif)
      : undefined;
    return {
      ownerId: existing?.id ?? null,
      name: existing?.name ?? titleCase(person.name),
      taxId: nif && validatePortugueseNIF(nif) ? nif : null,
      percentage: whole ? (parts[i] as number) * 100 : 100 / entries.length,
    };
  });
}

/** "José Exemplo 50% · Ana Exemplo 50%", for the screens that show the plan. */
export function describeShares(shares: PlannedShare[], locale: string): string {
  const pct = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  return shares.map((s) => `${s.name} ${pct.format(s.percentage)}%`).join(" · ");
}
