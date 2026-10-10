import { Suspense } from "react";
import { PropertyDetailView } from "@/components/features/property/property-detail-view";
import { GenericPageSkeleton } from "@/components/ui/page-skeletons";
import { navigationTitle } from "@/lib/i18n/page-title";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return navigationTitle("portfolio", params);
}

export default async function PortfolioDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { id } = await params;

  return (
    <Suspense fallback={<GenericPageSkeleton />}>
      <PropertyDetailView propertyId={id} />
    </Suspense>
  );
}
