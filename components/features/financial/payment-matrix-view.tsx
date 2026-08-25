import { useState, useMemo } from "react";
import { useTranslations, useLocale } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useApp } from "@/lib/contexts/app-context";
import { useCurrency } from "@/lib/contexts/currency-context";
import { withEntityDetail } from "@/lib/utils/entity-detail-url";
import { Tenant } from "@/lib/types";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DollarSign, CheckCircle, Clock, XCircle, Filter } from "lucide-react";

export type PaymentMatrixViewProps = Record<string, never>;

interface PaymentCell {
  status: "paid" | "pending" | "overdue" | "none";
  date?: string;
  amount?: number;
  receiptId?: string;
}

export function PaymentMatrixView(): React.ReactElement {
  const { state } = useApp();
  const { tenants, receipts } = state;
  const { formatCurrency } = useCurrency();
  const t = useTranslations("paymentMatrix");
  const tMonths = useTranslations("calendar.months");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [statusFilter, setStatusFilter] = useState<"all" | "paid" | "pending" | "overdue">("all");

  // Generate months array
  const monthKeys = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ];
  const months = monthKeys.map((key) => tMonths(key));

  // Get unique years from receipts
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    receipts.forEach((receipt) => {
      const year = new Date(receipt.date).getFullYear();
      years.add(year);
    });
    // Add current year if no receipts
    if (years.size === 0) {
      years.add(new Date().getFullYear());
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [receipts]);

  // Build payment matrix data
  const paymentMatrix = useMemo(() => {
    const matrix: Record<string, PaymentCell[]> = {};

    tenants.forEach((tenant) => {
      matrix[tenant.id] = new Array(12).fill(null).map(() => ({
        status: "none" as const,
      }));

      // Find receipts for this tenant in the selected year
      const tenantReceipts = receipts.filter(
        (receipt) =>
          receipt.tenantId === tenant.id &&
          receipt.type === "rent" &&
          new Date(receipt.date).getFullYear() === selectedYear,
      );

      tenantReceipts.forEach((receipt) => {
        const month = new Date(receipt.date).getMonth();
        const status: PaymentCell["status"] = receipt.status === "paid" ? "paid" : "pending";

        matrix[tenant.id][month] = {
          status,
          date: receipt.date,
          amount: receipt.amount,
          receiptId: receipt.id,
        };
      });

      // Mark overdue payments (no payment in previous months of current year)
      const currentMonth = new Date().getMonth();
      const currentYear = new Date().getFullYear();

      if (selectedYear === currentYear) {
        for (let month = 0; month <= currentMonth; month++) {
          if (matrix[tenant.id][month].status === "none") {
            matrix[tenant.id][month] = {
              status: "overdue",
            };
          }
        }
      }
    });

    return matrix;
  }, [tenants, receipts, selectedYear]);

  const getCellIcon = (cell: PaymentCell) => {
    switch (cell.status) {
      case "paid":
        return <CheckCircle className="h-4 w-4 text-[var(--color-success)]" />;
      case "pending":
        return <Clock className="h-4 w-4 text-[var(--color-warning)]" />;
      case "overdue":
        return <XCircle className="h-4 w-4 text-[var(--color-error)]" />;
      default:
        return <div className="h-4 w-4 rounded-full bg-[var(--color-muted)]" />;
    }
  };

  const getCellColor = (cell: PaymentCell) => {
    switch (cell.status) {
      case "paid":
        return "bg-[var(--color-success)]/10 border-[var(--color-success)]/30 hover:bg-[var(--color-success)]/20";
      case "pending":
        return "bg-[var(--color-warning)]/10 border-[var(--color-warning)]/30 hover:bg-[var(--color-warning)]/20";
      case "overdue":
        return "bg-[var(--color-error)]/10 border-[var(--color-error)]/30 hover:bg-[var(--color-error)]/20";
      default:
        return "bg-[var(--color-muted)]/10 border-[var(--color-border)] hover:bg-[var(--color-muted)]/20";
    }
  };

  // Filter tenants based on status
  const filteredTenants = useMemo(() => {
    if (statusFilter === "all") return tenants;
    return tenants.filter((tenant) => {
      const tenantCells = paymentMatrix[tenant.id] || [];
      return tenantCells.some((cell) => cell.status === statusFilter);
    });
  }, [tenants, paymentMatrix, statusFilter]);

  const getTotalPaid = (tenantId: string) => {
    return (
      paymentMatrix[tenantId]?.reduce((total, cell) => {
        return total + (cell.status === "paid" ? cell.amount || 0 : 0);
      }, 0) || 0
    );
  };

  const getTotalExpected = (tenant: Tenant) => {
    // Calculate expected payments based on lease terms
    // This is a simplified calculation - in reality you'd check lease dates
    const paidMonths =
      paymentMatrix[tenant.id]?.filter((cell) => cell.status === "paid").length || 0;
    return paidMonths * tenant.rent;
  };

  // One summary line instead of four boxed cards (CLAUDE.md declutter rule 4) —
  // the container's own KPI row above the tab bar already covers this-month
  // figures, so this line only needs to carry the year total for this matrix.
  const yearSummary = useMemo(() => {
    const expected = tenants.reduce((total, tenant) => total + getTotalExpected(tenant), 0);
    const received = tenants.reduce((total, tenant) => total + getTotalPaid(tenant.id), 0);
    const rate = expected > 0 ? Math.round((received / expected) * 100) : 0;
    return { expected, received, outstanding: expected - received, rate };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenants, paymentMatrix]);

  if (tenants.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <DollarSign className="h-12 w-12 text-[var(--color-muted-foreground)] mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-[var(--color-foreground)] mb-2">
            {t("noTenantsYet")}
          </h3>
          <p className="text-[var(--color-muted-foreground)]">{t("addTenantsToTrack")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* One utility row: the year summary as text (declutter rule 4), plus the
          status/year filters — no separate heading, no card grid. */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        {/* Scoped to the selected year, and labelled as such. Unlabelled it read as a second
            account-level status row under the container's four panels — and its "outstanding"
            (year to date) sat directly under their "Overdue rent" (right now) showing a
            different number, so the two looked like they disagreed. Outstanding is dropped
            here: the panel above is the one you can click through to act on. */}
        <p className="text-sm text-[var(--color-muted-foreground)]">
          <span className="mono-label mr-2">{selectedYear}</span>
          {formatCurrency(yearSummary.expected)} {t("totalExpected").toLowerCase()} ·{" "}
          {formatCurrency(yearSummary.received)} {t("totalReceived").toLowerCase()} ·{" "}
          {yearSummary.rate}% {t("collectionRate").toLowerCase()}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {/* Status Filter */}
          <Select
            value={statusFilter}
            onValueChange={(v: typeof statusFilter) => setStatusFilter(v)}
          >
            {/* `min-w-32 w-auto`, not `w-32`. 128px was measured against English ("All Status")
                and Portuguese ("Todos os Estados") does not fit — it truncated to "Todos o…",
                which tells a reader nothing about what is filtered. A floor plus content sizing
                keeps the control compact when the label is short and legible when it is not. */}
            <SelectTrigger className="min-w-32 w-auto">
              <Filter className="h-4 w-4 shrink-0" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allStatus")}</SelectItem>
              <SelectItem value="paid">{t("paid")}</SelectItem>
              <SelectItem value="pending">{t("pending")}</SelectItem>
              <SelectItem value="overdue">{t("overdue")}</SelectItem>
            </SelectContent>
          </Select>

          {/* Year Selector */}
          <Select
            value={selectedYear.toString()}
            onValueChange={(value) => setSelectedYear(parseInt(value))}
          >
            <SelectTrigger className="min-w-24 w-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableYears.map((year) => (
                <SelectItem key={year} value={year.toString()}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Payment Matrix — legend lives in the header of the one card that
          needs it, instead of a second card repeating the same four states. */}
      <Card className="bg-[var(--color-card)] border-[var(--color-border)]">
        <CardHeader>
          <div className="flex flex-wrap gap-6">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-[var(--color-success)]" />
              <span className="text-sm text-[var(--color-muted-foreground)]">{t("paid")}</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-[var(--color-warning)]" />
              <span className="text-sm text-[var(--color-muted-foreground)]">{t("pending")}</span>
            </div>
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-[var(--color-error)]" />
              <span className="text-sm text-[var(--color-muted-foreground)]">{t("overdue")}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-[var(--color-muted)]" />
              <span className="text-sm text-[var(--color-muted-foreground)]">
                {t("noPaymentDue")}
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  <th
                    scope="col"
                    className="sticky left-0 z-10 bg-[var(--color-card)] text-left py-3 px-4 font-medium text-[var(--color-muted-foreground)]"
                  >
                    {t("tenant")}
                  </th>
                  {months.map((month) => (
                    <th
                      key={month}
                      scope="col"
                      className="text-center py-3 px-2 font-medium text-[var(--color-muted-foreground)] text-sm"
                    >
                      {month}
                    </th>
                  ))}
                  <th
                    scope="col"
                    className="text-right py-3 px-4 font-medium text-[var(--color-muted-foreground)]"
                  >
                    {t("total")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredTenants.map((tenant) => (
                  <tr
                    key={tenant.id}
                    className="border-b border-[var(--color-border)] hover:bg-[var(--color-hover)] transition-colors duration-200"
                  >
                    <td className="sticky left-0 z-10 bg-[var(--color-card)] py-3 px-4">
                      <button
                        type="button"
                        onClick={() =>
                          router.push(
                            withEntityDetail(
                              pathname,
                              searchParams.toString(),
                              "tenant",
                              tenant.id,
                            ),
                          )
                        }
                        className="flex items-center font-medium text-[var(--color-foreground)] hover:underline text-left max-md:min-h-11"
                      >
                        {tenant.name}
                      </button>
                      <div className="text-sm text-[var(--color-muted-foreground)]">
                        {formatCurrency(tenant.rent)}
                        {t("perMonth")}
                      </div>
                    </td>
                    {months.map((month, monthIndex) => {
                      const cell = paymentMatrix[tenant.id]?.[monthIndex] || { status: "none" };
                      return (
                        <td key={month} className="py-3 px-2 text-center">
                          <div
                            className={`inline-flex items-center justify-center w-8 h-8 rounded border ${getCellColor(cell)} cursor-pointer transition-colors`}
                            title={
                              cell.date
                                ? t("cellTooltip", {
                                    status: t(cell.status),
                                    date: new Date(cell.date).toLocaleDateString(locale),
                                    amount: formatCurrency(cell.amount || 0),
                                  })
                                : cell.status === "overdue"
                                  ? t("overdueTooltip")
                                  : t("noPaymentTooltip")
                            }
                          >
                            {getCellIcon(cell)}
                          </div>
                        </td>
                      );
                    })}
                    <td className="py-3 px-4 text-right">
                      <div className="font-medium text-[var(--color-foreground)]">
                        {formatCurrency(getTotalPaid(tenant.id))}
                      </div>
                      <div className="text-sm text-[var(--color-muted-foreground)]">
                        {t("ofExpected", {
                          amount: formatCurrency(getTotalExpected(tenant)),
                        })}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
