import { CompleteView } from "@/components/features/completion/complete-view";
import { navigationTitle } from "@/lib/i18n/page-title";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return navigationTitle("complete", params);
}

/** What a receipt still needs from the owner, one field at a time. Opened from the dashboard. */
export default function CompletePage() {
  return <CompleteView />;
}
