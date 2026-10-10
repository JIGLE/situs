import { Suspense } from "react";
import { AssetsView } from "@/components/features/assets/assets-view";
import { PropertiesListSkeleton } from "@/components/ui/page-skeletons";
import { navigationTitle } from "@/lib/i18n/page-title";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return navigationTitle("portfolio", params);
}

export default function PortfolioPage() {
  return (
    <Suspense fallback={<PropertiesListSkeleton />}>
      <div className="h-full">
        <AssetsView />
      </div>
    </Suspense>
  );
}
