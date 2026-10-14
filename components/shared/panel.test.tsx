import { describe, expect, it } from "vitest";
import { renderWithProviders as render, screen } from "@/tests/helpers/render-with-providers";

import { Fact, Panel } from "./panel";

/**
 * A fact's value is one line cut with an ellipsis, which suits a name. The Portuguese allowlist
 * sentence, "Nenhum — apenas contas existentes.", ran 25px past its box at 390px and was cut off
 * with nothing to reach the rest, so a value that is words says `wrap` and runs onto a second line.
 */
describe("Fact", () => {
  it("cuts a value to one line by default", () => {
    render(<Fact label="Nome" value="Ana Costa" />);

    expect(screen.getByText("Ana Costa")).toHaveClass("truncate");
    expect(screen.getByText("Ana Costa")).not.toHaveClass("break-words");
  });

  it("lets a value run onto a second line when it says so, and never cuts it", () => {
    render(<Fact label="Registo" value="O registo está aberto a contas Google" wrap />);

    const value = screen.getByText("O registo está aberto a contas Google");
    expect(value).toHaveClass("break-words");
    expect(value).not.toHaveClass("truncate");
  });
});

describe("Panel", () => {
  it("is a section whose title is an h2, with its line and its body", () => {
    render(
      <Panel title="Segurança" description="Como entra na sua conta" padded>
        <p>Corpo</p>
      </Panel>,
    );

    expect(screen.getByRole("heading", { level: 2, name: "Segurança" })).toBeDefined();
    expect(screen.getByText("Como entra na sua conta")).toBeDefined();
    expect(screen.getByText("Corpo").parentElement).toHaveClass("p-4");
  });

  it("says warning and danger with its border, not with another shape", () => {
    const { rerender } = render(<Panel title="A">x</Panel>);
    expect(screen.getByText("A").closest("section")).not.toHaveClass(
      "border-[var(--semantic-danger)]",
    );

    rerender(
      <Panel title="A" tone="danger">
        x
      </Panel>,
    );
    expect(screen.getByText("A").closest("section")).toHaveClass("border-[var(--semantic-danger)]");

    rerender(
      <Panel title="A" tone="warning">
        x
      </Panel>,
    );
    expect(screen.getByText("A").closest("section")).toHaveClass(
      "border-[var(--semantic-warning-readable)]",
    );
  });

  it("draws no header, and so no heading, when something else already names it", () => {
    render(<Panel description="Contas que alimentam a caixa de movimentos">x</Panel>);

    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByText("Contas que alimentam a caixa de movimentos")).toBeDefined();
  });
});
