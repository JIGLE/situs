import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/utils/api-client", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "@/lib/utils/api-client";
import { wasReported } from "@/lib/utils/api-error";
import { createEntityActions } from "./create-entity-actions";

type Item = { id: string; name: string };

/**
 * One toast per outcome. A success belongs to the form or the screen that asked for it — they
 * already say "Proprietário criado com sucesso" — so the factory reports failures only. It used to
 * add its own English "Owner added successfully" on top, and the form dialog a third.
 *
 * The config is built as a variable, not a literal, so a `showSuccess` callback can be offered
 * without the type system objecting: the assertion is that the factory never calls one.
 */
function setup(overrides: { userId?: string | null } = {}) {
  let items: Item[] = [{ id: "1", name: "Ana" }];
  const showError = vi.fn();
  const showSuccess = vi.fn();
  const config = {
    endpoint: "/api/items",
    getItems: () => items,
    setItems: (next: Item[]) => {
      items = next;
    },
    showError,
    showSuccess,
    resolveError: () => "Não foi possível guardar.",
    csrfToken: "csrf",
    userId: "user-1" as string | null | undefined,
    ...overrides,
  };
  const actions = createEntityActions<Item>(config);
  return { actions, showError, showSuccess, items: () => items };
}

describe("createEntityActions feedback", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it("reports no success of its own on add, update or remove", async () => {
    const { actions, showError, showSuccess } = setup();
    vi.mocked(apiFetch)
      .mockResolvedValueOnce({ id: "2", name: "Rui" })
      .mockResolvedValueOnce({ id: "1", name: "Ana Maria" })
      .mockResolvedValueOnce(undefined);

    await actions.add({ name: "Rui" });
    await actions.update("1", { name: "Ana Maria" });
    await actions.remove("2");

    expect(showSuccess).not.toHaveBeenCalled();
    expect(showError).not.toHaveBeenCalled();
  });

  it("reports each failure exactly once, in the caller's words", async () => {
    const { actions, showError } = setup();
    vi.mocked(apiFetch).mockRejectedValue(Object.assign(new Error("Internal"), { status: 500 }));

    await expect(actions.add({ name: "Rui" })).rejects.toThrow();
    await expect(actions.update("1", { name: "x" })).rejects.toThrow();
    await expect(actions.remove("1")).rejects.toThrow();

    expect(showError).toHaveBeenCalledTimes(3);
    for (const [message] of showError.mock.calls) {
      expect(message).toBe("Não foi possível guardar.");
    }
  });

  // The caller still gets the failure, to keep a dialog open or roll something back, but marked,
  // so its own `catch` knows the user has been told and does not toast it again.
  it("marks the failure it reported before handing it on", async () => {
    const { actions } = setup();
    const failure = Object.assign(new Error("Internal"), { status: 500 });
    vi.mocked(apiFetch).mockRejectedValue(failure);

    const caught = await actions.update("1", { name: "x" }).catch((err: unknown) => err);

    expect(caught).toBe(failure);
    expect(wasReported(caught)).toBe(true);
  });

  it("reports a signed-out attempt instead of failing silently", async () => {
    const { actions, showError } = setup({ userId: null });

    await expect(actions.add({ name: "Rui" })).rejects.toThrow();

    expect(apiFetch).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledTimes(1);
    expect(showError).toHaveBeenCalledWith("Não foi possível guardar.");
  });

  it("rolls a failed remove back", async () => {
    const { actions, items } = setup();
    vi.mocked(apiFetch).mockRejectedValue(new Error("offline"));

    await expect(actions.remove("1")).rejects.toThrow();

    expect(items()).toEqual([{ id: "1", name: "Ana" }]);
  });
});
