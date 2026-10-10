import { AuthView } from "@/components/features/auth/auth-view";
import { isDemoLoginEnabled } from "@/lib/utils/demo-login";
import { authTitle } from "@/lib/i18n/page-title";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return authTitle("signin");
}

export default function SignIn() {
  return <AuthView mode="signin" demoLoginEnabled={isDemoLoginEnabled()} />;
}
