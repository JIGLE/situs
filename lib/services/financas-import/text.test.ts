import { describe, expect, it } from "vitest";
import { shortStreet } from "./text";

describe("shortStreet", () => {
  it("abbreviates the street type and titles, and drops the article after the type", () => {
    expect(shortStreet("Rua Capitão Leitão")).toBe("R. Cap. Leitão");
    expect(shortStreet("Avenida Doutor Alfredo Bensaúde")).toBe("Av. Dr. Alfredo Bensaúde");
    expect(shortStreet("Praça de Nossa Senhora da Luz")).toBe("Pç. N.ª Sr.ª da Luz");
    expect(shortStreet("Rua de Angola")).toBe("R. Angola");
  });

  it("leaves a name with nothing to shorten as it is", () => {
    expect(shortStreet("Qta do Pinheiro")).toBe("Qta do Pinheiro");
    expect(shortStreet("Rua A")).toBe("R. A");
    expect(shortStreet("Ruanda")).toBe("Ruanda");
    expect(shortStreet(null)).toBe("");
  });
});
