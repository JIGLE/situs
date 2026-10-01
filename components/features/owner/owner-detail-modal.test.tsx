import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders as render, screen } from "@/tests/helpers/render-with-providers";
import ptMessages from "@/messages/pt.json";
import type { Owner } from "@/lib/types";

/**
 * An owner's NIF is what AT names a landlord by on a rent receipt. Nothing stored it before, and
 * the edit that would have saved it called a route that did not exist. Asserted in Portuguese,
 * since asserting English cannot catch hardcoded English.
 */

const { updateOwnerMock, deleteOwnerMock, state } = vi.hoisted(() => ({
  updateOwnerMock: vi.fn(),
  deleteOwnerMock: vi.fn(),
  state: { owners: [] as unknown[] },
}));

vi.mock("@/lib/contexts/app-context", () => ({
  useApp: () => ({ state, updateOwner: updateOwnerMock, deleteOwner: deleteOwnerMock }),
}));
vi.mock("@/lib/contexts/toast-context", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

import { OwnerDetailModal } from "./owner-detail-modal";

const owners = ptMessages.owners;
const identity = ptMessages.taxIdentity;

const ana: Owner = {
  id: "o1",
  userId: "user-1",
  name: "Ana Costa",
  email: "ana@example.pt",
  phone: "+351 912 345 678",
  address: "Rua Augusta 12",
  notes: "",
  taxIdentificationNumber: "123456789",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  properties: [],
};

const open = () =>
  render(<OwnerDetailModal ownerId="o1" onClose={() => {}} />, { initialLocale: "pt" });
const startEditing = async () => {
  await userEvent.click(screen.getByRole("button", { name: owners.editOwner }));
};

describe("OwnerDetailModal, the NIF", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.owners = [ana];
    updateOwnerMock.mockResolvedValue(undefined);
  });

  it("shows the owner's NIF beside their contact details", () => {
    open();

    expect(screen.getByTestId("owner-nif").textContent).toBe(`${identity.nif} 123456789`);
  });

  it("shows no NIF line for an owner who has none", () => {
    state.owners = [{ ...ana, taxIdentificationNumber: null }];
    open();

    expect(screen.queryByTestId("owner-nif")).toBeNull();
  });

  it("opens the edit form in Portuguese, with the NIF filled in and the hint under it", async () => {
    open();
    await startEditing();

    expect(screen.getByRole("heading", { name: owners.editTitle })).toBeTruthy();
    expect((screen.getByLabelText(identity.nif) as HTMLInputElement).value).toBe("123456789");
    expect(screen.getByText(owners.nifHint)).toBeTruthy();
  });

  it("says in Portuguese that a NIF is wrong as it is typed, and saves nothing", async () => {
    open();
    await startEditing();
    const input = screen.getByLabelText(identity.nif);
    await userEvent.clear(input);
    await userEvent.type(input, "123456788");

    expect(screen.getByText(identity.invalidNif)).toBeTruthy();
    expect(screen.queryByText(owners.nifHint)).toBeNull();
    expect(screen.queryByText("Invalid NIF")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: ptMessages.actions.save }));

    expect(updateOwnerMock).not.toHaveBeenCalled();
  });

  it("saves a NIF that passes its check digit, as the owner typed it", async () => {
    open();
    await startEditing();
    const input = screen.getByLabelText(identity.nif);
    await userEvent.clear(input);
    await userEvent.type(input, "502 000 007");

    expect(screen.queryByText(identity.invalidNif)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: ptMessages.actions.save }));

    expect(updateOwnerMock).toHaveBeenCalledWith(
      "o1",
      expect.objectContaining({ name: "Ana Costa", taxIdentificationNumber: "502 000 007" }),
    );
  });

  it("lets the owner clear the NIF", async () => {
    open();
    await startEditing();
    await userEvent.clear(screen.getByLabelText(identity.nif));
    await userEvent.click(screen.getByRole("button", { name: ptMessages.actions.save }));

    expect(updateOwnerMock).toHaveBeenCalledWith(
      "o1",
      expect.objectContaining({ taxIdentificationNumber: "" }),
    );
  });

  it("names the properties an owner holds in Portuguese", () => {
    state.owners = [
      {
        ...ana,
        properties: [
          {
            id: "po1",
            propertyId: "p1",
            ownerId: "o1",
            ownershipPercentage: 100,
            createdAt: "",
            updatedAt: "",
            property: { id: "p1", name: "Rua Augusta 12" },
          },
        ],
      },
    ];
    open();

    expect(screen.getByText(`${owners.propertiesOwned} (1)`)).toBeTruthy();
  });
});
