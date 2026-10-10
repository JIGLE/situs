import { Suspense } from "react";
import { TenantDetailView } from "@/components/features/tenant/tenant-detail-view";
import { GenericPageSkeleton } from "@/components/ui/page-skeletons";
import { navigationTitle } from "@/lib/i18n/page-title";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return navigationTitle("people", params);
}

export default async function PersonDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { id } = await params;

  return (
    <Suspense fallback={<GenericPageSkeleton />}>
      <TenantDetailView tenantId={id} />
    </Suspense>
  );
}
