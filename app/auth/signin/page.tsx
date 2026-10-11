import { renderAuthPage, type AuthSearchParams } from "../render-auth";
import { authTitle } from "@/lib/i18n/page-title";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return authTitle("signin");
}

export default async function SignIn({ searchParams }: { searchParams: AuthSearchParams }) {
  return renderAuthPage("signin", searchParams);
}
