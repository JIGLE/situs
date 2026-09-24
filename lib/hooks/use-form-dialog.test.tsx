/**
 * @vitest-environment jsdom
 */
/**
 * One toast per save, always translated.
 *
 * The hook used to toast every outcome itself, in English — "Item created successfully!", "Please
 * fix the form errors below.", "Failed to save. Please try again." — on top of the entity action's
 * toast and, often, the screen's own. Now the screen owns the success toast, the action owns the
 * failure it hit, and the hook speaks only for what nobody else has: the form's own validation, and
 * a failure no one has reported. Asserted in Portuguese, because English would pass with the old
 * strings hardcoded.
 */
import { act, type FormEvent, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { z } from "zod";
import ptMessages from "@/messages/pt.json";
import { markReported } from "@/lib/utils/api-error";
import { useFormDialog, type UseFormDialogOptions } from "./use-form-dialog";

const { toast } = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/contexts/toast-context", () => ({ useToast: () => toast }));

const schema = z.object({ name: z.string().min(1, "Name is required") });
type Form = z.infer<typeof schema>;

const wrapper = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="pt" messages={ptMessages}>
    {children}
  </NextIntlClientProvider>
);

function setup(options: Partial<UseFormDialogOptions<Form>>, name = "Ana") {
  const { result } = renderHook(
    () =>
      useFormDialog<Form>({
        schema,
        initialData: { name },
        onSubmit: async () => {},
        ...options,
      }),
    { wrapper },
  );
  return async () => {
    await act(async () => {
      await result.current.handleSubmit({ preventDefault() {} } as FormEvent);
    });
  };
}

const api = ptMessages.errors.api;

describe("useFormDialog feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("toasts no success of its own when the screen passes none", async () => {
    await setup({})();

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("toasts the screen's success message", async () => {
    await setup({ successMessage: { create: "Criado", update: "Atualizado" } })();

    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("Criado");
  });

  it("asks for the form to be checked when the schema refuses it", async () => {
    await setup({}, "")();

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(api.invalidInput);
  });

  it("does not toast a failure the action already reported", async () => {
    const onSubmit = async () => {
      throw markReported(Object.assign(new Error("Internal"), { status: 500 }));
    };

    await setup({ onSubmit })();

    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("reports any other failure once, generically", async () => {
    const onSubmit = async () => {
      throw new TypeError("contractFile.arrayBuffer is not a function");
    };

    await setup({ onSubmit })();

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(api.generic);
  });
});
