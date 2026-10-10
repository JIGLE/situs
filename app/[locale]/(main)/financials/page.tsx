import { Suspense } from "react";
import { FinancialsContainer } from "@/components/features/financial/financials-container";
import { GenericPageSkeleton } from "@/components/ui/page-skeletons";
import { navigationTitle } from "@/lib/i18n/page-title";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return navigationTitle("finance", params);
}

export default function FinancialsPage() {
  return (
    <Suspense fallback={<GenericPageSkeleton />}>
      <FinancialsContainer />
    </Suspense>
  );
}
