import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

import { renderWithProviders, screen, waitFor } from "@/tests/helpers/render-with-providers";
import { markReported } from "@/lib/utils/api-error";
import { RecordPaymentDialog } from "./record-payment-dialog";

/**
 * **Registar pagamento** records money that arrived without a bank movement. It is saved against a
 * lease, so allocation knows which contract's months it settles, and as paid: the form it
 * replaces saved every payment as pending, so the dashboard called the tenant late five days
 * later while the ledger already counted the month as paid. Asserted in Portuguese.
 */

const { app, toast } = vi.hoisted(() => ({
  app: { addReceipt: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const lease = (id: string, tenantId: string, propertyId: string, status: string, rent: number) => ({
  id,
  tenantId,
  propertyId,
  status,
  monthlyRent: rent,
});

vi.mock("@/lib/contexts/app-context", () => ({
  useApp: () => ({
    state: {
      leases: [
        lease("lease-old", "tenant-1", "prop-1", "terminated", 700),
        lease("lease-1", "tenant-1", "prop-1", "active", 850),
        lease("lease-2", "tenant-2", "prop-2", "active", 800),
        lease("lease-draft", "tenant-2", "prop-2", "draft", 900),
      ],
      tenants: [
        { id: "tenant-1", name: "Ana Costa" },
        { id: "tenant-2", name: "Zé Pereira" },
      ],
      properties: [
        { id: "prop-1", name: "Rua Augusta 12" },
        { id: "prop-2", name: "Rua do Ouro 3" },
      ],
    },
    addReceipt: app.addReceipt,
  }),
}));
vi.mock("@/lib/contexts/toast-context", () => ({ useToast: () => toast }));

const TODAY = new Date().toISOString().slice(0, 10);

function open(preset?: Parameters<typeof RecordPaymentDialog>[0]["preset"]) {
  const onOpenChange = vi.fn();
  const onRecorded = vi.fn();
  renderWithProviders(
    <RecordPaymentDialog
      open
      onOpenChange={onOpenChange}
      preset={preset}
      onRecorded={onRecorded}
    />,
    { initialLocale: "pt" },
  );
  return { onOpenChange, onRecorded, user: userEvent.setup() };
}

const submit = () => screen.getByRole("button", { name: "Registar pagamento" });

describe("RecordPaymentDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    app.addReceipt.mockResolvedValue(undefined);
  });

  it("records the payment as paid, against the lease it was opened for", async () => {
    const { onOpenChange, onRecorded, user } = open({ leaseId: "lease-2", amount: 300 });

    expect(screen.getByRole("dialog", { name: "Registar pagamento" })).toBeInTheDocument();
    expect(screen.getByLabelText("Valor (€)")).toHaveValue("300");
    await user.click(submit());

    await waitFor(() =>
      expect(app.addReceipt).toHaveBeenCalledWith({
        tenantId: "tenant-2",
        propertyId: "prop-2",
        leaseId: "lease-2",
        amount: 300,
        date: TODAY,
        type: "rent",
        status: "paid",
        description: undefined,
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Pagamento registado.");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onRecorded).toHaveBeenCalled();
  });

  it("starts from the tenant's active lease and its rent when only the tenant is known", async () => {
    const { user } = open({ tenantId: "tenant-1", propertyId: "prop-1" });

    expect(screen.getByLabelText("Valor (€)")).toHaveValue("850");
    await user.click(submit());

    await waitFor(() =>
      expect(app.addReceipt).toHaveBeenCalledWith(
        expect.objectContaining({ leaseId: "lease-1", amount: 850 }),
      ),
    );
  });

  it("takes an amount written with a decimal comma", async () => {
    const { user } = open({ leaseId: "lease-2" });

    await user.clear(screen.getByLabelText("Valor (€)"));
    await user.type(screen.getByLabelText("Valor (€)"), "812,50");
    await user.click(submit());

    await waitFor(() =>
      expect(app.addReceipt).toHaveBeenCalledWith(expect.objectContaining({ amount: 812.5 })),
    );
  });

  it("asks which lease the payment belongs to, and saves nothing", async () => {
    const { user } = open();

    await user.click(submit());

    expect(
      await screen.findByText("Escolha o contrato a que este pagamento pertence."),
    ).toBeInTheDocument();
    expect(app.addReceipt).not.toHaveBeenCalled();
  });

  it("asks for an amount above zero, and saves nothing", async () => {
    const { user } = open({ leaseId: "lease-2" });

    await user.clear(screen.getByLabelText("Valor (€)"));
    await user.type(screen.getByLabelText("Valor (€)"), "0");
    await user.click(submit());

    expect(await screen.findByText("Indique um valor acima de zero.")).toBeInTheDocument();
    expect(app.addReceipt).not.toHaveBeenCalled();
  });

  it("stays open when the save is refused, leaving the reason to the toast already shown", async () => {
    app.addReceipt.mockRejectedValue(markReported(Object.assign(new Error("x"), { status: 400 })));
    const { onOpenChange, onRecorded, user } = open({ leaseId: "lease-2" });

    await user.click(submit());

    await waitFor(() => expect(app.addReceipt).toHaveBeenCalled());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(onRecorded).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
