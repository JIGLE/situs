import { z } from "zod";
import { checkTaxId, taxIdentityFields } from "@/lib/schemas/tax-identity";
import { leasePartySchema } from "@/lib/schemas/lease.schema";
import { datesInOrder, sharesTotalHundred } from "./review";

/**
 * A lease contract, read: what Claude returns, what the review sheet shows, and what the owner
 * confirms.
 *
 * `contractExtractionSchema` is the structured-output format of the Claude call
 * (claude-extractor.ts), so its descriptions are part of the instructions the model reads. The API
 * holds the model to the types, the required fields and the date format; everything else here
 * (bounds, enums, patterns) reaches the model only as a description, and is enforced when the
 * answer is parsed. A value the documents do not state is null rather than absent: "not in the
 * contract" is an answer, and the API wants every property present.
 *
 * `contractImportSchema` is what the owner sends back after reviewing it. It is the only one the
 * import trusts.
 */

export const CLAUSE_KINDS = ["renewal", "rent_update", "termination", "deposit"] as const;
export type ClauseKind = (typeof CLAUSE_KINDS)[number];

const isoDate = z.iso.date();

const source = z
  .object({
    quote: z.string().describe("The documents' own words for this, verbatim, in their language."),
    page: z.number().int().min(1).describe("The PDF page the quote is on, counting from 1."),
  })
  .nullable()
  .describe("Where the documents say this. Null when they do not.");

/** A value, and where it was read. The value is null when the documents do not state it. */
function sourced<T extends z.ZodType>(value: T, description: string) {
  return z.object({ value: value.nullable(), source }).describe(description);
}

const taxId = z
  .string()
  .nullable()
  .describe("The NIF, or a foreign tax number, exactly as written. Null when none is given.");
const taxCountry = z
  .string()
  .nullable()
  .describe(
    "ISO 3166-1 alpha-2 code of the country that issued the tax number: PT for a Portuguese NIF.",
  );
const idDocument = z
  .string()
  .nullable()
  .describe("The identity document's number (Cartão de Cidadão, passport…), when given.");

const landlord = z.object({
  name: z.string().describe("Full name, or company name, as written."),
  taxId,
  taxCountry,
  email: z.string().nullable(),
  share: z
    .number()
    .nullable()
    .describe("Percentage of the property this landlord owns, only when the documents state it."),
  source,
});

const tenant = z.object({
  name: z.string().describe("Full name as written."),
  taxId,
  taxCountry,
  idDocument,
  email: z.string().nullable(),
  phone: z.string().nullable(),
  source,
});

const guarantor = z.object({
  name: z.string().describe("Full name as written."),
  taxId,
  taxCountry,
  idDocument,
  source,
});

export const contractExtractionSchema = z.object({
  landlords: z
    .array(landlord)
    .describe(
      "Every landlord (senhorio / primeiro outorgante), in the order the contract names them.",
    ),
  tenants: z
    .array(tenant)
    .describe(
      "Every tenant (arrendatário / segundo outorgante), the main one first: the one who pays.",
    ),
  guarantors: z.array(guarantor).describe("Every guarantor (fiador). Empty when there are none."),
  property: z.object({
    address: z.string().nullable().describe("Street, number and floor, as written."),
    postalCode: z.string().nullable().describe("Portuguese postal code, NNNN-NNN."),
    city: z.string().nullable(),
    matrixArticle: z
      .string()
      .nullable()
      .describe("The artigo matricial: the number only, without the parish."),
    fraction: z
      .string()
      .nullable()
      .describe("The fração autónoma, e.g. A or 1.º Esq. Null for a building without fractions."),
    typology: z.string().nullable().describe("The tipologia, e.g. T2."),
    source,
  }),
  terms: z.object({
    startDate: sourced(isoDate, "The day the lease starts."),
    endDate: sourced(isoDate, "The day the lease's first term ends."),
    monthlyRent: sourced(z.number().positive(), "The monthly rent, in euros."),
    deposit: sourced(z.number().min(0), "The deposit (caução), in euros. 0 when there is none."),
    autoRenew: sourced(z.boolean(), "Whether the lease renews itself at the end of a term."),
    renewalNoticeDays: sourced(
      z.number().int().min(0),
      "Days of notice the landlord must give to stop a renewal.",
    ),
  }),
  registration: z
    .object({
      contractNumber: z
        .string()
        .regex(/^\d{1,20}$/)
        .nullable()
        .describe("AT's number for the contract: digits only."),
      version: z.number().int().min(1).nullable().describe("The contract's version at AT."),
      source,
    })
    .nullable()
    .describe(
      "From AT's proof of registration (comprovativo de registo), when one was sent. Null otherwise.",
    ),
  clauses: z
    .array(
      z.object({
        kind: z.enum(CLAUSE_KINDS),
        summary: z
          .string()
          .describe("What the clause means in practice, in one or two plain sentences."),
        quote: z.string().describe("The clause's own words, verbatim."),
        page: z.number().int().min(1).nullable(),
      }),
    )
    .describe(
      "The clauses on renewal, rent updates, termination and notice, and the deposit: one entry each.",
    ),
});

export type ContractExtraction = z.infer<typeof contractExtractionSchema>;

// --- What the owner confirms -----------------------------------------------------------------

const id = z.string().min(1).max(100);
const name = z.string().trim().min(1).max(200);
const email = z.email().max(200);
const share = z.number().gt(0).max(100);

const newLandlord = z
  .object({
    mode: z.literal("new"),
    name,
    email,
    taxId: taxIdentityFields.taxId,
    taxCountry: taxIdentityFields.taxCountry,
    share,
  })
  .superRefine((landlord, ctx) => checkTaxId(landlord, ctx));

const newTenant = z
  .object({
    mode: z.literal("new"),
    name,
    email,
    phone: z.string().trim().max(40).nullish(),
    ...taxIdentityFields,
  })
  .superRefine((tenant, ctx) => checkTaxId(tenant, ctx));

export const contractImportSchema = z
  .object({
    property: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("existing"), id }),
      z.object({
        mode: z.literal("new"),
        name,
        address: z.string().trim().min(1).max(300),
        zipCode: z.string().trim().max(20).nullish(),
        city: z.string().trim().max(100).nullish(),
        cadasterReference: z.string().trim().max(50).nullish(),
        fraction: z.string().trim().max(20).nullish(),
        type: z.enum(["apartment", "house", "condo", "townhouse", "commercial", "other"]),
        bedrooms: z.number().int().min(0).max(50),
        bathrooms: z.number().int().min(0).max(50),
      }),
    ]),
    // Written only where the property has no owners yet: an owned property's shares stay as they
    // are recorded.
    landlords: z
      .array(
        z.discriminatedUnion("mode", [
          z.object({ mode: z.literal("existing"), id, share }),
          newLandlord,
        ]),
      )
      .max(10),
    tenant: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("existing"), id }),
      newTenant,
    ]),
    parties: z.array(leasePartySchema).max(10),
    lease: z.object({
      startDate: isoDate,
      endDate: isoDate,
      monthlyRent: z.number().positive().max(1_000_000),
      deposit: z.number().min(0).max(1_000_000),
      autoRenew: z.boolean(),
      renewalNoticeDays: z.number().int().min(0).max(3650),
      atContractNumber: z
        .string()
        .regex(/^\d{1,20}$/)
        .nullish(),
      atContractVersion: z.number().int().min(1).max(999).nullish(),
    }),
    clauses: z
      .array(
        z.object({
          kind: z.enum(CLAUSE_KINDS),
          summary: z.string().trim().min(1).max(2000),
          quote: z.string().trim().min(1).max(5000),
          page: z.number().int().min(1).max(1000).nullish(),
        }),
      )
      .max(20),
  })
  .superRefine((data, ctx) => {
    if (!datesInOrder(data.lease.startDate, data.lease.endDate)) {
      ctx.addIssue({
        code: "custom",
        path: ["lease", "endDate"],
        message: "End date before start",
      });
    }
    if (data.landlords.length > 0 && !sharesTotalHundred(data.landlords)) {
      ctx.addIssue({ code: "custom", path: ["landlords"], message: "Shares must total 100%" });
    }
  });

export type ContractImport = z.infer<typeof contractImportSchema>;
