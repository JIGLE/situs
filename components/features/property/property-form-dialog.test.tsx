/**
 * @vitest-environment jsdom
 */
/**
 * Saving a property showed "Property added successfully!" — hardcoded English passed to the form
 * hook — on top of the entity action's own English "Property added successfully". Now the dialog
 * owns the one success toast, from the catalogue. Asserted in Portuguese: English would pass with
 * the old string hardcoded.
 */
import { act, createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "@/tests/helpers/render-with-providers";
import ptMessages from "@/messages/pt.json";
import { PropertyFormDialog, type PropertyFormDialogRef } from "./property-form-dialog";

const { app, toast } = vi.hoisted(() => ({
  app: { addProperty: vi.fn(), updateProperty: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/contexts/app-context", () => ({ useApp: () => app }));
vi.mock("@/lib/contexts/toast-context", () => ({ useToast: () => toast }));
vi.mock("@/lib/contexts/currency-context", () => ({
  useCurrency: () => ({ currencySymbol: "€", formatCurrency: (n: number) => `€${n}` }),
}));

describe("PropertyFormDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    app.addProperty.mockResolvedValue(undefined);
  });

  it("confirms a new property once, in the app's language", async () => {
    const ref = createRef<PropertyFormDialogRef>();
    const user = userEvent.setup();
    renderWithProviders(<PropertyFormDialog ref={ref} />, { initialLocale: "pt" });

    act(() => {
      ref.current!.openDialog({
        name: "Rua Augusta 12",
        address: "Rua Augusta 12, 1100-048 Lisboa",
        zipCode: "1100-048",
        rent: 950,
      });
    });
    await user.click(await screen.findByRole("button", { name: ptMessages.actions.create }));

    await waitFor(() => expect(app.addProperty).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith(ptMessages.properties.toastCreated);
    expect(toast.error).not.toHaveBeenCalled();
  });
});
