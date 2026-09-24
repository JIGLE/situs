import type { ContractExtraction, ContractImport } from "./schema";
import type { ContractMatches } from "./match";
import { datesInOrder, nifInvalid, sharesTotal, sharesTotalHundred } from "./review";

/**
 * The review sheet's form: a contract's reading, as fields the owner edits before Confirm.
 *
 * Strings where the form has inputs, so a half-typed number is still what the owner typed. Each
 * person and the property carry the record they are linked to, or `NEW`. Pure, so the three
 * steps the sheet takes (reading to draft, draft to problems, draft to import) are tested
 * without rendering it.
 */

export const NEW = "new";

type PropertyType = Extract<ContractImport["property"], { mode: "new" }>["type"];

export interface PersonDraft {
  /** The linked record's id, or NEW. */
  recordId: string;
  name: string;
  email: string;
  taxId: string;
  taxCountry: string;
}

export interface LandlordDraft extends PersonDraft {
  share: string;
}

export interface TenantDraft extends PersonDraft {
  phone: string;
  idDocument: string;
}

export interface PartyDraft {
  role: "tenant" | "guarantor";
  name: string;
  taxId: string;
  taxCountry: string;
  idDocument: string;
}

export interface ContractDraft {
  property: {
    recordId: string;
    name: string;
    address: string;
    zipCode: string;
    city: string;
    cadasterReference: string;
    fraction: string;
    type: PropertyType;
    bedrooms: string;
    bathrooms: string;
  };
  landlords: LandlordDraft[];
  tenant: TenantDraft;
  parties: PartyDraft[];
  terms: {
    startDate: string;
    endDate: string;
    monthlyRent: string;
    deposit: string;
    autoRenew: boolean;
    renewalNoticeDays: string;
    atContractNumber: string;
    atContractVersion: string;
  };
  clauses: ContractExtraction["clauses"];
}

const text = (value: string | number | null | undefined) =>
  value === null || value === undefined ? "" : String(value);

export function draftFromReading(
  reading: ContractExtraction,
  matches: ContractMatches,
): ContractDraft {
  const [main, ...coTenants] = reading.tenants;
  const { property, terms } = reading;
  const bedrooms = /^T(\d+)/i.exec(property.typology ?? "")?.[1];

  return {
    property: {
      recordId: matches.property?.id ?? NEW,
      name: text(property.address),
      address: [property.address, [property.postalCode, property.city].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", "),
      zipCode: text(property.postalCode),
      city: text(property.city),
      cadasterReference: text(property.matrixArticle),
      fraction: text(property.fraction),
      type: "apartment",
      bedrooms: bedrooms ?? "",
      bathrooms: "1",
    },
    landlords: reading.landlords.map((landlord, i) => ({
      recordId: matches.landlords[i]?.id ?? NEW,
      name: landlord.name,
      email: text(landlord.email),
      taxId: text(landlord.taxId),
      taxCountry: landlord.taxCountry || "PT",
      // A sole landlord's share is the whole; co-owners' shares are theirs to state.
      share: text(landlord.share ?? (reading.landlords.length === 1 ? 100 : null)),
    })),
    tenant: {
      recordId: matches.tenants[0]?.id ?? NEW,
      name: text(main?.name),
      email: text(main?.email),
      phone: text(main?.phone),
      taxId: text(main?.taxId),
      taxCountry: main?.taxCountry || "PT",
      idDocument: text(main?.idDocument),
    },
    parties: [
      ...coTenants.map((person) => ({ role: "tenant" as const, ...partyOf(person) })),
      ...reading.guarantors.map((person) => ({ role: "guarantor" as const, ...partyOf(person) })),
    ],
    terms: {
      startDate: text(terms.startDate.value),
      endDate: text(terms.endDate.value),
      monthlyRent: text(terms.monthlyRent.value),
      deposit: text(terms.deposit.value ?? 0),
      autoRenew: terms.autoRenew.value ?? false,
      renewalNoticeDays: text(terms.renewalNoticeDays.value ?? 60),
      atContractNumber: text(reading.registration?.contractNumber),
      atContractVersion: text(reading.registration?.version),
    },
    clauses: reading.clauses,
  };
}

function partyOf(person: {
  name: string;
  taxId: string | null;
  taxCountry: string | null;
  idDocument: string | null;
}) {
  return {
    name: person.name,
    taxId: text(person.taxId),
    taxCountry: person.taxCountry || "PT",
    idDocument: text(person.idDocument),
  };
}

/** Why Confirm is disabled, each one said on the sheet in the owner's language. */
export type DraftProblem =
  | { kind: "property" }
  | { kind: "tenant" }
  | { kind: "rent" }
  | { kind: "dates" }
  | { kind: "shares"; total: number }
  | { kind: "email"; name: string }
  | { kind: "nif"; name: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function draftProblems(draft: ContractDraft): DraftProblem[] {
  const problems: DraftProblem[] = [];
  const { property, tenant, terms } = draft;

  if (property.recordId === NEW && (!property.name.trim() || !property.address.trim())) {
    problems.push({ kind: "property" });
  }
  if (tenant.recordId === NEW && !tenant.name.trim()) problems.push({ kind: "tenant" });
  if (!(Number(terms.monthlyRent) > 0)) problems.push({ kind: "rent" });
  if (!datesInOrder(terms.startDate, terms.endDate)) problems.push({ kind: "dates" });

  const shares = draft.landlords.map((l) => ({ share: Number(l.share) || 0 }));
  if (draft.landlords.length > 0 && !sharesTotalHundred(shares)) {
    problems.push({ kind: "shares", total: Math.round(sharesTotal(shares) * 100) / 100 });
  }

  // Situs keys people by email: a new tenant or owner cannot be created without one.
  const newPeople = [
    ...(tenant.recordId === NEW ? [tenant] : []),
    ...draft.landlords.filter((l) => l.recordId === NEW),
  ];
  for (const person of newPeople) {
    if (!EMAIL.test(person.email.trim())) problems.push({ kind: "email", name: person.name });
    if (nifInvalid(person.taxId, person.taxCountry))
      problems.push({ kind: "nif", name: person.name });
  }
  for (const party of draft.parties) {
    if (nifInvalid(party.taxId, party.taxCountry)) problems.push({ kind: "nif", name: party.name });
  }

  return problems;
}

const blank = (value: string) => value.trim() || null;

/** The review as the import route takes it. Only meaningful when draftProblems is empty. */
export function draftToImport(draft: ContractDraft): ContractImport {
  const { property, tenant, terms } = draft;
  return {
    property:
      property.recordId === NEW
        ? {
            mode: "new",
            name: property.name.trim(),
            address: property.address.trim(),
            zipCode: blank(property.zipCode),
            city: blank(property.city),
            cadasterReference: blank(property.cadasterReference),
            fraction: blank(property.fraction),
            type: property.type,
            bedrooms: Number(property.bedrooms) || 0,
            bathrooms: Number(property.bathrooms) || 0,
          }
        : { mode: "existing", id: property.recordId },
    landlords: draft.landlords.map((landlord) =>
      landlord.recordId === NEW
        ? {
            mode: "new" as const,
            name: landlord.name.trim(),
            email: landlord.email.trim(),
            taxId: blank(landlord.taxId),
            taxCountry: landlord.taxCountry || "PT",
            share: Number(landlord.share),
          }
        : { mode: "existing" as const, id: landlord.recordId, share: Number(landlord.share) },
    ),
    tenant:
      tenant.recordId === NEW
        ? {
            mode: "new",
            name: tenant.name.trim(),
            email: tenant.email.trim(),
            phone: blank(tenant.phone),
            taxId: blank(tenant.taxId),
            taxCountry: tenant.taxCountry || "PT",
            idDocument: blank(tenant.idDocument),
          }
        : { mode: "existing", id: tenant.recordId },
    parties: draft.parties.map((party) => ({
      role: party.role,
      name: party.name.trim(),
      taxId: blank(party.taxId),
      taxCountry: party.taxCountry || "PT",
      idDocument: blank(party.idDocument),
    })),
    lease: {
      startDate: terms.startDate,
      endDate: terms.endDate,
      monthlyRent: Number(terms.monthlyRent),
      deposit: Number(terms.deposit) || 0,
      autoRenew: terms.autoRenew,
      renewalNoticeDays: Number(terms.renewalNoticeDays) || 0,
      atContractNumber: blank(terms.atContractNumber),
      atContractVersion: terms.atContractVersion.trim() ? Number(terms.atContractVersion) : null,
    },
    clauses: draft.clauses.map(({ kind, summary, quote, page }) => ({
      kind,
      summary,
      quote,
      page,
    })),
  };
}
