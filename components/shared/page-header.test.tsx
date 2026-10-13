import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { PageHeader } from "./page-header";

describe("PageHeader", () => {
  it("is the page's one h1, with its line and its actions", () => {
    render(
      <PageHeader title="Contratos" description="Gerir contratos">
        <button type="button">Novo contrato</button>
      </PageHeader>,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Contratos" })).toBeDefined();
    expect(screen.getByText("Gerir contratos")).toBeDefined();
    expect(screen.getByRole("button", { name: "Novo contrato" })).toBeDefined();
  });

  it("leaves the title to a screen reader on a phone, where the top bar names the screen", () => {
    render(<PageHeader title="Pessoas" description="Inquilinos e proprietários" />);

    const title = screen.getByRole("heading", { level: 1, name: "Pessoas" });
    expect(title.parentElement?.className).toContain("max-md:sr-only");
  });

  it("keeps a title that says more than the top bar does", () => {
    render(<PageHeader title="Bom dia, Ana" titleOnMobile />);

    const title = screen.getByRole("heading", { level: 1, name: "Bom dia, Ana" });
    expect(title.parentElement?.className).not.toContain("max-md:sr-only");
  });

  it("carries the id a region points at and the hook a test reads", () => {
    render(<PageHeader title="Em falta" id="complete-title" titleTestId="greeting" />);

    const title = screen.getByRole("heading", { level: 1, name: "Em falta" });
    expect(title.id).toBe("complete-title");
    expect(title.getAttribute("data-testid")).toBe("greeting");
  });
});
