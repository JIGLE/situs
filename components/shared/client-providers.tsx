"use client";

import { ToastProvider } from "@/lib/contexts/toast-context";
import { AppProvider } from "@/lib/contexts/app-context";
import { ThemeProvider } from "@/lib/contexts/theme-context";
import { CsrfProvider } from "@/lib/contexts/csrf-context";
import { DevAuthProvider } from "@/components/shared/dev-auth";
import { PortalProvider } from "@/lib/contexts/portal-context";

interface ClientProvidersProps {
  children: React.ReactNode;
  nonce?: string;
}

export function ClientProviders({ children, nonce }: ClientProvidersProps): React.ReactElement {
  void nonce;
  return (
    <DevAuthProvider>
      <ThemeProvider>
        <CsrfProvider>
          <ToastProvider>
            <PortalProvider>
              <AppProvider>{children}</AppProvider>
            </PortalProvider>
          </ToastProvider>
        </CsrfProvider>
      </ThemeProvider>
    </DevAuthProvider>
  );
}
