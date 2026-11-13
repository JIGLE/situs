"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { useApp } from "@/lib/contexts/app-context";
import { useCsrf } from "@/lib/contexts/csrf-context";
import { useCurrency } from "@/lib/contexts/currency-context";
import { useToast } from "@/lib/contexts/toast-context";
import { useConfirmDialog } from "@/lib/hooks/use-confirm-dialog";
import { useRoutePathname } from "@/lib/hooks/use-route-pathname";
import { useEntityDetailClose } from "@/lib/hooks/use-entity-detail-close";
import { apiFetch } from "@/lib/utils/api-client";
import { useApiError } from "@/lib/utils/api-error";
import { withEntityDetail } from "@/lib/utils/entity-detail-url";
import { expenseCategoryKey } from "@/lib/utils/expense-labels";
import { formatDate } from "@/lib/utils/format-date";
import type { BuildingExpenseInput } from "@/lib/schemas/building-expense.schema";
import type { BuildingExpenseView } from "@/lib/services/buildings/expenses";
import { BuildingUnitsEditor, type UnitChoice } from "./building-units-editor";
import { BuildingExpenseForm } from "./building-expense-form";

/**
 * A building: its units with their permilagens, and its shared expenses, each split into the
 * units' parts. Opened as `?detail=building:<id>` from the Portfolio tree, a property's detail and
 * a building expense's part in Finance.
 */
export function BuildingDetailView({ buildingId }: { buildingId: string }): React.ReactElement {
  const t = useTranslations("buildings");
  const tActions = useTranslations("actions");
  const tCategories = useTranslations("financial.categories");
  const locale = useLocale();
  const router = useRouter();
  const pathname = useRoutePathname();
  const searchParams = useSearchParams();
  const close = useEntityDetailClose();
  const { state, updateBuilding, deleteBuilding, refreshData } = useApp();
  const { token: csrfToken } = useCsrf();
  const { formatCurrency } = useCurrency();
  const { success, error: showError } = useToast();
  const apiError = useApiError();
  const confirmDialog = useConfirmDialog();

  const building = state.buildings.find((b) => b.id === buildingId);
  const units = useMemo(
    () =>
      state.properties
        .filter((p) => p.buildingId === buildingId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [state.properties, buildingId],
  );

  const [editingDetails, setEditingDetails] = useState(false);
  const [details, setDetails] = useState({ name: "", address: "", city: "" });
  const [editingUnits, setEditingUnits] = useState(false);
  const [expenses, setExpenses] = useState<BuildingExpenseView[] | null>(null);
  const [expenseForm, setExpenseForm] = useState<"new" | BuildingExpenseView | null>(null);
  const [saving, setSaving] = useState(false);

  const loadExpenses = useCallback(async () => {
    try {
      const rows = await apiFetch<BuildingExpenseView[]>(
        `/api/buildings/${buildingId}/expenses`,
        csrfToken,
        "GET",
      );
      setExpenses(rows);
    } catch (err) {
      setExpenses([]);
      showError(apiError(err));
    }
  }, [buildingId, csrfToken, apiError, showError]);

  useEffect(() => {
    void loadExpenses();
  }, [loadExpenses]);

  if (!building) {
    return <p className="text-sm text-[var(--color-muted-foreground)]">{t("notFound")}</p>;
  }

  const run = async (task: () => Promise<void>) => {
    setSaving(true);
    try {
      await task();
    } catch (err) {
      showError(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const saveDetails = () =>
    run(async () => {
      await updateBuilding(building.id, {
        name: details.name.trim(),
        address: details.address.trim(),
        city: details.city.trim(),
      });
      setEditingDetails(false);
      success(t("toastSaved"));
    });

  const saveUnits = (chosen: UnitChoice[]) =>
    run(async () => {
      await apiFetch(`/api/buildings/${building.id}/properties`, csrfToken, "PUT", {
        units: chosen,
      });
      await refreshData();
      setEditingUnits(false);
      success(t("units.toastSaved", { count: chosen.length }));
    });

  const saveExpense = (input: BuildingExpenseInput) =>
    run(async () => {
      const editing = expenseForm !== "new" ? expenseForm : null;
      await apiFetch(
        editing
          ? `/api/buildings/${building.id}/expenses/${editing.id}`
          : `/api/buildings/${building.id}/expenses`,
        csrfToken,
        editing ? "PUT" : "POST",
        input,
      );
      setExpenseForm(null);
      await Promise.all([loadExpenses(), refreshData()]);
      success(editing ? t("expenses.toastUpdated") : t("expenses.toastCreated"));
    });

  const askDeleteExpense = (expense: BuildingExpenseView) =>
    confirmDialog.confirm(
      {
        title: t("expenses.deleteTitle"),
        description: t("expenses.deleteDescription", {
          amount: formatCurrency(expense.amount),
          count: expense.parts.length,
        }),
        variant: "destructive",
        confirmLabel: tActions("delete"),
        cancelLabel: tActions("cancel"),
      },
      () =>
        run(async () => {
          await apiFetch(
            `/api/buildings/${building.id}/expenses/${expense.id}`,
            csrfToken,
            "DELETE",
          );
          await Promise.all([loadExpenses(), refreshData()]);
          success(t("expenses.toastDeleted"));
        }),
    );

  const askDeleteBuilding = () =>
    confirmDialog.confirm(
      {
        title: t("deleteTitle"),
        description: t("deleteDescription", { name: building.name, count: units.length }),
        variant: "destructive",
        confirmLabel: tActions("delete"),
        cancelLabel: tActions("cancel"),
      },
      () =>
        run(async () => {
          await deleteBuilding(building.id);
          await refreshData();
          close();
        }),
    );

  const openProperty = (id: string) =>
    router.push(withEntityDetail(pathname, searchParams.toString(), "property", id));

  const permilageTotal = units.reduce((sum, u) => sum + (u.permilage ?? 0), 0);
  const allHavePermilage = units.length > 0 && units.every((u) => (u.permilage ?? 0) > 0);

  return (
    <div className="space-y-8">
      <ConfirmationDialog dialog={confirmDialog} />

      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="bg-[var(--color-info-muted)] p-3">
          <Building2 className="h-8 w-8 text-[var(--color-info)]" />
        </div>
        <div className="min-w-0 flex-1">
          {editingDetails ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="building-detail-name">{t("fields.name")}</Label>
                <Input
                  id="building-detail-name"
                  value={details.name}
                  onChange={(e) => setDetails((d) => ({ ...d, name: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="building-detail-address">{t("fields.address")}</Label>
                  <Input
                    id="building-detail-address"
                    value={details.address}
                    onChange={(e) => setDetails((d) => ({ ...d, address: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="building-detail-city">{t("fields.city")}</Label>
                  <Input
                    id="building-detail-city"
                    value={details.city}
                    onChange={(e) => setDetails((d) => ({ ...d, city: e.target.value }))}
                  />
                </div>
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditingDetails(false)}
                  disabled={saving}
                >
                  {tActions("cancel")}
                </Button>
                <Button
                  type="button"
                  loading={saving}
                  disabled={!details.name.trim()}
                  onClick={() => void saveDetails()}
                >
                  {tActions("save")}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-[var(--color-foreground)] lg:text-3xl">
                {building.name}
              </h1>
              {(building.address || building.city) && (
                <p className="mt-1 flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
                  <MapPin className="h-4 w-4 shrink-0" />
                  {[building.address, building.city].filter(Boolean).join(", ")}
                </p>
              )}
              <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
                {t("summary", { count: units.length })}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDetails({
                      name: building.name,
                      address: building.address ?? "",
                      city: building.city ?? "",
                    });
                    setEditingDetails(true);
                  }}
                >
                  <Pencil className="mr-1.5 h-3.5 w-3.5" />
                  {t("edit")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={askDeleteBuilding}
                  className="text-[var(--color-destructive)]"
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  {t("delete")}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Units */}
      <section className="space-y-3" aria-labelledby="building-units-heading">
        <div className="flex items-center justify-between gap-3">
          <h2 id="building-units-heading" className="text-lg font-semibold">
            {t("units.title")}
          </h2>
          {!editingUnits && (
            <Button type="button" size="sm" onClick={() => setEditingUnits(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              {t("units.choose")}
            </Button>
          )}
        </div>
        {editingUnits ? (
          <BuildingUnitsEditor
            building={building}
            properties={state.properties}
            buildings={state.buildings}
            saving={saving}
            onSave={(chosen) => void saveUnits(chosen)}
            onCancel={() => setEditingUnits(false)}
          />
        ) : units.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">{t("units.empty")}</p>
        ) : (
          <>
            <ul className="divide-y divide-[var(--color-border)] border border-[var(--color-border)]">
              {units.map((unit) => (
                <li key={unit.id}>
                  <button
                    type="button"
                    onClick={() => openProperty(unit.id)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[var(--color-hover)] max-md:min-h-11"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm">{unit.name}</span>
                    {unit.fraction && (
                      <span className="shrink-0 text-xs text-[var(--color-muted-foreground)]">
                        {unit.fraction}
                      </span>
                    )}
                    <span className="w-16 shrink-0 text-right text-sm tabular-nums">
                      {unit.permilage != null ? `${unit.permilage}‰` : "—"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="text-xs text-[var(--color-muted-foreground)]">
              {allHavePermilage
                ? t("units.total", { total: Math.round(permilageTotal * 100) / 100 })
                : t("units.equalFallback")}
            </p>
          </>
        )}
      </section>

      {/* Shared expenses */}
      <section className="space-y-3" aria-labelledby="building-expenses-heading">
        <div className="flex items-center justify-between gap-3">
          <h2 id="building-expenses-heading" className="text-lg font-semibold">
            {t("expenses.title")}
          </h2>
          {expenseForm === null && units.length > 0 && (
            <Button type="button" size="sm" onClick={() => setExpenseForm("new")}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              {t("expenses.add")}
            </Button>
          )}
        </div>
        <p className="text-sm text-[var(--color-muted-foreground)]">{t("expenses.hint")}</p>
        {expenseForm !== null && (
          <BuildingExpenseForm
            key={expenseForm === "new" ? "new" : expenseForm.id}
            units={units}
            editing={expenseForm === "new" ? null : expenseForm}
            saving={saving}
            onSave={(input) => void saveExpense(input)}
            onCancel={() => setExpenseForm(null)}
          />
        )}
        {expenses === null ? null : expenses.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">{t("expenses.empty")}</p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)] border border-[var(--color-border)]">
            {expenses.map((expense) => {
              const key = expenseCategoryKey(expense.category);
              return (
                <li key={expense.id} className="space-y-1 px-3 py-2">
                  <div className="flex items-start gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium break-words">
                        {key ? tCategories(key) : expense.category}
                        {expense.description ? ` · ${expense.description}` : ""}
                      </span>
                      <span className="block text-xs text-[var(--color-muted-foreground)]">
                        {formatDate(expense.date, locale)} ·{" "}
                        {expense.splitBasis === "permilage"
                          ? t("expenses.basisPermilage")
                          : t("expenses.basisEqual")}
                        {expense.isDeductible ? "" : ` · ${t("expenses.notDeductible")}`}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-medium tabular-nums">
                      {formatCurrency(expense.amount)}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("expenses.edit")}
                      onClick={() => setExpenseForm(expense)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("expenses.delete")}
                      onClick={() => askDeleteExpense(expense)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                  <ul className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-[var(--color-muted-foreground)]">
                    {expense.parts.map((part) => (
                      <li key={part.id} className="tabular-nums">
                        {part.propertyName}: {formatCurrency(part.amount)}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
