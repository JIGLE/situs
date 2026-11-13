"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useRoutePathname } from "@/lib/hooks/use-route-pathname";
import { usePortalAccess } from "@/lib/contexts/portal-context";

export function PortalAccessGuard({ children }: { children: React.ReactNode }) {
  const pathname = useRoutePathname();
  const router = useRouter();
  const { canAccessPath } = usePortalAccess();

  useEffect(() => {
    if (!pathname) {
      return;
    }
    if (!canAccessPath(pathname)) {
      router.replace("/dashboard");
    }
  }, [canAccessPath, pathname, router]);

  if (pathname && !canAccessPath(pathname)) {
    return null;
  }

  return <>{children}</>;
}
