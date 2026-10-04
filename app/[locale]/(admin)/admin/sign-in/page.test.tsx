import { describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";

import AdminSignInPage from "./page";

describe("Admin › Sign-in, which is part of Acessos now", () => {
  it("sends an address saved before the tab was renamed to the tab", () => {
    vi.mocked(redirect).mockClear();

    AdminSignInPage();

    expect(redirect).toHaveBeenCalledWith("/admin/access");
  });
});
