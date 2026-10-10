import { Suspense } from "react";

import { SystemStatusView } from "@/components/features/admin/system-status-view";
import { GenericPageSkeleton } from "@/components/ui/page-skeletons";
import { adminTitle } from "@/lib/i18n/page-title";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return adminTitle("status", params);
}

/**
 * Admin › System status, in full.
 *
 * The control center at `/admin` shows every check's name and severity, which answers "is anything
 * wrong?". This page is what answers "and what do I do about it?" — the detail and the remedy for
 * each one, which is the half that does not fit in a tile.
 */
export default function AdminStatusPage() {
  return (
    <Suspense fallback={<GenericPageSkeleton />}>
      <SystemStatusView />
    </Suspense>
  );
}
