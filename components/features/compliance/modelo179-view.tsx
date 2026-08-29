"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  FileCheck2,
  Download,
  CheckCircle2,
  Clock,
  XCircle,
  AlertCircle,
  ChevronDown,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/lib/contexts/toast-context";
import { csrfHeaders } from "@/lib/utils/api-client";
import { RenderTable } from "@/components/ui/table";

type SubmissionStatus = "pending" | "submitted" | "confirmed" | "rejected";

interface Modelo179Submission {
  id: string;
  periodYear: number;
  status: SubmissionStatus;
  atReference: string | null;
  notes: string | null;
  submittedAt: string | null;
  createdAt: string;
}

interface LeaseRow {
  id: string;
  startDate: string;
  endDate: string;
  monthlyRent: number;
  status: string;
  property: { id: string; name: string; address: string };
  tenant: { id: string; name: string; email: string };
  modelo179Submissions: Modelo179Submission[];
}

const statusConfig: Record<
  SubmissionStatus,
  { icon: React.ElementType; label: string; badgeClass: string }
> = {
  pending: {
    icon: Clock,
    label: "Pending",
    badgeClass: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  submitted: {
    icon: AlertCircle,
    label: "Submitted",
    badgeClass: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400",
  },
  confirmed: {
    icon: CheckCircle2,
    label: "Confirmed",
    badgeClass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  rejected: {
    icon: XCircle,
    label: "Rejected",
    badgeClass:
      "border-[var(--color-destructive)]/30 bg-[var(--color-destructive)]/10 text-[var(--color-destructive)]",
  },
};

function StatusBadge({ status }: { status: SubmissionStatus }) {
  const cfg = statusConfig[status];
  const Icon = cfg.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${cfg.badgeClass}`}
    >
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

function getSubmissionForYear(lease: LeaseRow, year: number): Modelo179Submission | undefined {
  return lease.modelo179Submissions.find((s) => s.periodYear === year);
}

function generateCsv(leases: LeaseRow[], year: number): string {
  const rows: string[][] = [
    [
      "Lease ID",
      "Property",
      "Address",
      "Tenant",
      "Tenant Email",
      "Lease Start",
      "Lease End",
      "Monthly Rent (EUR)",
      "Modelo 179 Status",
      "AT Reference",
      "Submitted At",
    ],
  ];

  for (const lease of leases) {
    const submission = getSubmissionForYear(lease, year);
    rows.push([
      lease.id,
      lease.property.name,
      lease.property.address,
      lease.tenant.name,
      lease.tenant.email,
      lease.startDate.slice(0, 10),
      lease.endDate.slice(0, 10),
      String(lease.monthlyRent),
      submission?.status ?? "pending",
      submission?.atReference ?? "",
      submission?.submittedAt ? submission.submittedAt.slice(0, 10) : "",
    ]);
  }

  return rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n");
}

export function Modelo179View(): React.ReactElement {
  const t = useTranslations("compliance");
  const tActions = useTranslations("actions");
  const { success, error: showError } = useToast();
  const currentYear = new Date().getFullYear();

  const [year, setYear] = useState<number>(currentYear);
  const [leases, setLeases] = useState<LeaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedLease, setSelectedLease] = useState<LeaseRow | null>(null);
  const [atRefInput, setAtRefInput] = useState("");
  const [saving, setSaving] = useState(false);

  const yearOptions = Array.from({ length: 6 }, (_, i) => currentYear - i);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/compliance/modelo179?year=${year}`);
      if (res.ok) {
        const json = await res.json();
        setLeases((json.data as LeaseRow[]) ?? []);
      } else {
        showError("Failed to load Modelo 179 data");
      }
    } catch {
      showError("Failed to load Modelo 179 data");
    } finally {
      setLoading(false);
    }
  }, [year, showError]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const openMarkDialog = (lease: LeaseRow) => {
    setSelectedLease(lease);
    const existing = getSubmissionForYear(lease, year);
    setAtRefInput(existing?.atReference ?? "");
    setDialogOpen(true);
  };

  const handleMarkSubmitted = async () => {
    if (!selectedLease) return;
    setSaving(true);
    try {
      const res = await fetch("/api/compliance/modelo179", {
        method: "POST",
        headers: csrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          leaseId: selectedLease.id,
          periodYear: year,
          status: "submitted",
          atReference: atRefInput || null,
          submittedAt: new Date().toISOString(),
        }),
      });
      if (res.ok) {
        success("Modelo 179 marked as submitted");
        setDialogOpen(false);
        await loadData();
      } else {
        showError("Failed to update submission");
      }
    } catch {
      showError("Failed to update submission");
    } finally {
      setSaving(false);
    }
  };

  const handleExportCsv = () => {
    const csv = generateCsv(leases, year);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `modelo179_${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const submittedCount = leases.filter((l) => {
    const s = getSubmissionForYear(l, year);
    return s && s.status !== "pending";
  }).length;

  const totalCount = leases.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)] flex items-center gap-2">
            <FileCheck2 className="h-6 w-6" />
            {t("modelo179Title")}
          </h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">{t("modelo179Subtitle")}</p>
        </div>
        <Button variant="outline" onClick={handleExportCsv} disabled={leases.length === 0}>
          <Download className="h-4 w-4 mr-2" />
          {t("modelo179Export")}
        </Button>
      </div>

      {/* Year selector + summary */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Label className="text-sm font-medium">Year</Label>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-32">
              <SelectValue />
              <ChevronDown className="h-4 w-4 opacity-50" />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {!loading && (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {submittedCount} of {totalCount} leases submitted for {year}
          </p>
        )}
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>{t("modelo179Status")}</CardTitle>
          <CardDescription>{t("modelo179Subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
            </div>
          ) : leases.length === 0 ? (
            <p className="text-sm text-[var(--color-muted-foreground)] text-center py-8">
              No active leases found.
            </p>
          ) : (
            <RenderTable
              data={leases}
              rowKey={(lease) => lease.id}
              cardMode
              renderCard={(lease) => {
                const status: SubmissionStatus =
                  getSubmissionForYear(lease, year)?.status ?? "pending";
                const atRef = getSubmissionForYear(lease, year)?.atReference;
                return (
                  <div className="border border-[var(--color-border)] bg-[var(--color-card)] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{lease.tenant.name}</p>
                        <p className="truncate text-xs text-[var(--color-muted-foreground)]">
                          {lease.property.name}
                        </p>
                      </div>
                      <StatusBadge status={status} />
                    </div>
                    <p className="mt-2 text-xs tabular-nums text-[var(--color-muted-foreground)]">
                      {new Date(lease.startDate).getFullYear()} –{" "}
                      {new Date(lease.endDate).getFullYear()}
                      {atRef ? ` · ${atRef}` : ""}
                    </p>
                    {status !== "confirmed" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-3 w-full"
                        onClick={() => openMarkDialog(lease)}
                      >
                        {t("modelo179MarkSubmitted")}
                      </Button>
                    )}
                  </div>
                );
              }}
              columns={[
                {
                  key: "tenant",
                  header: t("modelo179Tenant"),
                  cell: (lease) => (
                    <>
                      <div className="font-medium">{lease.tenant.name}</div>
                      <div className="text-xs text-[var(--color-muted-foreground)]">
                        {lease.tenant.email}
                      </div>
                    </>
                  ),
                },
                {
                  key: "property",
                  header: t("modelo179Property"),
                  cell: (lease) => (
                    <>
                      <div>{lease.property.name}</div>
                      <div className="text-xs text-[var(--color-muted-foreground)]">
                        {lease.property.address}
                      </div>
                    </>
                  ),
                },
                {
                  key: "period",
                  header: t("modelo179Period"),
                  cell: (lease) =>
                    `${new Date(lease.startDate).getFullYear()} – ${new Date(lease.endDate).getFullYear()}`,
                  cellClassName: "tabular-nums",
                },
                {
                  key: "status",
                  header: t("modelo179Status"),
                  cell: (lease) => (
                    <StatusBadge status={getSubmissionForYear(lease, year)?.status ?? "pending"} />
                  ),
                },
                {
                  key: "atRef",
                  header: t("modelo179ATRef"),
                  cell: (lease) => getSubmissionForYear(lease, year)?.atReference ?? "—",
                  cellClassName: "text-[var(--color-muted-foreground)]",
                },
                {
                  key: "actions",
                  header: t("modelo179Actions"),
                  headerClassName: "text-right",
                  cellClassName: "text-right",
                  cell: (lease) =>
                    (getSubmissionForYear(lease, year)?.status ?? "pending") !== "confirmed" ? (
                      <Button size="sm" variant="outline" onClick={() => openMarkDialog(lease)}>
                        {t("modelo179MarkSubmitted")}
                      </Button>
                    ) : null,
                },
              ]}
            />
          )}
        </CardContent>
      </Card>

      {/* Mark as Submitted dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("modelo179DialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("modelo179DialogDescription", {
                tenant: selectedLease?.tenant.name ?? "—",
                property: selectedLease?.property.name ?? "—",
                year,
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="at-reference">{t("modelo179ATRef")}</Label>
              <Input
                id="at-reference"
                placeholder={t("modelo179ATRefPlaceholder")}
                value={atRefInput}
                onChange={(e) => setAtRefInput(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {tActions("cancel")}
            </Button>
            <Button onClick={handleMarkSubmitted} disabled={saving}>
              {saving ? t("modelo179Saving") : t("modelo179MarkSubmitted")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default Modelo179View;
