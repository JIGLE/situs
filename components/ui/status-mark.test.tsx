import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { StatusMark } from "./status-mark";

describe("StatusMark", () => {
  it("says the state in words, with the colour in a dot a screen reader skips", () => {
    render(<StatusMark tone="success">Ativo</StatusMark>);

    const mark = screen.getByText("Ativo");
    const dot = mark.querySelector("span");
    expect(dot?.getAttribute("aria-hidden")).toBe("true");
    expect(dot?.className).toContain("bg-[var(--semantic-success-readable)]");
    expect(mark.className).toContain("text-[var(--color-foreground)]");
  });

  it("strikes through a state that no longer counts", () => {
    render(
      <StatusMark tone="neutral" struck>
        Anulado
      </StatusMark>,
    );

    expect(screen.getByText("Anulado").className).toContain("line-through");
  });
});
