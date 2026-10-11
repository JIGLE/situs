import { renderAuthPage, type AuthSearchParams } from "../render-auth";
import { authTitle } from "@/lib/i18n/page-title";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return authTitle("signup");
}

export default async function SignUp({ searchParams }: { searchParams: AuthSearchParams }) {
  return renderAuthPage("signup", searchParams);
}
