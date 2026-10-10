import { Suspense } from "react";
import { LeaseDetailView } from "@/components/features/lease/lease-detail-view";
import { GenericPageSkeleton } from "@/components/ui/page-skeletons";
import { navigationTitle } from "@/lib/i18n/page-title";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return navigationTitle("leases", params);
}

export default async function LeaseDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { id } = await params;

  return (
    <Suspense fallback={<GenericPageSkeleton />}>
      <LeaseDetailView leaseId={id} />
    </Suspense>
  );
}
