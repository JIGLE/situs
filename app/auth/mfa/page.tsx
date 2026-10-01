import { MfaView } from "./mfa-view";

export const dynamic = "force-dynamic";

/**
 * The second step of signing in. `proxy.ts` sends a session that has not yet entered its code
 * here; see `MfaView`.
 */
export default function MfaPage() {
  return <MfaView />;
}
