import { redirect } from "next/navigation";

/**
 * A tenant has one screen: the detail that opens over People (`?detail=tenant:<id>`,
 * `tenant-detail-modal.tsx`). This address had a second, full-page view of its own with fewer
 * tabs and actions; it now opens the same one.
 */
export default async function PersonDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { id } = await params;
  redirect(`/people?detail=tenant:${encodeURIComponent(id)}`);
}
