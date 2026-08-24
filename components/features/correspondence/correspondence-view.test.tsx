import { describe, it, expect, vi } from "vitest";
import { renderWithProviders as render, screen } from "@/tests/helpers/render-with-providers";
import { CorrespondenceView } from "./correspondence-view";

vi.mock("@/lib/contexts/app-context", () => ({
  useApp: () => ({
    state: { templates: [], correspondence: [], tenants: [], loading: false },
    addTemplate: vi.fn(),
    updateTemplate: vi.fn(),
    deleteTemplate: vi.fn(),
    addCorrespondence: vi.fn(),
  }),
}));

vi.mock("@/lib/contexts/toast-context", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

describe("CorrespondenceView", () => {
  // The next-intl mock in tests/setup returns the key, so assert on the key rather than the
  // English copy — otherwise the test pins a translation and breaks whenever it is reworded.
  it("shows empty templates state", () => {
    render(<CorrespondenceView />);
    expect(screen.getByText("No templates yet")).toBeDefined();
  });
});
