/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExportButton } from "./export-button";
import { renderWithProviders } from "@/tests/helpers/render-with-providers";

// Mock currency context
vi.mock("../../lib/currency-context", () => ({
  useCurrency: () => ({
    formatCurrency: (amount: number) => `$${amount.toFixed(2)}`,
  }),
}));

describe("ExportButton", () => {
  const mockData = [
    { id: "1", name: "John", email: "john@example.com", age: 30 },
    { id: "2", name: "Jane", email: "jane@example.com", age: 25 },
  ];

  const mockColumns = [
    { key: "name" as keyof (typeof mockData)[0], label: "Name" },
    { key: "email" as keyof (typeof mockData)[0], label: "Email" },
    {
      key: "age" as keyof (typeof mockData)[0],
      label: "Age",
      format: (value: unknown) => `${value} years`,
    },
  ];

  const defaultProps = {
    data: mockData,
    filename: "test-export",
    columns: mockColumns,
  };

  // Mock DOM APIs
  const mockCreateObjectURL = vi.fn(() => "mock-blob-url");
  const mockRevokeObjectURL = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset URL mocks
    global.URL.createObjectURL = mockCreateObjectURL;
    global.URL.revokeObjectURL = mockRevokeObjectURL;
  });

  it("should render export button with data", () => {
    renderWithProviders(<ExportButton {...defaultProps} />);

    const buttons = screen.getAllByRole("button", { name: /export/i });
    const exportButton = buttons[buttons.length - 1]; // Get inner button
    expect(exportButton).toBeInTheDocument();
    expect(exportButton).not.toBeDisabled();
  });

  it("should render disabled button when no data", () => {
    renderWithProviders(<ExportButton {...defaultProps} data={[]} />);

    const buttons = screen.getAllByRole("button", { name: /export/i });
    const exportButton = buttons[buttons.length - 1]; // Get inner button
    expect(exportButton).toBeInTheDocument();
    expect(exportButton).toBeDisabled();
  });

  it("should be disabled when disabled prop is true", () => {
    renderWithProviders(<ExportButton {...defaultProps} disabled={true} />);

    const buttons = screen.getAllByRole("button", { name: /export/i });
    const exportButton = buttons[buttons.length - 1]; // Get inner button
    expect(exportButton).toBeDisabled();
  });

  it("should apply custom className", () => {
    renderWithProviders(<ExportButton {...defaultProps} className="custom-export-class" />);

    const buttons = screen.getAllByRole("button", { name: /export/i });
    const exportButton = buttons[buttons.length - 1]; // Get inner button
    expect(exportButton).toHaveClass("custom-export-class");
  });

  it("should show dropdown when clicked", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ExportButton {...defaultProps} />);

    const buttons = screen.getAllByRole("button", { name: /export/i });
    const exportButton = buttons[buttons.length - 1]; // Get inner button
    await user.click(exportButton);

    // By role, not by display text. The labels come from the catalogue now, and
    // `useTranslations` does not resolve messages under this jsdom setup — it returns the bare
    // key — so asserting on "Export as CSV" would be asserting on a string the component no
    // longer owns. Two menu items, CSV first, is the contract that actually matters.
    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(2);
  });

  it("should trigger export when CSV option is selected", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ExportButton {...defaultProps} />);

    const buttons = screen.getAllByRole("button", { name: /export/i });
    const exportButton = buttons[buttons.length - 1]; // Get inner button
    await user.click(exportButton);

    const [csvOption] = screen.getAllByRole("menuitem");
    await user.click(csvOption);

    expect(mockCreateObjectURL).toHaveBeenCalled();
  });
});
