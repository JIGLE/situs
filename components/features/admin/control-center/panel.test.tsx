import { describe, expect, it } from "vitest";
import { renderWithProviders as render, screen } from "@/tests/helpers/render-with-providers";

import { Fact } from "./panel";

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
