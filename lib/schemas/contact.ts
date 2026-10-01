import { z } from "zod";

/**
 * An email that may be left out.
 *
 * Absent, `null` and `""` all mean none: a blank input sends `""`, and a record read back from the
 * API carries `null` for an empty column, so an edit form that loads a record as it is must still
 * validate. Anything else has to be an address. The service stores none as NULL
 * (`lib/utils/contact.ts`), never `""`.
 *
 * Optional because Finanças names a landlord or a tenant by NIF and name, and Situs reads them
 * from there before anyone has typed an address.
 */
export const optionalEmail = (invalid: string) =>
  z
    .string()
    .max(255, "Email too long")
    .nullish()
    .refine(
      (value) => !value?.trim() || z.string().email().safeParse(value.trim()).success,
      invalid,
    );
