"use client";

import { useTranslations } from "next-intl";

import type { SignInStatus } from "@/lib/services/admin/sign-in-status";
import { REGISTRATION_COPY } from "@/lib/utils/access-labels";

/**
 * Whether a person who has no account can make one, in a sentence, and how many accounts there are.
 *
 * The state is derived from the account count, the two switches and the invitations still live
 * (`getSignInStatus`), so it cannot say "closed" while Google sign-up is on. A state that lets a
 * person nobody named in is tinted as a warning.
 */
export function RegistrationCard({ status }: { status: SignInStatus }) {
  const t = useTranslations("admin.signIn");
  const tAccess = useTranslations("admin.access");
  const copy = REGISTRATION_COPY[status.registration];

  return (
    <section
      className={
        copy.open
          ? "rounded-md border-l-2 border-[var(--semantic-warning-readable)] bg-[var(--semantic-warning-soft)] px-3 py-3"
          : "rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-3"
      }
    >
      <p className="text-sm font-medium text-[var(--color-foreground)]">{t(copy.title)}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {t(copy.help, { count: status.pendingInvitations })}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        {tAccess("summary", { total: status.totalAccounts, admins: status.adminAccounts })}
      </p>
    </section>
  );
}
