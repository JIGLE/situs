import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { renderHook } from "@testing-library/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createFakeAddress } from "@/tests/helpers/fake-address";
import { useTabPersistence } from "./use-tab-persistence";

/**
 * The hook keeps a screen's tab in `?view=` and in localStorage. What it must never do is undo a
 * click: the router writes `view` a moment after the click, and the hook used to compare `view`
 * with the tab on every render, so for that moment it put the old tab back.
 */

let address: ReturnType<typeof createFakeAddress>;

function install(search: string) {
  address = createFakeAddress("/en/people", search);
  vi.mocked(useSearchParams).mockImplementation(address.useSearchParams);
  vi.mocked(useRouter).mockReturnValue(address.router);
  vi.mocked(usePathname).mockImplementation(address.usePathname);
}

describe("useTabPersistence", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("keeps a clicked tab while the router is still writing it", () => {
    install("view=tenants");
    const { result } = renderHook(() => useTabPersistence("people", "tenants"));

    act(() => result.current[1]("owners"));

    // The address still says `view=tenants`: the router has not written the click yet.
    expect(address.search).toBe("view=tenants");
    expect(result.current[0]).toBe("owners");

    act(() => address.flush());

    expect(address.search).toBe("view=owners");
    expect(result.current[0]).toBe("owners");
    expect(localStorage.getItem("tab-people")).toBe("owners");
  });

  it("follows the address back and forward", () => {
    install("view=tenants");
    const { result } = renderHook(() => useTabPersistence("people", "tenants"));

    act(() => address.navigate("view=owners"));
    expect(result.current[0]).toBe("owners");

    act(() => address.navigate("view=tenants"));
    expect(result.current[0]).toBe("tenants");
  });

  it("restores the last tab used when the address names none", () => {
    localStorage.setItem("tab-people", "owners");
    install("");

    const { result } = renderHook(() => useTabPersistence("people", "tenants"));

    expect(result.current[0]).toBe("owners");
  });
});
