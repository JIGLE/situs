import { MfaView } from "./mfa-view";
import { authTitle } from "@/lib/i18n/page-title";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return authTitle("mfa");
}

/**
 * The second step of signing in. `proxy.ts` sends a session that has not yet entered its code
 * here; see `MfaView`.
 */
export default function MfaPage() {
  return <MfaView />;
}
