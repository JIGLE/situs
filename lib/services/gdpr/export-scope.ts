/**
 * What a GDPR data export contains, derived from the schema rather than listed by hand.
 *
 * The export used to carry a hand-written `include` of eleven relations. The User model has
 * thirty-five, so twenty-four were missing — among them every bank relation, the rent-period
 * ledger, payment allocations, invoices, tax filings and government verifications. Articles 15
 * and 20 want all of a data subject's personal data, and bank transactions are the most
 * sensitive thing this app stores.
 *
 * The mechanism mattered more than the eleven. A hand-kept list has no way to notice a model
 * being added, so it drifts silently and the omission only shows up if someone reads an export
 * and misses something they knew to look for. So the list is read from Prisma's own model
 * metadata at call time: a relation added to `User` is exported the day it exists, and the only
 * way to leave something out is to name it below and say why.
 */

import { Prisma } from "@prisma/client";

/**
 * Relations deliberately excluded, each with the reason.
 *
 * This is not "data we would rather not hand over" — everything personal is in the export. It
 * is the credential material NextAuth stores against the user, which is not personal data about
 * them and would be actively dangerous in a file they download, mail to themselves, or hand to
 * another controller under Article 20.
 */
export const EXPORT_DENY_LIST: Record<string, string> = {
  // access_token / refresh_token / id_token for the linked OAuth provider. Live credentials:
  // anyone holding this file could act as the user against Google until the tokens expire.
  accounts: "NextAuth OAuth tokens — live credentials, not personal data about the subject",
  // Session tokens for currently-valid browser sessions. Same problem, shorter fuse.
  sessions: "NextAuth session tokens — live credentials, not personal data about the subject",
};

/** Every relation on `User`, from Prisma's model metadata. */
function userRelations(): string[] {
  const user = Prisma.dmmf.datamodel.models.find((m) => m.name === "User");
  if (!user) {
    throw new Error(
      "GDPR export: no User model in Prisma.dmmf — cannot determine what to export. " +
        "Refusing rather than exporting a partial file that looks complete.",
    );
  }
  return user.fields.filter((f) => f.kind === "object").map((f) => f.name);
}

/**
 * The `include` for the export query.
 *
 * Throws rather than returning something small if the metadata is missing. A partial export is
 * worse than a failed one: the user gets a file, believes it is their data, and the gap is
 * invisible — which is exactly how the previous eleven-relation version survived so long.
 */
export function buildExportInclude(): Record<string, true> {
  const relations = userRelations();

  // The repo's signature failure is the check that passes because it inspected nothing. If the
  // metadata yields no relations, something is wrong with the client, not with the schema.
  if (relations.length === 0) {
    throw new Error("GDPR export: User model reports no relations — refusing to export.");
  }

  const include: Record<string, true> = {};
  for (const name of relations) {
    if (name in EXPORT_DENY_LIST) continue;
    include[name] = true;
  }
  return include;
}

/** Relation names this export omits, for the manifest the export carries. */
export function excludedRelations(): string[] {
  return userRelations().filter((name) => name in EXPORT_DENY_LIST);
}
