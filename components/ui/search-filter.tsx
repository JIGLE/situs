"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { debounce } from "./debounce";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Input } from "./input";
import { Button } from "./button";
import * as Popover from "./popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";
import { cn } from "@/lib/utils/utils";

export interface FilterOption {
  label: string;
  value: string;
}

interface Filter {
  key: string;
  label: string;
  options: FilterOption[];
  defaultValue?: string;
}

export interface SearchFilterProps {
  onSearchChange: (value: string) => void;
  onFilterChange?: (key: string, value: string) => void;
  searchPlaceholder?: string;
  filters?: Filter[];
  debounceMs?: number;
  className?: string;
  showClearButton?: boolean;
}

export function SearchFilter({
  onSearchChange,
  onFilterChange,
  searchPlaceholder = "Search...",
  filters = [],
  debounceMs = 300,
  className,
  showClearButton = true,
}: SearchFilterProps): React.ReactElement {
  const tActions = useTranslations("actions");
  const [searchValue, setSearchValue] = useState("");

  // Debounced search handler
  const debouncedOnSearchChange = useRef(
    debounce((value: string) => {
      onSearchChange(value);
    }, debounceMs),
  );

  useEffect(() => {
    debouncedOnSearchChange.current = debounce((value: string) => {
      onSearchChange(value);
    }, debounceMs);
    // Cancel on unmount
    return () => {
      debouncedOnSearchChange.current.cancel();
    };
  }, [onSearchChange, debounceMs]);

  useEffect(() => {
    debouncedOnSearchChange.current(searchValue);
  }, [searchValue]);

  const handleClear = useCallback(() => {
    setSearchValue("");
    debouncedOnSearchChange.current.cancel();
    onSearchChange("");
  }, [onSearchChange]);

  // Filter values are tracked here as well as reported upward, so the collapsed trigger can
  // say how many are active — a hidden active filter is worse than a visible dropdown.
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const valueFor = (filter: Filter): string =>
    filterValues[filter.key] ?? filter.defaultValue ?? "all";

  const handleFilterChange = useCallback(
    (key: string, value: string) => {
      setFilterValues((prev) => ({ ...prev, [key]: value }));
      if (onFilterChange) {
        onFilterChange(key, value);
      }
    },
    [onFilterChange],
  );

  /**
   * Past two dropdowns the set folds behind one "Filters" control — but only where the row
   * would actually be a wall. At `lg` and up there is room to show them all, and three visible
   * selects beat a popover you have to open to see what is filtered.
   *
   * Done in state rather than with `lg:hidden` so there is exactly one of each control in the
   * DOM: rendering both copies would duplicate every select's id, test hook and a11y node.
   * Both renders start wide, so hydration matches; the effect narrows it after mount.
   */
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)");
    const sync = () => setWide(mql.matches);
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, []);

  const collapse = filters.length > 2 && !wide;
  const activeCount = filters.filter((f) => valueFor(f) !== (f.defaultValue ?? "all")).length;

  const renderFilter = (filter: Filter): React.ReactElement => (
    <>
      <Select value={valueFor(filter)} onValueChange={(v) => handleFilterChange(filter.key, v)}>
        <SelectTrigger
          className={cn("w-full", !collapse && "sm:w-[180px]")}
          data-testid={`select-trigger-${filter.key}`}
        >
          <SelectValue placeholder={filter.label} />
        </SelectTrigger>
        <SelectContent>
          {filter.options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              data-testid={`select-item-${option.value}`}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {process.env.NODE_ENV === "test" && (
        <select
          data-testid={`native-select-${filter.key}`}
          value={valueFor(filter)}
          onChange={(e) => handleFilterChange(filter.key, e.target.value)}
          hidden
        >
          {filter.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </>
  );

  return (
    <div className={cn("flex flex-col sm:flex-row gap-3", className)}>
      {/* Search Input */}
      <div className="relative flex-1">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-muted-foreground)]"
          aria-hidden="true"
        />
        <Input
          type="search"
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          className="pl-9 pr-9"
        />
        {showClearButton && searchValue && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
            aria-label="Clear search"
            data-testid="clear-search-btn"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Clear search</span>
          </Button>
        )}
      </div>

      {/* Filter dropdowns — inline where they fit, folded behind one control where they don't
          (declutter rule 3). The trigger carries a count so an active filter is never hidden
          while collapsed. */}
      {collapse ? (
        <Popover.Root>
          <Popover.Trigger asChild>
            <Button
              variant="outline"
              className="justify-start gap-2 sm:w-auto"
              data-testid="filters-popover-trigger"
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              {tActions("filter")}
              {activeCount > 0 && (
                <span className="bg-[var(--color-popover)] px-1.5 py-0.5 font-mono text-[12px] md:text-[10px] tabular-nums">
                  {activeCount}
                </span>
              )}
            </Button>
          </Popover.Trigger>
          {/* The shared Popover.Content carries only a z-index, so the surface is the caller's
              job — without it the panel is transparent and the list shows through behind the
              selects. */}
          <Popover.Content
            align="end"
            sideOffset={6}
            className="w-64 space-y-3 border border-[var(--color-border)] bg-[var(--color-card-solid)] p-3"
          >
            {filters.map((filter) => (
              <div key={filter.key} className="space-y-1.5">
                <p className="mono-label">{filter.label}</p>
                {renderFilter(filter)}
              </div>
            ))}
          </Popover.Content>
        </Popover.Root>
      ) : (
        filters.map((filter) => <div key={filter.key}>{renderFilter(filter)}</div>)
      )}
    </div>
  );
}
