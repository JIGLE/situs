/**
 * Design Tokens — JS-accessible palette mirroring CSS custom properties in globals.css
 *
 * Use these tokens in chart/analytics components that need raw hex strings
 * (e.g. SVG fills, canvas rendering). For Tailwind classes, prefer the
 * CSS custom property variants like `text-[var(--color-primary)]`.
 */

export const tokens = {
  // ── Semantic Colors ──────────────────────────────
  primary: "#6366F1",
  accentSecondary: "#8B5CF6",
  success: "#10B981",
  warning: "#F59E0B",
  destructive: "#F43F5E",
  info: "#3B82F6",
  muted: "#6B7280",

  // ── Chart: Property Types ────────────────────────
  chartPropertyType: {
    apartment: "#6366F1",
    house: "#10B981",
    commercial: "#F59E0B",
    garage: "#64748B",
    other: "#94A3B8",
  } as Record<string, string>,

  // ── Chart: Expense Categories ────────────────────
  chartExpenseCategory: {
    maintenance: "#EF4444",
    utilities: "#F59E0B",
    insurance: "#3B82F6",
    taxes: "#8B5CF6",
    management: "#10B981",
    other: "#6B7280",
  } as Record<string, string>,

  // ── Chart: Status / Semantic ─────────────────────
  chartStatus: {
    positive: "#22C55E",
    negative: "#EF4444",
    pending: "#EF4444",
    paid: "#3B82F6",
    completed: "#10B981",
    inProgress: "#F59E0B",
    neutral: "#6B7280",
  },

  // ── Occupancy Gauge Thresholds ───────────────────
  occupancy: {
    high: "#22C55E", // ≥ 90%
    medium: "#EAB308", // ≥ 70%
    low: "#EF4444", // < 70%
  },

  // ── Surfaces (mirrors CSS --color-surface-N) ────
  surfaces: {
    s0: "#020617",
    s1: "rgba(15, 23, 42, 0.8)",
    s2: "rgba(22, 27, 38, 0.8)",
    s3: "rgba(30, 36, 51, 0.9)",
  },

  // ── Status (mirrors CSS semantic vars) ───────────
  status: {
    success: "#10B981",
    successMuted: "rgba(16, 185, 129, 0.1)",
    warning: "#F59E0B",
    warningMuted: "rgba(245, 158, 11, 0.1)",
    error: "#F43F5E",
    errorMuted: "rgba(244, 63, 94, 0.1)",
    info: "#6366F1",
    infoMuted: "rgba(99, 102, 241, 0.1)",
  },

  // ── Borders ──────────────────────────────────────
  border: {
    subtle: "rgba(255, 255, 255, 0.05)",
    hover: "rgba(255, 255, 255, 0.1)",
    active: "rgba(99, 102, 241, 0.3)",
  },
} as const;

/** Return the occupancy gauge color for a given rate (0-100). */
export function getOccupancyColor(rate: number): string {
  if (rate >= 90) return tokens.occupancy.high;
  if (rate >= 70) return tokens.occupancy.medium;
  return tokens.occupancy.low;
}

/** Return the chart color for a property type. */
export function getPropertyTypeColor(type: string): string {
  return tokens.chartPropertyType[type] || tokens.chartPropertyType.other;
}

/** Return the chart color for an expense category. */
export function getExpenseCategoryColor(category: string): string {
  return tokens.chartExpenseCategory[category] || tokens.chartExpenseCategory.other;
}
