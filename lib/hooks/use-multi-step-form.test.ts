import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { renderHook } from "@testing-library/react";
import { z } from "zod";
import { useMultiStepForm } from "./use-multi-step-form";

/**
 * The wizard's draft sits in localStorage, in clear, for a day. The lease wizard keeps its
 * co-tenants' NIFs out of it: the server encrypts them, and a draft should not undo that.
 */

type Form = { name: string; parties: string[] };

const KEY = "draft-test";
const options = {
  steps: [{ id: "one", title: "One", fields: ["name", "parties"] as (keyof Form)[] }],
  schema: z.object({ name: z.string(), parties: z.array(z.string()) }),
  initialData: { name: "", parties: [] } as Form,
  onComplete: async () => {},
  persistence: { key: KEY, omit: ["parties"] as (keyof Form)[] },
};

afterEach(() => localStorage.clear());

describe("useMultiStepForm persistence", () => {
  it("leaves an omitted field out of the saved draft", () => {
    const { result } = renderHook(() => useMultiStepForm<Form>(options));

    act(() => result.current.updateFormData({ name: "Rua Augusta", parties: ["123456789"] }));

    const saved = localStorage.getItem(KEY) ?? "";
    expect(JSON.parse(saved).data).toEqual({ name: "Rua Augusta" });
    expect(saved).not.toContain("123456789");
  });

  it("restores a draft with the omitted field at its initial value", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ data: { name: "Rua Augusta" }, step: 0, timestamp: Date.now() }),
    );

    const { result } = renderHook(() => useMultiStepForm<Form>(options));

    expect(result.current.formData).toEqual({ name: "Rua Augusta", parties: [] });
  });
});

// Callers build `initialData` afresh on every render, so an array in it is a new array each time.
// Compared by reference, the lease wizard's untouched `parties: []` read as an edit: any write
// that changed nothing, and every reset, saved a draft and put a phantom "unsaved draft" banner
// on the next Add lease.
describe("useMultiStepForm draft detection", () => {
  // No `omit`: the comparison itself is under test. A new object, and a new array, every render.
  const fresh = () => ({
    ...options,
    initialData: { name: "", parties: [] } as Form,
    persistence: { key: KEY },
  });

  it("saves no draft when an update leaves every value as it was", () => {
    const { result, rerender } = renderHook(() => useMultiStepForm<Form>(fresh()));
    rerender();

    act(() => result.current.updateFormData({ name: "" }));

    expect(localStorage.getItem(KEY)).toBeNull();
    expect(result.current.hasDraft).toBe(false);
  });

  it("saves no draft when the form is reset", () => {
    const { result, rerender } = renderHook(() => useMultiStepForm<Form>(fresh()));
    rerender();

    act(() => result.current.resetForm());

    expect(localStorage.getItem(KEY)).toBeNull();
    expect(result.current.hasDraft).toBe(false);
  });

  it("saves a draft when an array's contents change", () => {
    const { result, rerender } = renderHook(() => useMultiStepForm<Form>(fresh()));
    rerender();

    act(() => result.current.updateFormData({ parties: ["123456789"] }));

    expect(JSON.parse(localStorage.getItem(KEY) ?? "{}").data?.parties).toEqual(["123456789"]);
  });

  it("saves no draft when only an omitted field changed", () => {
    const { result } = renderHook(() => useMultiStepForm<Form>(options));

    act(() => result.current.updateFormData({ parties: ["123456789"] }));

    expect(localStorage.getItem(KEY)).toBeNull();
    expect(result.current.hasDraft).toBe(false);
  });
});
