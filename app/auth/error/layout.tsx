import { authTitle } from "@/lib/i18n/page-title";

/**
 * The error page is a client component (it reads the search params), which cannot export
 * metadata, so its title lives on this layout.
 */
export async function generateMetadata() {
  return authTitle("error");
}

export default function AuthErrorLayout({ children }: { children: React.ReactNode }) {
  return children;
}
