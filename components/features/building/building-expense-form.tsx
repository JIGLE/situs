"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useCurrency } from "@/lib/contexts/currency-context";
import { isDefaultDeductible, type ExpenseCategory } from "@/lib/schemas/expense.schema";
import type { BuildingExpenseInput } from "@/lib/schemas/building-expense.schema";
import { splitBuildingExpense } from "@/lib/services/buildings/split";
import {
  EXPENSE_CATEGORY_GROUP_KEYS,
  EXPENSE_CATEGORY_GROUPS,
  expenseCategoryKey,
} from "@/lib/utils/expense-labels";
import { parseAmountInput } from "@/lib/utils/money";
import type { Property } from "@/lib/types";
import type { BuildingExpenseView } from "@/lib/services/buildings/expenses";

interface BuildingExpenseFormProps {
  /** The building's units, the ones that can share it. */
  units: Property[];
  /** The expense being changed, or none for a new one. */
  editing: BuildingExpenseView | null;
  saving: boolean;
  onSave: (input: BuildingExpenseInput) => void;
  onCancel: () => void;
}

/**
 * A shared cost of the building: what, how much, when, and which units share it, with each unit's
 * part shown as it will be written (by permilagem where every ticked unit has one, otherwise in
 * equal parts). Each part is then shared by that unit's co-owners as any expense of it is.
 */
export function BuildingExpenseForm({
  units,
  editing,
  saving,
  onSave,
  onCancel,
}: BuildingExpenseFormProps): React.ReactElement {
  const t = useTranslations("buildings.expenses");
  const tActions = useTranslations("actions");
  const tCategories = useTranslations("financial.categories");
  const tGroups = useTranslations("financial.categoryGroups");
  const locale = useLocale();
  const { formatCurrency } = useCurrency();

  const [category, setCategory] = useState<ExpenseCategory>(
    expenseCategoryKey(editing?.category) ?? "condominium_fees",
  );
  const [amountText, setAmountText] = useState(
    editing
      ? new Intl.NumberFormat(locale, { minimumFractionDigits: 2, useGrouping: false }).format(
          editing.amount,
        )
      : "",
  );
  const [date, setDate] = useState((editing?.date ?? new Date().toISOString()).slice(0, 10));
  const [description, setDescription] = useState(editing?.description ?? "");
  const [vendorName, setVendorName] = useState(editing?.vendorName ?? "");
  const [isDeductible, setIsDeductible] = useState(
    editing?.isDeductible ?? isDefaultDeductible("condominium_fees"),
  );
  const [chosen, setChosen] = useState<Set<string>>(
    () => new Set(editing ? editing.parts.map((p) => p.propertyId) : units.map((u) => u.id)),
  );
  const [touched, setTouched] = useState(false);

  const amount = parseAmountInput(amountText);
  const amountOk = Number.isFinite(amount) && amount > 0;
  const shared = units.filter((u) => chosen.has(u.id));
  const preview = useMemo(
    () =>
      splitBuildingExpense(
        amountOk ? amount : 0,
        shared.map((u) => ({ propertyId: u.id, permilage: u.permilage })),
      ),
    [amount, amountOk, shared],
  );
  const names = new Map(units.map((u) => [u.id, u.name]));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!amountOk || shared.length === 0 || !date) return;
    onSave({
      amount: Math.round(amount * 100) / 100,
      date,
      category,
      description: description.trim() || null,
      vendorName: vendorName.trim() || null,
      isDeductible,
      propertyIds: shared.map((u) => u.id),
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4 border border-[var(--color-border)] p-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="building-expense-category">{t("category")}</Label>
          <Select
            value={category}
            onValueChange={(value: ExpenseCategory) => {
              setCategory(value);
              setIsDeductible(isDefaultDeductible(value));
            }}
          >
            <SelectTrigger id="building-expense-category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/* The building's own costs first: they are what is shared. */}
              {(
                [
                  "condominium",
                  "insurance",
                  "works",
                  "utilities",
                  "taxes",
                  "fees",
                  "other",
                ] as const
              )
                .filter((group) => EXPENSE_CATEGORY_GROUP_KEYS.includes(group))
                .map((group) => (
                  <SelectGroup key={group}>
                    {group === "other" ? null : <SelectLabel>{tGroups(group)}</SelectLabel>}
                    {EXPENSE_CATEGORY_GROUPS[group].map((value) => (
                      <SelectItem key={value} value={value}>
                        {tCategories(value)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="building-expense-amount">{t("amount")}</Label>
          <Input
            id="building-expense-amount"
            inputMode="decimal"
            placeholder="0,00"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            className={touched && !amountOk ? "border-[var(--color-destructive)]" : ""}
          />
          {touched && !amountOk && (
            <p className="text-sm text-destructive">{t("amountRequired")}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="building-expense-date">{t("date")}</Label>
          <Input
            id="building-expense-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="building-expense-vendor">{t("vendor")}</Label>
          <Input
            id="building-expense-vendor"
            maxLength={150}
            value={vendorName}
            onChange={(e) => setVendorName(e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="building-expense-description">{t("description")}</Label>
        <Input
          id="building-expense-description"
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="flex min-h-11 items-center justify-between gap-3">
        <Label htmlFor="building-expense-deductible">{t("deductible")}</Label>
        <Switch
          id="building-expense-deductible"
          checked={isDeductible}
          onCheckedChange={setIsDeductible}
        />
      </div>

      <fieldset className="min-w-0 space-y-2">
        <legend className="text-sm font-medium">{t("sharedBy")}</legend>
        <ul className="divide-y divide-[var(--color-border)] border border-[var(--color-border)]">
          {units.map((unit) => {
            const part = preview.parts.find((p) => p.propertyId === unit.id);
            return (
              <li key={unit.id} className="flex items-center gap-3 px-3 py-2">
                <Checkbox
                  checked={chosen.has(unit.id)}
                  onCheckedChange={(on) =>
                    setChosen((prev) => {
                      const next = new Set(prev);
                      if (on) next.add(unit.id);
                      else next.delete(unit.id);
                      return next;
                    })
                  }
                  aria-label={unit.name}
                  wrapperClassName="max-md:min-h-11 max-md:min-w-11 justify-center"
                />
                {/* The permilagem under the name: beside it, a phone had room for four letters. */}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{names.get(unit.id)}</span>
                  <span className="block text-xs text-[var(--color-muted-foreground)] tabular-nums">
                    {unit.permilage != null ? `${unit.permilage}‰` : "—"}
                  </span>
                </span>
                <span className="shrink-0 text-right text-sm tabular-nums">
                  {part && amountOk ? formatCurrency(part.amount) : ""}
                </span>
              </li>
            );
          })}
        </ul>
        <p
          className={
            touched && shared.length === 0
              ? "text-xs text-[var(--color-destructive)]"
              : "text-xs text-[var(--color-muted-foreground)]"
          }
        >
          {shared.length === 0
            ? t("noUnits")
            : preview.basis === "permilage"
              ? t("byPermilage")
              : t("byEqualParts")}
        </p>
      </fieldset>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          {tActions("cancel")}
        </Button>
        <Button type="submit" loading={saving}>
          {tActions("save")}
        </Button>
      </div>
    </form>
  );
}
