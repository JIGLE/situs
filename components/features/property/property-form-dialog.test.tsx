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

  it("labels the whole form in the app's language", async () => {
    // The title, the address label and its verified badge, the manual-edit toggle, the rent label
    // and the details toggle were English literals in a Portuguese form.
    const ref = createRef<PropertyFormDialogRef>();
    renderWithProviders(<PropertyFormDialog ref={ref} />, { initialLocale: "pt" });

    act(() => {
      ref.current!.openDialog({
        name: "Rua Augusta 12",
        address: "Rua Augusta 12, 1100-048 Lisboa",
        addressVerified: true,
      });
    });

    const pt = ptMessages.properties;
    expect(await screen.findByText(pt.addNew)).toBeInTheDocument();
    expect(screen.getByText(pt.enterInfo)).toBeInTheDocument();
    expect(screen.getByText(`${ptMessages.forms.address} *`)).toBeInTheDocument();
    expect(screen.getByText(`✓ ${pt.fields.verified}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: pt.editManually })).toBeInTheDocument();
    expect(screen.getByText(`${pt.fields.monthlyRent} (€)`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: pt.addDetails })).toBeInTheDocument();
    expect(
      screen.queryByText(
        /Add New Property|Address \*|Verified|Edit manually|Monthly Rent|Add details/,
      ),
    ).not.toBeInTheDocument();
  });
});
