import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import pt from "@/messages/pt.json";

/**
 * A device's language and the account's, kept in step once per page load.
 *
 * The sign-in carry is what keeps this safe with more than one device, and in E2E, where every
 * test shares one account: a device adopts the account's language only from the session it
 * signed in with, never from a fresh read, so a choice made elsewhere does not switch a page
 * already open.
 */

const { refresh, apiFetch, auth } = vi.hoisted(() => ({
  refresh: vi.fn(),
  apiFetch: vi.fn(),
  auth: { locale: undefined as string | undefined },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    status: "authenticated",
    data: { user: { id: "u-1", role: "ADMIN" }, expires: "", locale: auth.locale },
  }),
}));
vi.mock("@/lib/utils/api-client", () => ({ apiFetch }));

import { LanguageSync } from "./language-sync";
import { UserSettingsProvider } from "@/lib/contexts/user-settings-context";
import { readLocaleCookie } from "@/lib/i18n/locale-cookie";

function account(language: string, chosen: boolean) {
  return {
    theme: "system",
    language,
    languageChosenAt: chosen ? "2026-09-25T10:00:00.000Z" : null,
    residenceCountry: "PT",
  };
}

/** Answers GET /api/settings with `row`, and every PUT with success. */
function serve(row: ReturnType<typeof account>) {
  apiFetch.mockImplementation(async (_url: string, _csrf?: unknown, method?: string) =>
    method === "PUT" ? { language: "x" } : row,
  );
}

const saves = () => apiFetch.mock.calls.filter(([, , method]) => method === "PUT");

function renderInPortuguese() {
  return render(
    <NextIntlClientProvider locale="pt" messages={pt}>
      <UserSettingsProvider>
        <LanguageSync />
      </UserSettingsProvider>
    </NextIntlClientProvider>,
  );
}

describe("LanguageSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.cookie = "situs-locale=; Max-Age=0; Path=/";
    auth.locale = undefined;
  });

  describe("a device whose language was chosen", () => {
    it("saves it to the account when the account holds another", async () => {
      document.cookie = "situs-locale=pt; Path=/";
      serve(account("en", true));

      renderInPortuguese();

      await waitFor(() =>
        expect(saves()).toEqual([["/api/settings/language", null, "PUT", { language: "pt" }]]),
      );
      expect(refresh).not.toHaveBeenCalled();
    });

    it("records the account's old default as a choice once a device chose that language", async () => {
      document.cookie = "situs-locale=pt; Path=/";
      serve(account("pt", false));

      renderInPortuguese();

      await waitFor(() => expect(saves()).toHaveLength(1));
    });

    it("saves nothing when the account already holds it as a choice", async () => {
      document.cookie = "situs-locale=pt; Path=/";
      serve(account("pt", true));

      renderInPortuguese();

      await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/settings"));
      expect(saves()).toHaveLength(0);
    });

    it("keeps its own language whatever the session carries", async () => {
      document.cookie = "situs-locale=pt; Path=/";
      auth.locale = "en";
      serve(account("pt", true));

      renderInPortuguese();

      await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/settings"));
      expect(readLocaleCookie()).toBe("pt");
      expect(refresh).not.toHaveBeenCalled();
    });
  });

  describe("a device with no language of its own", () => {
    it("takes on the language the account chose, carried from sign-in", async () => {
      auth.locale = "en";
      serve(account("en", true));

      renderInPortuguese();

      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
      expect(readLocaleCookie()).toBe("en");
      expect(saves()).toHaveLength(0);
    });

    it("ignores a choice made after this session signed in", async () => {
      // The account's row says English, chosen, but the session carries nothing: the owner chose
      // it on another device after signing in here. Taking it on would switch this page under
      // them, and in E2E would switch every test sharing the account.
      serve(account("en", true));

      renderInPortuguese();

      await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/settings"));
      expect(readLocaleCookie()).toBeNull();
      expect(refresh).not.toHaveBeenCalled();
    });

    it("stays as it is when the account never chose one", async () => {
      serve(account("en", false));

      renderInPortuguese();

      await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/settings"));
      expect(readLocaleCookie()).toBeNull();
      expect(refresh).not.toHaveBeenCalled();
      expect(saves()).toHaveLength(0);
    });

    it("stays as it is when it already shows the account's language", async () => {
      auth.locale = "pt";
      serve(account("pt", true));

      renderInPortuguese();

      await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/settings"));
      expect(refresh).not.toHaveBeenCalled();
    });
  });
});
