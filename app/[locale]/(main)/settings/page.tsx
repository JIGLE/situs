import { Suspense } from "react";
import { SettingsView } from "@/components/features/settings/settings-view";
import { GenericPageSkeleton } from "@/components/ui/page-skeletons";
import { navigationTitle } from "@/lib/i18n/page-title";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return navigationTitle("settings", params);
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<GenericPageSkeleton />}>
      <div className="h-full">
        <SettingsView />
      </div>
    </Suspense>
  );
}
