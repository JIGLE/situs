import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { TabLink, TabNav } from "./tabs";

/**
 * A tab that is a page wears the same style as a tab that swaps a panel, and says which page is
 * current to a screen reader as well as to the eye.
 */
describe("TabNav and TabLink", () => {
  it("marks the current page and dresses it as the active tab", () => {
    render(
      <TabNav aria-label="Secções">
        <TabLink href="/admin" active>
          Visão geral
        </TabLink>
        <TabLink href="/admin/status" active={false}>
          Estado
        </TabLink>
      </TabNav>,
    );

    expect(screen.getByRole("navigation", { name: "Secções" })).toBeDefined();
    const current = screen.getByRole("link", { name: "Visão geral" });
    expect(current.getAttribute("aria-current")).toBe("page");
    expect(current.className).toContain("border-t-[var(--country-highlight-readable)]");

    const other = screen.getByRole("link", { name: "Estado" });
    expect(other.getAttribute("aria-current")).toBeNull();
    expect(other.className).not.toContain("border-t-[var(--country-highlight-readable)]");
  });
});
