import { describe, expect, it } from "vitest";
import { renderWithProviders, screen } from "@/tests/helpers/render-with-providers";
import { useConnectorMode } from "./connector-mode";

function Probe({ mode }: { mode: string }) {
  const connectorMode = useConnectorMode();
  return (
    <p data-class={connectorMode.badgeClass(mode)}>
      {connectorMode.label(mode)} | {connectorMode.help(mode, "PT")}
    </p>
  );
}

// Asserted in Portuguese: an English assertion cannot tell a translated string from a hardcoded one.
describe("useConnectorMode", () => {
  it("says a simulated mode transmits nothing", () => {
    renderWithProviders(<Probe mode="review" />, { initialLocale: "pt" });
    expect(screen.getByText(/Simulado \| Simulado — nada é transmitido/)).toBeInTheDocument();
  });

  it("says the test mode reaches the authority's test service, and nothing there counts", () => {
    renderWithProviders(<Probe mode="test" />, { initialLocale: "pt" });
    expect(
      screen.getByText(
        "Serviço de testes | Liga ao serviço de testes da Autoridade Tributária: nada do que lá é enviado tem valor fiscal.",
      ),
    ).toHaveAttribute("data-class", expect.stringMatching(/warning/));
  });

  it("names a mode nothing honours, such as live", () => {
    renderWithProviders(<Probe mode="live" />, { initialLocale: "pt" });
    expect(screen.getByText(/Sem submissão \| O modo "live" não é suportado/)).toHaveAttribute(
      "data-class",
      expect.stringMatching(/danger/),
    );
  });
});
