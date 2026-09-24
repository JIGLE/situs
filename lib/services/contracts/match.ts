import { normalizeTaxId } from "@/lib/schemas/tax-identity";
import type { ContractExtraction } from "./schema";

/**
 * Which of the owner's records a contract's reading refers to: its property, each landlord and
 * each tenant, or none, in which case the review sheet offers to create them. Pure: the extract
 * route loads the candidates, already scoped to the owner and decrypted.
 *
 * Each match says what it matched on, so the sheet can show why: a matriz article and fraction
 * identify a property, a NIF identifies a person; an address or an email only suggests one.
 */

export interface MatchCandidates {
  properties: ReadonlyArray<{
    id: string;
    address: string;
    cadasterReference: string | null;
    fraction: string | null;
  }>;
  owners: ReadonlyArray<{ id: string; email: string; taxIdentificationNumber: string | null }>;
  tenants: ReadonlyArray<{
    id: string;
    email: string;
    taxId: string | null;
    taxCountry: string | null;
  }>;
}

export interface Match<By extends string> {
  id: string;
  by: By;
}

export interface ContractMatches {
  property: Match<"matrix" | "address"> | null;
  /** Index for index with the reading's landlords. */
  landlords: Array<Match<"nif" | "email"> | null>;
  /** Index for index with the reading's tenants. */
  tenants: Array<Match<"nif" | "email"> | null>;
}

/** Lower case, no accents, no punctuation: "3.º Esq." and "3º esq" read the same. */
function words(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

const same = (a: string | null | undefined, b: string | null | undefined) =>
  words(a ?? "").join(" ") === words(b ?? "").join(" ");

/** Every word of the reading's address is a whole word of the record's: "12" is not "1". */
function addressMatches(read: string, recorded: string): boolean {
  const readWords = words(read);
  const recordedWords = new Set(words(recorded));
  return readWords.length > 0 && readWords.every((word) => recordedWords.has(word));
}

function nif(taxId: string | null | undefined, country: string | null | undefined) {
  return normalizeTaxId(taxId, country) || null;
}

function person<By extends "nif" | "email">(
  read: { taxId: string | null; taxCountry: string | null; email?: string | null },
  records: ReadonlyArray<{
    id: string;
    email: string;
    taxId: string | null;
    taxCountry: string | null;
  }>,
): Match<By> | null {
  const readNif = nif(read.taxId, read.taxCountry);
  const byNif = readNif && records.find((r) => nif(r.taxId, r.taxCountry) === readNif);
  if (byNif) return { id: byNif.id, by: "nif" as By };

  const readEmail = read.email?.trim().toLowerCase();
  const byEmail = readEmail && records.find((r) => r.email.trim().toLowerCase() === readEmail);
  return byEmail ? { id: byEmail.id, by: "email" as By } : null;
}

export function matchContract(
  reading: ContractExtraction,
  candidates: MatchCandidates,
): ContractMatches {
  const { property } = reading;

  const byMatrix =
    property.matrixArticle &&
    candidates.properties.find(
      (p) =>
        same(p.cadasterReference, property.matrixArticle) && same(p.fraction, property.fraction),
    );
  const byAddress =
    !byMatrix &&
    property.address &&
    candidates.properties.find(
      (p) =>
        addressMatches(property.address!, p.address) &&
        // A recorded fraction that differs is another flat in the same building.
        (!p.fraction || !property.fraction || same(p.fraction, property.fraction)),
    );

  const owners = candidates.owners.map((o) => ({
    id: o.id,
    email: o.email,
    taxId: o.taxIdentificationNumber,
    // An owner's NIF has no country column; a Portuguese one is what AT's receipts carry.
    taxCountry: "PT",
  }));

  return {
    property: byMatrix
      ? { id: byMatrix.id, by: "matrix" }
      : byAddress
        ? { id: byAddress.id, by: "address" }
        : null,
    landlords: reading.landlords.map((landlord) => person(landlord, owners)),
    tenants: reading.tenants.map((tenant) => person(tenant, candidates.tenants)),
  };
}
