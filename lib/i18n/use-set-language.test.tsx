import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { renderHook } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import pt from "@/messages/pt.json";

/**
 * `useSetLanguage` is the one way the interface changes language. Settings › Appearance's old
 * control saved only the account's copy, which the screen never reads, so it changed nothing on
 * screen: what switches the screen is the cookie, and the refresh that re-renders by it.
 */

const { refresh, apiFetch, session } = vi.hoisted(() => ({
  refresh: vi.fn(),
  apiFetch: vi.fn(),
  session: { status: "authenticated" as "authenticated" | "unauthenticated" },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ status: session.status, data: null }) }));
vi.mock("@/lib/utils/api-client", () => ({ apiFetch }));

import { useSetLanguage } from "./use-set-language";
import { readLocaleCookie } from "./locale-cookie";

const inPortuguese = ({ children }: { children: React.ReactNode }) => (
  <NextIntlClientProvider locale="pt" messages={pt}>
    {children}
  </NextIntlClientProvider>
);

describe("useSetLanguage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.cookie = "situs-locale=; Max-Age=0; Path=/";
    session.status = "authenticated";
    apiFetch.mockResolvedValue({ language: "en" });
  });

  it("switches this device and saves the choice to the account", async () => {
    const { result } = renderHook(() => useSetLanguage(), { wrapper: inPortuguese });

    await act(() => result.current("en"));

    expect(readLocaleCookie()).toBe("en");
    expect(apiFetch).toHaveBeenCalledWith("/api/settings/language", null, "PUT", {
      language: "en",
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("on the sign-in page, switches the device and saves nothing, having no account yet", async () => {
    session.status = "unauthenticated";
    const { result } = renderHook(() => useSetLanguage(), { wrapper: inPortuguese });

    await act(() => result.current("es"));

    expect(readLocaleCookie()).toBe("es");
    expect(apiFetch).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("still switches the screen when the account refuses the save", async () => {
    apiFetch.mockRejectedValue(Object.assign(new Error("offline"), { status: 503 }));
    const { result } = renderHook(() => useSetLanguage(), { wrapper: inPortuguese });

    await act(() => result.current("it"));

    expect(readLocaleCookie()).toBe("it");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does nothing for the language already on screen", async () => {
    const { result } = renderHook(() => useSetLanguage(), { wrapper: inPortuguese });

    await act(() => result.current("pt"));

    expect(readLocaleCookie()).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
