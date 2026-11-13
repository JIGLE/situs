"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useApp } from "@/lib/contexts/app-context";
import { useToast } from "@/lib/contexts/toast-context";
import { apiFetch } from "@/lib/utils/api-client";
import { MAX_CONTRACT_BYTES } from "@/lib/utils/contract-file";
import type { PropertyDraft } from "@/lib/services/financas-import/caderneta";
import { propertiesMatching } from "@/lib/services/financas-import/match";
import { articleKey, fractionKey } from "@/lib/services/financas-import/text";
import {
  describeShares,
  planShares,
  type PlannedShare,
} from "@/lib/services/financas-import/landlords";
import { applyShares } from "./apply-shares";
import { failureStatus, readCaderneta } from "./read-document";

type Failure = "notPdf" | "tooLarge" | "noText" | "notCaderneta" | "rustica" | "failed";

interface Row {
  key: string;
  draft: PropertyDraft;
  selected: boolean;
  /** The name of the property already in Situs with this article and fraction. */
  existing: string | null;
  /** Its owners and shares, from the caderneta's titulares, set once the property is created. */
  shares: PlannedShare[];
  /** Set when creating it failed, so it stays listed for another try. */
  failed?: boolean;
}

const TYPES = ["apartment", "house", "commercial", "garage", "other"] as const;

export interface PropertyImportSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Properties from the cadernetas prediais the owner downloads from the Portal das Finanças. The
 * Portal exports no list, but each property's caderneta is a PDF in a fixed layout: the owner
 * drops one or many here, checks what was read, and creates the ones ticked. A property already
 * in Situs with the same article and fraction starts unticked.
 *
 * Rent and tenants come afterwards, from the contract proof in the New tenancy sheet.
 */
export function PropertyImportSheet({ open, onOpenChange }: PropertyImportSheetProps) {
  const t = useTranslations("financasImport");
  const tTypes = useTranslations("financasImport.type");
  const tActions = useTranslations("actions");
  const locale = useLocale();
  const { state, refreshData } = useApp();
  const { success, error } = useToast();

  const [rows, setRows] = useState<Row[]>([]);
  const [failures, setFailures] = useState<{ file: string; reason: Failure }[]>([]);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRows([]);
    setFailures([]);
  }, [open]);

  const handleFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    setReading(true);
    const added: Row[] = [];
    const failed: { file: string; reason: Failure }[] = [];
    // One at a time: a caderneta of a large building is dozens of pages.
    for (const file of files) {
      if (file.size > MAX_CONTRACT_BYTES) {
        failed.push({ file: file.name, reason: "tooLarge" });
        continue;
      }
      try {
        const { document, drafts } = await readCaderneta(file);
        if (document.kind === "rustica") {
          failed.push({ file: file.name, reason: "rustica" });
          continue;
        }
        if (document.kind !== "urbana" || !document.article) {
          failed.push({ file: file.name, reason: "notCaderneta" });
          continue;
        }
        drafts.forEach((draft, i) => {
          const existing = propertiesMatching(
            state.properties,
            draft.cadasterReference,
            draft.fraction,
          )[0];
          added.push({
            key: `${file.name}:${i}:${Date.now()}`,
            draft,
            selected: !existing,
            existing: existing?.name ?? null,
            shares: planShares(document.holders, state.owners ?? []),
          });
        });
      } catch (err) {
        const status = failureStatus(err);
        failed.push({
          file: file.name,
          reason: status === 415 ? "notPdf" : status === 422 ? "noText" : "failed",
        });
      }
    }
    setRows((prev) => {
      // The same unit read twice (the same PDF dropped again) is listed once.
      const seen = new Set(
        prev.map(
          (r) => `${articleKey(r.draft.cadasterReference)}|${fractionKey(r.draft.fraction)}`,
        ),
      );
      const fresh = added.filter((r) => {
        const id = `${articleKey(r.draft.cadasterReference)}|${fractionKey(r.draft.fraction)}`;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      return [...prev, ...fresh];
    });
    setFailures((prev) => [...prev, ...failed]);
    setReading(false);
  };

  const change = (key: string, patch: Partial<Row> | Partial<PropertyDraft>, onDraft = false) =>
    setRows((prev) =>
      prev.map((row) =>
        row.key !== key
          ? row
          : onDraft
            ? { ...row, draft: { ...row.draft, ...(patch as Partial<PropertyDraft>) } }
            : { ...row, ...(patch as Partial<Row>) },
      ),
    );

  const chosen = rows.filter((r) => r.selected && r.draft.name.trim());

  const handleCreate = async () => {
    setSaving(true);
    let created = 0;
    let ownersFailed = 0;
    const failedKeys = new Set<string>();
    // Owners added by this import, by NIF: one person on many cadernetas is added once.
    const addedOwners = new Map<string, string>();
    for (const row of chosen) {
      const { draft } = row;
      let property: { id: string };
      try {
        property = await apiFetch<{ id: string }>("/api/properties", {
          method: "POST",
          body: JSON.stringify({
            name: draft.name.trim(),
            address: draft.address.trim() || draft.name.trim(),
            streetAddress: draft.streetAddress || undefined,
            city: draft.city || undefined,
            zipCode: draft.zipCode || "",
            type: draft.type,
            bedrooms: draft.bedrooms,
            bathrooms: null,
            rent: 0,
            status: "vacant",
            addressVerified: false,
            cadasterReference: draft.cadasterReference || null,
            fraction: draft.fraction || null,
          }),
        });
        created += 1;
      } catch {
        failedKeys.add(row.key);
        continue;
      }
      try {
        await applyShares(property.id, row.shares, addedOwners);
      } catch {
        // The property is there; its owners can be set on its page.
        ownersFailed += 1;
      }
    }
    await refreshData();
    setSaving(false);
    if (ownersFailed > 0) error(t("ownersFailed", { count: ownersFailed }));
    if (failedKeys.size === 0) {
      success(t("created", { count: created }));
      onOpenChange(false);
      return;
    }
    // What was created leaves the list; what failed stays ticked for another try.
    setRows((prev) =>
      prev
        .filter((r) => !r.selected || failedKeys.has(r.key))
        .map((r) => (failedKeys.has(r.key) ? { ...r, failed: true } : r)),
    );
    error(t("partial", { created, failed: failedKeys.size }));
  };

  const number = (value: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);

  const picker = (
    <>
      <Input
        id="financas-cadernetas"
        type="file"
        accept=".pdf,application/pdf"
        multiple
        onChange={handleFiles}
        className="hidden"
        disabled={reading || saving}
      />
      <Label
        htmlFor="financas-cadernetas"
        className="flex min-h-11 cursor-pointer items-center justify-center gap-2 border border-dashed border-[var(--color-border)] bg-[var(--color-secondary)] px-4 py-3 text-sm transition-colors hover:bg-[var(--color-surface-hover)]"
      >
        <FileUp className="h-4 w-4 shrink-0" />
        {reading ? t("reading") : rows.length > 0 ? t("addMore") : t("choose")}
      </Label>
    </>
  );

  return (
    <Sheet open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <SheetContent side="center" className="md:max-w-2xl">
        <SheetHeader className="pr-14">
          <SheetTitle>{t("title")}</SheetTitle>
          <SheetDescription>{t("description")}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {rows.length === 0 && (
            <p className="text-sm text-[var(--color-muted-foreground)]">{t("where")}</p>
          )}
          {picker}

          {failures.length > 0 && (
            <ul className="space-y-1 text-sm text-destructive" aria-live="polite">
              {failures.map((f, i) => (
                <li key={`${f.file}-${i}`}>
                  <span className="font-medium">{f.file}</span>: {t(`failure.${f.reason}`)}
                </li>
              ))}
            </ul>
          )}

          {rows.length > 0 && (
            <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
              {rows.map((row) => (
                <li key={row.key} className="flex gap-3 py-3">
                  <Checkbox
                    checked={row.selected}
                    onCheckedChange={(checked) => change(row.key, { selected: checked })}
                    aria-label={t("include", { name: row.draft.name })}
                    wrapperClassName="mt-1 max-md:min-h-11 max-md:min-w-11 max-md:mt-0 justify-center"
                  />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-col gap-2 md:flex-row">
                      <Input
                        aria-label={t("name")}
                        value={row.draft.name}
                        maxLength={100}
                        onChange={(e) => change(row.key, { name: e.target.value }, true)}
                        className="md:flex-1"
                      />
                      <Select
                        value={row.draft.type}
                        onValueChange={(value) =>
                          change(row.key, { type: value as PropertyDraft["type"] }, true)
                        }
                      >
                        <SelectTrigger aria-label={t("typeLabel")} className="md:w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TYPES.map((type) => (
                            <SelectItem key={type} value={type}>
                              {tTypes(type)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-xs text-[var(--color-muted-foreground)]">
                      {[
                        row.draft.address,
                        t("article", { article: row.draft.cadasterReference }),
                        row.draft.fraction && t("fraction", { fraction: row.draft.fraction }),
                        row.draft.use,
                        row.draft.area != null && t("area", { area: number(row.draft.area) }),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {row.shares.length > 0 && (
                      <p className="text-xs">
                        {t("owners", { list: describeShares(row.shares, locale) })}
                      </p>
                    )}
                    {row.existing && (
                      <p className="text-xs text-[var(--color-warning)]">
                        {t("alreadyHave", { name: row.existing })}
                      </p>
                    )}
                    {row.failed && (
                      <p className="text-xs text-destructive">{t("failure.saveFailed")}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {rows.length > 0 && (
            <p className="text-xs text-[var(--color-muted-foreground)]">{t("next")}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-6 py-4">
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            {tActions("cancel")}
          </Button>
          <Button
            type="button"
            onClick={handleCreate}
            disabled={saving || reading || chosen.length === 0}
            loading={saving}
          >
            {t("create", { count: chosen.length })}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
