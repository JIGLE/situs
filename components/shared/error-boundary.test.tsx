import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderWithProviders as render, screen } from "@/tests/helpers/render-with-providers";
import React from "react";
import { ErrorBoundary } from "./error-boundary";

function Bomb(): React.ReactElement {
  throw new Error("boom");
  // unreachable, but provide a React node so TypeScript recognizes this as a component
  return <div />;
}

describe("ErrorBoundary", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // React error boundaries intentionally trigger console.error for thrown child errors.
    // Suppress expected noise while still allowing assertions on behavior.
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("renders default fallback when child throws", () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );

    // The next-intl mock returns the key, so assert the key rather than the English copy.
    expect(screen.getByText("Something went wrong")).toBeDefined();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("uses custom fallback when provided", () => {
    const Fallback = ({ error, resetError }: { error?: Error; resetError: () => void }) => (
      <div>
        <span>Custom: {error?.message}</span>
        <button onClick={resetError}>Reset</button>
      </div>
    );

    render(
      <ErrorBoundary fallback={Fallback}>
        <Bomb />
      </ErrorBoundary>,
    );

    expect(screen.getByText(/Custom: boom/)).toBeDefined();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
