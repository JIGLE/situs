import { describe, expect, it } from "vitest";
import { useState } from "react";
import {
  renderWithProviders as render,
  screen,
  fireEvent,
} from "@/tests/helpers/render-with-providers";
import {
  LeasePartiesEditor,
  leasePartiesInvalid,
  type LeasePartyDraft,
} from "./lease-parties-editor";

/**
 * Co-tenants and guarantors on the lease wizard's tenant step. AT's receipts list every tenant of
 * the contract, so the lease records them; the NIF they carry is checked as it is typed.
 *
 * Asserted in Portuguese: asserting English cannot catch hardcoded English.
 */

function Harness({ initial = [] }: { initial?: LeasePartyDraft[] }) {
  const [parties, setParties] = useState(initial);
  return <LeasePartiesEditor parties={parties} onChange={setParties} />;
}

describe("LeasePartiesEditor", () => {
  it("adds a person and removes them", () => {
    render(<Harness />, { initialLocale: "pt" });

    fireEvent.click(screen.getByRole("button", { name: "Adicionar pessoa" }));
    expect(screen.getAllByTestId("lease-party")).toHaveLength(1);
    expect(screen.getByLabelText("Nome completo")).toBeInTheDocument();
    expect(screen.getByLabelText("NIF")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remover" }));
    expect(screen.queryAllByTestId("lease-party")).toHaveLength(0);
  });

  it("says a Portuguese NIF's check digit is wrong, in the app's language", () => {
    render(
      <Harness
        initial={[{ role: "tenant", name: "Rui Costa", taxId: "123456780", taxCountry: "PT" }]}
      />,
      { initialLocale: "pt" },
    );

    expect(
      screen.getByText("Este NIF não é válido: o dígito de controlo não confere."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("NIF")).toHaveAttribute("aria-invalid", "true");
  });

  it("asks someone from abroad for an identity document, and does not check their number", () => {
    render(
      <Harness
        initial={[{ role: "guarantor", name: "Hans Weber", taxId: "DE 123", taxCountry: "DE" }]}
      />,
      { initialLocale: "pt" },
    );

    expect(screen.getByLabelText("Número fiscal")).toHaveValue("DE 123");
    expect(screen.getByLabelText("Documento de identificação")).toBeInTheDocument();
    expect(screen.queryByText(/não é válido/)).not.toBeInTheDocument();
  });
});

describe("leasePartiesInvalid", () => {
  it("refuses a person with no name or a Portuguese NIF that fails, and nothing else", () => {
    expect(leasePartiesInvalid(undefined)).toBe(false);
    expect(leasePartiesInvalid([])).toBe(false);
    expect(leasePartiesInvalid([{ role: "tenant", name: "  " }])).toBe(true);
    expect(leasePartiesInvalid([{ role: "tenant", name: "Rui", taxId: "123456780" }])).toBe(true);
    expect(leasePartiesInvalid([{ role: "tenant", name: "Rui", taxId: "123456789" }])).toBe(false);
    expect(leasePartiesInvalid([{ role: "tenant", name: "Ana", taxId: "450000001" }])).toBe(false);
    expect(
      leasePartiesInvalid([{ role: "guarantor", name: "Hans", taxId: "any", taxCountry: "DE" }]),
    ).toBe(false);
  });
});
