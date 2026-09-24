import { Suspense } from "react";
import { GenericPageSkeleton } from "@/components/ui/page-skeletons";
import { Modelo179View } from "@/components/features/compliance/modelo179-view";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function Modelo179Page() {
  return (
    <Suspense fallback={<GenericPageSkeleton />}>
      <Modelo179View />
    </Suspense>
  );
}
