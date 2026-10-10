import { AuthView } from "@/components/features/auth/auth-view";
import { isDemoLoginEnabled } from "@/lib/utils/demo-login";
import { authTitle } from "@/lib/i18n/page-title";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return authTitle("signup");
}

export default function SignUp() {
  return <AuthView mode="signup" demoLoginEnabled={isDemoLoginEnabled()} />;
}
