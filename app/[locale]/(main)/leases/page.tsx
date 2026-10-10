import { Suspense } from "react";
import { LeasesView } from "@/components/features/lease";
import { GenericPageSkeleton } from "@/components/ui/page-skeletons";
import { navigationTitle } from "@/lib/i18n/page-title";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return navigationTitle("leases", params);
}

export default function LeasesPage() {
  return (
    <Suspense fallback={<GenericPageSkeleton />}>
      <LeasesView />
    </Suspense>
  );
}
