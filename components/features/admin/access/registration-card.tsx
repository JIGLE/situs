"use client";

import { useTranslations } from "next-intl";

import { Panel } from "@/components/shared/panel";

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
    <Panel
      tone={copy.open ? "warning" : "default"}
      title={t(copy.title)}
      description={t(copy.help, { count: status.pendingInvitations })}
      padded
    >
      <p className="text-sm text-muted-foreground">
        {tAccess("summary", { total: status.totalAccounts, admins: status.adminAccounts })}
      </p>
    </Panel>
  );
}
