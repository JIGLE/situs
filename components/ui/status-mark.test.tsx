import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { StatusMark } from "./status-mark";

describe("StatusMark", () => {
  it("says the state in words, on a pill tinted in the state's colour", () => {
    render(<StatusMark tone="success">Ativo</StatusMark>);

    const mark = screen.getByText("Ativo").parentElement as HTMLElement;
    // No separate dot: the words are the state, and the tint repeats it.
    expect(mark.querySelector("[aria-hidden]")).toBeNull();
    expect(mark.className).toContain("bg-[var(--semantic-success-soft)]");
    expect(mark.className).toContain("text-[var(--semantic-success-readable)]");
  });

  it("strikes through a state that no longer counts", () => {
    render(
      <StatusMark tone="neutral" struck>
        Anulado
      </StatusMark>,
    );

    expect(screen.getByText("Anulado").parentElement?.className).toContain("line-through");
  });
});
