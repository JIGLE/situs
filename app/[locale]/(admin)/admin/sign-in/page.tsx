import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Sign-in is a part of Acessos now: the tab that says who may create an account and who has one,
 * with the sign-in methods and the allowlist below. This keeps the address an operator may have
 * saved from ending in a 404; `normalizePortalPath` maps every `/admin/*` path to `/admin`, so the
 * redirect is all it needs.
 */
export default function AdminSignInPage() {
  redirect("/admin/access");
}
