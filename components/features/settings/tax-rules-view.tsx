"use client";

import { useState, useEffect, useCallback } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Plus,
  Pencil,
  Trash2,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Landmark,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/lib/contexts/toast-context";
import { csrfHeaders } from "@/lib/utils/api-client";

interface TaxRule {
  id: string;
  country: string;
  regime: string;
  ruleType: string;
  year: number;
  effectiveDate: string;
  payload: string;
  sourceUrl: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

const RULE_TYPES = ["INCOME_BRACKET", "DEDUCTIBLE_RATE", "WITHHOLDING_RATE", "FLAT_RATE"] as const;
type RuleType = (typeof RULE_TYPES)[number];

/** The API can return a rule type this build doesn't know; fall back to the raw string
 *  rather than rendering a `tax.rules.type.<unknown>` key path at the user. */
function isRuleType(value: string): value is RuleType {
  return (RULE_TYPES as readonly string[]).includes(value);
}

const RULE_TYPE_COLORS: Record<RuleType, string> = {
  INCOME_BRACKET: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  DEDUCTIBLE_RATE: "bg-green-500/10 text-green-700 dark:text-green-400",
  WITHHOLDING_RATE: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  FLAT_RATE: "bg-purple-500/10 text-purple-700 dark:text-purple-400",
};

const COUNTRY_FLAGS: Record<string, string> = { PT: "🇵🇹", ES: "🇪🇸", IT: "🇮🇹", FR: "🇫🇷" };

const emptyForm = {
  country: "PT",
  regime: "STANDARD",
  ruleType: "INCOME_BRACKET" as RuleType,
  year: new Date().getFullYear(),
  effectiveDate: `${new Date().getFullYear()}-01-01T00:00:00.000Z`,
  payload: "{}",
  sourceUrl: "",
  notes: "",
};

export function TaxRulesView() {
  const t = useTranslations("tax.rules");
  const tActions = useTranslations("actions");
  const locale = useLocale();
  const { success, error: showError } = useToast();
  const [rules, setRules] = useState<TaxRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCountry, setFilterCountry] = useState("");
  const [filterYear, setFilterYear] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<TaxRule | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TaxRule | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [jsonError, setJsonError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterCountry) params.set("country", filterCountry);
      if (filterYear) params.set("year", filterYear);
      const res = await fetch(`/api/tax-rules?${params}`);
      if (!res.ok) throw new Error("Failed to load");
      const d = await res.json();
      setRules(d.data ?? []);
    } catch {
      showError(t("toast.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [filterCountry, filterYear, showError, t]);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEditingRule(null);
    setForm(emptyForm);
    setJsonError("");
    setDialogOpen(true);
  }

  function openEdit(rule: TaxRule) {
    setEditingRule(rule);
    setForm({
      country: rule.country,
      regime: rule.regime,
      ruleType: rule.ruleType as RuleType,
      year: rule.year,
      effectiveDate: rule.effectiveDate,
      payload: JSON.stringify(JSON.parse(rule.payload), null, 2),
      sourceUrl: rule.sourceUrl ?? "",
      notes: rule.notes ?? "",
    });
    setJsonError("");
    setDialogOpen(true);
  }

  function handlePayloadChange(val: string) {
    setForm((f) => ({ ...f, payload: val }));
    try {
      JSON.parse(val);
      setJsonError("");
    } catch {
      setJsonError("Invalid JSON");
    }
  }

  async function handleSave() {
    if (jsonError) return;
    setSaving(true);
    try {
      const body = {
        ...form,
        payload: JSON.stringify(JSON.parse(form.payload)),
        sourceUrl: form.sourceUrl || null,
        notes: form.notes || null,
      };

      const url = editingRule ? `/api/tax-rules/${editingRule.id}` : "/api/tax-rules";
      const method = editingRule ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: csrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const d = await res.json();
        showError(typeof d.error === "string" ? d.error : t("toast.saveFailed"));
        return;
      }

      success(editingRule ? t("toast.updated") : t("toast.created"));
      setDialogOpen(false);
      await load();
    } catch {
      showError(t("toast.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/tax-rules/${deleteTarget.id}`, {
        method: "DELETE",
        headers: csrfHeaders(),
      });
      if (!res.ok) throw new Error("Delete failed");
      success(t("toast.deleted"));
      setDeleteTarget(null);
      await load();
    } catch {
      showError(t("toast.deleteFailed"));
    }
  }

  // Group rules by country → year
  const grouped = rules.reduce<Record<string, Record<number, TaxRule[]>>>((acc, rule) => {
    if (!acc[rule.country]) acc[rule.country] = {};
    if (!acc[rule.country][rule.year]) acc[rule.country][rule.year] = [];
    acc[rule.country][rule.year].push(rule);
    return acc;
  }, {});

  const years = Array.from(new Set(rules.map((r) => r.year))).sort((a, b) => b - a);

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Landmark className="h-6 w-6" />
            {t("heading")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            {t("refresh")}
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1.5" />
            {t("addRule")}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <Select value={filterCountry} onValueChange={setFilterCountry}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder={t("allCountries")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">{t("allCountries")}</SelectItem>
            <SelectItem value="PT">🇵🇹 Portugal</SelectItem>
            <SelectItem value="ES">🇪🇸 Spain</SelectItem>
            <SelectItem value="IT">🇮🇹 Italy</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterYear} onValueChange={setFilterYear}>
          <SelectTrigger className="w-28">
            <SelectValue placeholder={t("allYears")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">{t("allYears")}</SelectItem>
            {years.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(filterCountry || filterYear) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFilterCountry("");
              setFilterYear("");
            }}
          >
            {t("clear")}
          </Button>
        )}
      </div>

      {/* Rules grouped by country */}
      {loading ? (
        <div className="text-sm text-muted-foreground">{t("loading")}</div>
      ) : rules.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Landmark className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">{t("emptyTitle")}</p>
            <p className="text-xs text-muted-foreground mt-1">{t("emptyDescription")}</p>
          </CardContent>
        </Card>
      ) : (
        Object.entries(grouped).map(([country, byYear]) => (
          <Card key={country}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <span className="text-xl">{COUNTRY_FLAGS[country] ?? "🌍"}</span>
                {country === "PT" ? "Portugal" : country === "ES" ? "Spain" : country}
              </CardTitle>
              <CardDescription>
                {Object.values(byYear).flat().length} rule
                {Object.values(byYear).flat().length !== 1 ? "s" : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {Object.entries(byYear).map(([yr, yearRules]) => (
                <div key={yr}>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    {yr}
                  </p>
                  <div className="space-y-1">
                    {yearRules.map((rule) => (
                      <div
                        key={rule.id}
                        className="border border-border rounded-lg overflow-hidden"
                      >
                        {/* Row */}
                        <div
                          className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/40 transition-colors"
                          onClick={() => setExpandedId(expandedId === rule.id ? null : rule.id)}
                        >
                          <span className="text-muted-foreground">
                            {expandedId === rule.id ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium">{rule.regime}</span>
                              <Badge
                                variant="outline"
                                className={`text-xs ${RULE_TYPE_COLORS[rule.ruleType as RuleType] ?? ""}`}
                              >
                                {isRuleType(rule.ruleType)
                                  ? t(`type.${rule.ruleType}`)
                                  : rule.ruleType}
                              </Badge>
                            </div>
                            {rule.notes && (
                              <p className="text-xs text-muted-foreground truncate mt-0.5">
                                {rule.notes}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {rule.sourceUrl && (
                              <a
                                href={rule.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openEdit(rule);
                              }}
                              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteTarget(rule);
                              }}
                              className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Expanded payload */}
                        {expandedId === rule.id && (
                          <div className="border-t border-border bg-muted/30 px-4 py-3">
                            <p className="text-xs font-medium text-muted-foreground mb-2">
                              {t("payload")}
                            </p>
                            <pre className="text-xs font-mono bg-background border border-border rounded p-3 overflow-auto max-h-64 whitespace-pre-wrap">
                              {JSON.stringify(JSON.parse(rule.payload), null, 2)}
                            </pre>
                            <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
                              <span>
                                {t("effective")}{" "}
                                {new Date(rule.effectiveDate).toLocaleDateString(locale)}
                              </span>
                              <span>
                                {t("updated")} {new Date(rule.updatedAt).toLocaleDateString(locale)}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ))
      )}

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingRule ? t("editTitle") : t("addTitle")}</DialogTitle>
            <DialogDescription>
              {editingRule ? t("editDescription") : t("addDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {!editingRule && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>{t("country")}</Label>
                  <Select
                    value={form.country}
                    onValueChange={(v) => setForm((f) => ({ ...f, country: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PT">🇵🇹 Portugal</SelectItem>
                      <SelectItem value="ES">🇪🇸 Spain</SelectItem>
                      <SelectItem value="IT">🇮🇹 Italy</SelectItem>
                      <SelectItem value="FR">🇫🇷 France</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>{t("year")}</Label>
                  <Input
                    type="number"
                    min={2020}
                    max={2040}
                    value={form.year}
                    onChange={(e) => setForm((f) => ({ ...f, year: parseInt(e.target.value, 10) }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("regime")}</Label>
                  <Input
                    placeholder={t("regimePlaceholder")}
                    value={form.regime}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, regime: e.target.value.toUpperCase() }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("ruleType")}</Label>
                  <Select
                    value={form.ruleType}
                    onValueChange={(v) => setForm((f) => ({ ...f, ruleType: v as RuleType }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RULE_TYPES.map((val) => (
                        <SelectItem key={val} value={val}>
                          {t(`type.${val}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label>{t("effectiveDate")}</Label>
                  <Input
                    type="date"
                    value={form.effectiveDate.substring(0, 10)}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        effectiveDate: `${e.target.value}T00:00:00.000Z`,
                      }))
                    }
                  />
                </div>
              </div>
            )}

            {editingRule && (
              <div className="rounded-lg bg-muted px-4 py-3 text-sm space-y-1">
                <p>
                  <span className="text-muted-foreground">{t("countryYear")}</span>{" "}
                  <strong>
                    {editingRule.country} {editingRule.year}
                  </strong>
                </p>
                <p>
                  <span className="text-muted-foreground">{t("regimeLabel")}</span>{" "}
                  <strong>{editingRule.regime}</strong>
                </p>
                <p>
                  <span className="text-muted-foreground">{t("typeLabel")}</span>{" "}
                  <strong>
                    {isRuleType(editingRule.ruleType)
                      ? t(`type.${editingRule.ruleType}`)
                      : editingRule.ruleType}
                  </strong>
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>
                {t("payload")}{" "}
                <span className="text-muted-foreground font-normal text-xs">
                  {t("payloadJson")}
                </span>
              </Label>
              <Textarea
                value={form.payload}
                onChange={(e) => handlePayloadChange(e.target.value)}
                className={`font-mono text-xs min-h-[160px] ${jsonError ? "border-destructive" : ""}`}
                spellCheck={false}
              />
              {jsonError && <p className="text-xs text-destructive">{jsonError}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>{t("sourceUrl")}</Label>
              <Input
                type="url"
                placeholder="https://diariodarepublica.pt/…"
                value={form.sourceUrl}
                onChange={(e) => setForm((f) => ({ ...f, sourceUrl: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label>{t("notes")}</Label>
              <Textarea
                placeholder={t("notesPlaceholder")}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                className="min-h-[80px]"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {tActions("cancel")}
            </Button>
            <Button onClick={handleSave} disabled={saving || !!jsonError}>
              {saving ? t("saving") : editingRule ? t("saveChanges") : t("createRule")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (
                <>
                  {deleteTarget.country} · {deleteTarget.regime} · {deleteTarget.ruleType} ·{" "}
                  {deleteTarget.year}
                </>
              )}
              <br />
              {t("deleteWarning")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tActions("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {tActions("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
