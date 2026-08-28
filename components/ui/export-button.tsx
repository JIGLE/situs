"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { cn } from "@/lib/utils/utils";
import { Button } from "./button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";

export interface ExportColumn {
  key: string;
  label: string;
  format?: (value: unknown) => string;
}

export interface ExportButtonProps {
  data: unknown[];
  filename: string;
  columns: ExportColumn[];
  disabled?: boolean;
  className?: string;
  onExport?: () => void;
}

function formatValue(value: unknown, format?: (value: unknown) => string): string {
  if (format) {
    return format(value);
  }
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function escapeCSVValue(value: string): string {
  // If the value contains commas, quotes, or newlines, wrap it in quotes
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    // Escape any existing quotes by doubling them
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function generateCSV(data: unknown[], columns: ExportColumn[]): string {
  // Header row
  const headers = columns.map((col) => escapeCSVValue(col.label)).join(",");

  // Data rows
  const rows = data.map((item) => {
    return columns
      .map((col) => {
        const record = item as Record<string, unknown>;
        const value = record[col.key];
        const formattedValue = formatValue(value, col.format);
        return escapeCSVValue(formattedValue);
      })
      .join(",");
  });

  return [headers, ...rows].join("\n");
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function ExportButton({
  data,
  filename,
  columns,
  disabled = false,
  className,
  onExport,
}: ExportButtonProps) {
  const handleExportCSV = () => {
    const csv = generateCSV(data, columns);
    downloadFile(csv, `${filename}.csv`, "text/csv;charset=utf-8;");
    onExport?.();
  };

  const handleExportJSON = () => {
    // Create a simplified JSON with only the specified columns
    const exportData = data.map((item) => {
      const record = item as Record<string, unknown>;
      const row: Record<string, unknown> = {};
      columns.forEach((col) => {
        const value = record[col.key];
        row[col.label] = col.format ? col.format(value) : value;
      });
      return row;
    });

    const json = JSON.stringify(exportData, null, 2);
    downloadFile(json, `${filename}.json`, "application/json");
    onExport?.();
  };

  const isDisabled = disabled || data.length === 0;
  // This button appears on Leases, Finances, Assets, Operations and People, and all three of its
  // labels were English literals — so five surfaces showed "Export" next to a translated primary
  // action. `actions.export` already existed; the two menu items are new in all four catalogues.
  const t = useTranslations("actions");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={isDisabled}
          className={cn("flex items-center gap-2", className)}
        >
          <Download className="h-4 w-4" />
          {t("export")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onClick={handleExportCSV} className="cursor-pointer">
          <FileSpreadsheet className="h-4 w-4 mr-2" />
          {t("exportCsv")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleExportJSON} className="cursor-pointer">
          <FileText className="h-4 w-4 mr-2" />
          {t("exportJson")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
