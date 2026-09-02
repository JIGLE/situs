/**
 * The addresses the legal pages publish.
 *
 * These were hardcoded into the JSX, which is wrong for software other people self-host: the
 * privacy page told every operator's users to write to a mailbox belonging to someone else.
 * It also matters for a PSD2 application registration, where the data-protection address is a
 * required field and the provider will actually use it.
 *
 * Read on the server only — these are plain `process.env` reads in a server component, so no
 * `NEXT_PUBLIC_` prefix is needed and the values never reach the client bundle as config.
 */

/** Falls back to the project's own address so a default deployment still shows something real. */
export function dataProtectionEmail(): string {
  return process.env.DATA_PROTECTION_EMAIL?.trim() || "privacy@situs.app";
}

export function legalContactEmail(): string {
  return process.env.LEGAL_CONTACT_EMAIL?.trim() || dataProtectionEmail();
}
