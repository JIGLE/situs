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

  // Finanças does not say how many rooms a property has. A cleared box is unknown (null), and 0 is
  // a studio: the box used to turn "" into 0, so a property the owner left blank became one.
  it("files a rooms box that was cleared as unknown, and a 0 as a studio", async () => {
    // React warns once per page about a `null` value, so the first test to meet one is the one to catch it.
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
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
    await user.click(await screen.findByRole("button", { name: ptMessages.properties.addDetails }));

    await user.clear(screen.getByLabelText(ptMessages.properties.fields.bedrooms));
    const bathrooms = screen.getByLabelText(ptMessages.properties.fields.bathrooms);
    await user.clear(bathrooms);
    await user.type(bathrooms, "0");
    await user.click(screen.getByRole("button", { name: ptMessages.actions.create }));

    await waitFor(() => expect(app.addProperty).toHaveBeenCalledTimes(1));
    expect(app.addProperty.mock.calls[0][0]).toMatchObject({ bedrooms: null, bathrooms: 0 });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("opens a property whose rooms are unknown with empty boxes, without a warning", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    const ref = createRef<PropertyFormDialogRef>();
    const user = userEvent.setup();
    renderWithProviders(<PropertyFormDialog ref={ref} />, { initialLocale: "pt" });
    act(() => {
      ref.current!.openEditDialog({
        id: "p1",
        name: "Rua Augusta 12",
        address: "Rua Augusta 12, 1100-048 Lisboa",
        type: "apartment",
        bedrooms: null,
        bathrooms: null,
        rent: 950,
        status: "vacant",
      } as never);
    });
    await user.click(await screen.findByRole("button", { name: ptMessages.properties.addDetails }));

    const bedrooms = screen.getByLabelText(ptMessages.properties.fields.bedrooms);
    expect((bedrooms as HTMLInputElement).value).toBe("");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
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
