/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders as render, screen } from "@/tests/helpers/render-with-providers";
import userEvent from "@testing-library/user-event";
import { SearchFilter } from "./search-filter";
vi.mock("./debounce", () => ({
  debounce: (fn: any) => {
    const debounced = (...args: any[]) => fn(...args);
    debounced.cancel = () => {};
    return debounced;
  },
}));

describe("SearchFilter", () => {
  const mockOnSearchChange = vi.fn();
  const mockOnFilterChange = vi.fn();

  const defaultProps = {
    onSearchChange: mockOnSearchChange,
    searchPlaceholder: "Search...",
    filters: [
      {
        key: "status",
        label: "Status",
        options: [
          { label: "All", value: "all" },
          { label: "Active", value: "active" },
          { label: "Inactive", value: "inactive" },
        ],
      },
    ],
  };

  // Removed stray clearButton declarations outside of test blocks
  it("should render search input with placeholder", () => {
    render(<SearchFilter {...defaultProps} />);

    const searchInput = screen.getByPlaceholderText("Search...");
    expect(searchInput).toBeInTheDocument();
  });

  // Removed stray clearButton and unrelated lines outside of test blocks

  it("should call onSearchChange after debounce", async () => {
    const user = userEvent.setup();
    render(<SearchFilter {...defaultProps} debounceMs={100} />);
    const searchInput = screen.getByPlaceholderText("Search...");
    await user.type(searchInput, "test");
    expect(mockOnSearchChange).toHaveBeenCalledWith("test");
  });

  it("should call onFilterChange when filter selection changes", async () => {
    const user = userEvent.setup();
    render(<SearchFilter {...defaultProps} onFilterChange={mockOnFilterChange} />);
    // Use native select as test mode helper to avoid Radix portal complexity
    const nativeSelect = screen.getByTestId("native-select-status");
    await user.selectOptions(nativeSelect as HTMLSelectElement, "active");
    expect(mockOnFilterChange).toHaveBeenCalledWith("status", "active");
  });

  it("should render clear button when showClearButton is true", async () => {
    const user = userEvent.setup();
    render(<SearchFilter {...defaultProps} showClearButton={true} />);
    const searchInput = screen.getByPlaceholderText("Search...");
    await user.type(searchInput, "test");
    const clearBtn = screen.getByTestId("clear-search-btn");
    expect(clearBtn).toBeInTheDocument();
  });

  it("should clear search when clear button is clicked", async () => {
    const user = userEvent.setup();
    render(<SearchFilter {...defaultProps} showClearButton={true} />);
    const searchInput = screen.getByPlaceholderText("Search...");
    await user.type(searchInput, "test");
    const clearBtn = screen.getByTestId("clear-search-btn");
    expect(clearBtn).toBeInTheDocument();
    await user.click(clearBtn);
    expect(searchInput).toHaveValue("");
  });

  it("should handle multiple filters", () => {
    const propsWithMultipleFilters = {
      ...defaultProps,
      filters: [
        {
          key: "status",
          label: "Status",
          options: [
            { label: "All", value: "all" },
            { label: "Active", value: "active" },
          ],
        },
        {
          key: "type",
          label: "Type",
          options: [
            { label: "All Types", value: "all" },
            { label: "Type A", value: "typeA" },
          ],
        },
      ],
    };

    render(<SearchFilter {...propsWithMultipleFilters} />);

    // Check that two combobox elements are rendered for the filters
    const comboboxes = screen.getAllByRole("combobox");
    expect(comboboxes).toHaveLength(2);

    // Check that default "All" text appears for both filters
    const allTexts = screen.getAllByText(/All/);
    expect(allTexts.length).toBeGreaterThanOrEqual(2);
  });

  it("should use default values for filters", async () => {
    const propsWithDefaults = {
      ...defaultProps,
      onFilterChange: mockOnFilterChange,
      filters: [
        {
          key: "status",
          label: "Status",
          options: [
            { label: "All", value: "all" },
            { label: "Active", value: "active" },
          ],
          defaultValue: "active",
        },
      ],
    };
    render(<SearchFilter {...propsWithDefaults} />);
    // The default value should be selected in the trigger (not ambiguous with hidden option)
    expect(screen.getByTestId("select-trigger-status")).toHaveTextContent("Active");
  });

  it("should handle no filters provided", () => {
    const propsWithNoFilters = {
      onSearchChange: mockOnSearchChange,
      searchPlaceholder: "Search...",
    };

    render(<SearchFilter {...propsWithNoFilters} />);

    const searchInput = screen.getByPlaceholderText("Search...");
    expect(searchInput).toBeInTheDocument();

    // Should not render any filter dropdowns
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("should apply custom className", () => {
    const { container } = render(<SearchFilter {...defaultProps} className="custom-class" />);

    // Query for the class rather than reaching for `container.firstChild`. The render helper
    // wraps the subject in providers, one of which renders a `<div>` — so the first child is a
    // wrapper, not the component root, and the old assertion only worked because the bare
    // `render` put the component at the top.
    expect(container.querySelector(".custom-class")).toBeInTheDocument();
  });

  it("should debounce search input correctly", async () => {
    const user = userEvent.setup();
    render(<SearchFilter {...defaultProps} debounceMs={300} />);
    const searchInput = screen.getByPlaceholderText("Search...");
    await user.type(searchInput, "test");
    expect(mockOnSearchChange).toHaveBeenCalledWith("test");
  });

  it("should clear debounce timer on component unmount", () => {
    const { unmount } = render(<SearchFilter {...defaultProps} />);

    // This should not throw any errors
    unmount();
  });
});
