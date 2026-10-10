import { Suspense } from "react";

import { AdminAccessView } from "@/components/features/admin/access/admin-access-view";
import { GenericPageSkeleton } from "@/components/ui/page-skeletons";
import { adminTitle } from "@/lib/i18n/page-title";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return adminTitle("access", params);
}

/**
 * Admin › Acessos: who may create an account, who has one and what each may do. The switches, the
 * invitations and the roles change something; the sign-in methods and the allowlist only report.
 */
export default function AdminAccessPage() {
  return (
    <Suspense fallback={<GenericPageSkeleton />}>
      <AdminAccessView />
    </Suspense>
  );
}
