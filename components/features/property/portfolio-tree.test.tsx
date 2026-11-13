import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders as render, screen } from "@/tests/helpers/render-with-providers";
import { PortfolioTree } from "./portfolio-tree";
import type { Building, Property } from "@/lib/types";

vi.mock("@/lib/contexts/currency-context", () => ({
  useCurrency: () => ({ formatCurrency: (amount: number) => `${amount.toFixed(2)} €` }),
}));

const property = (id: string, name: string, city: string, buildingId?: string): Property =>
  ({
    id,
    userId: "u",
    name,
    address: `${name}, ${city}`,
    city,
    country: "PT",
    type: "apartment",
    status: "vacant",
    rent: 0,
    buildingId: buildingId ?? null,
  }) as Property;

const building: Building = {
  id: "b1",
  userId: "u",
  name: "Edifício Vela",
  city: "Cascais",
  country: "PT",
  createdAt: "",
  updatedAt: "",
};

describe("PortfolioTree", () => {
  it("lists a building as a heading inside its city, with its units under it and no fold", async () => {
    const onOpenBuilding = vi.fn();
    render(
      <PortfolioTree
        properties={[
          property("p1", "Fração A", "Cascais", "b1"),
          property("p2", "Fração B", "Cascais", "b1"),
          property("p3", "Moradia", "Cascais"),
          property("p4", "Loja", "Lisboa"),
        ]}
        buildings={[building]}
        tenants={[]}
        onOpenBuilding={onOpenBuilding}
      />,
    );

    const group = screen.getByRole("group", { name: "Edifício Vela" });
    expect(group.textContent).toContain("Fração A");
    expect(group.textContent).toContain("Fração B");
    expect(group.textContent).not.toContain("Moradia");
    // The building is not a fold: nothing about it expands or collapses.
    expect(group.closest("[aria-expanded]")?.textContent).toContain("Cascais");
    expect(group.hasAttribute("aria-expanded")).toBe(false);

    const heading = screen.getByRole("button", { name: /Edifício Vela/ });
    await userEvent.click(heading);
    expect(onOpenBuilding).toHaveBeenCalledWith("b1");
    // Still listed after the click: the heading opens the building, it does not hide the units.
    expect(screen.getByText("Fração A")).toBeDefined();
  });
});
