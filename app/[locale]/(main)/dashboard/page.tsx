import { Suspense } from "react";
import { OverviewView } from "@/components/features/dashboard/overview-view";
import { DashboardSkeleton } from "@/components/ui/page-skeletons";
import { navigationTitle } from "@/lib/i18n/page-title";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return navigationTitle("dashboard", params);
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <OverviewView />
    </Suspense>
  );
}
