import { Suspense } from "react";
import { PeopleView } from "@/components/features/people/people-view";
import { PeopleListSkeleton } from "@/components/ui/page-skeletons";
import { navigationTitle } from "@/lib/i18n/page-title";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return navigationTitle("people", params);
}

export default function PeoplePage() {
  return (
    <Suspense fallback={<PeopleListSkeleton />}>
      <div className="h-full">
        <PeopleView />
      </div>
    </Suspense>
  );
}
