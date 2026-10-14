import { describe, it, expect } from "vitest";
import { renderWithProviders as render, screen } from "@/tests/helpers/render-with-providers";
import { Badge } from "./badge";

describe("Badge component", () => {
  it("renders children and variant class", () => {
    render(<Badge variant="outline">Renova</Badge>);
    const el = screen.getByText("Renova");
    expect(el.className).toMatch(/border-\[var\(--color-border\)\]/);
  });
});
