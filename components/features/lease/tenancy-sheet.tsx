"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, FileUp, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { TaxIdentityFields } from "@/components/shared/tax-identity-fields";
import { useApp } from "@/lib/contexts/app-context";
import { useCurrency } from "@/lib/contexts/currency-context";
import { useToast } from "@/lib/contexts/toast-context";
import { wasReported } from "@/lib/utils/api-error";
import type { Lease } from "@/lib/types";
import { leaseSchema, type LeaseFormData } from "@/lib/schemas/lease.schema";
import { createTenantSchema } from "@/lib/schemas/tenant.schema";
import { MAX_CONTRACT_BYTES, MAX_CONTRACT_MB } from "@/lib/utils/contract-file";
import {
  defaultLeaseTerm,
  onPropertyChosen,
  onRentChanged,
  onStartChanged,
  oneYearTermEnd,
} from "@/lib/utils/lease-defaults";
import { tenancyFromContract, type TenancyWarning } from "@/lib/services/financas-import/match";
import { readContractProof } from "@/components/features/financas-import/read-document";
import { applyShares, hasOwners } from "@/components/features/financas-import/apply-shares";
import {
  describeShares,
  planShares,
  type PlannedShare,
} from "@/lib/services/financas-import/landlords";
import { cn } from "@/lib/utils/utils";
import { apiFetch } from "@/lib/utils/api-client";
import { uploadContract } from "./lease-contract";
import { LeasePartiesEditor, leasePartiesInvalid } from "./lease-parties-editor";
import { RentHistorySheet } from "./rent-history-sheet";
import type { RentHistory } from "@/lib/services/leases/rent-history";

/** The person typed in when the tenant is new: what a receipt in Finanças needs, and an email. */
type NewTenant = {
  name: string;
  email: string;
  taxId: string | null;
  taxCountry: string | null;
  idDocument: string | null;
};

const EMPTY_TENANT: NewTenant = {
  name: "",
  email: "",
  taxId: "",
  taxCountry: "PT",
  idDocument: "",
};

type FieldError =
  | "propertyId"
  | "tenantId"
  | "name"
  | "email"
  | "taxId"
  | "monthlyRent"
  | "endDate"
  | "parties"
  | "atContractNumber";

export interface TenancySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The lease to edit. Absent, the sheet starts a new tenancy. */
  lease?: Lease | null;
  /** What a new tenancy starts with: the property page passes its property. */
  prefill?: { propertyId?: string; tenantId?: string };
}

function blankLease(): LeaseFormData {
  return {
    propertyId: "",
    tenantId: "",
    ...defaultLeaseTerm(new Date()),
    monthlyRent: 0,
    deposit: 0,
    autoRenew: false,
    renewalNoticeDays: 60,
    status: "draft",
    notes: "",
    atContractNumber: "",
    parties: [],
  };
}

function fromLease(lease: Lease): LeaseFormData {
  return {
    propertyId: lease.propertyId,
    tenantId: lease.tenantId,
    startDate: lease.startDate.split("T")[0],
    endDate: lease.endDate.split("T")[0],
    monthlyRent: lease.monthlyRent,
    deposit: lease.deposit,
    autoRenew: lease.autoRenew,
    renewalNoticeDays: lease.renewalNoticeDays,
    status: "draft",
    notes: lease.notes || "",
    atContractNumber: lease.atContractNumber ?? "",
    atContractVersion: lease.atContractVersion ?? null,
    parties: (lease.parties ?? []).map((party) => ({
      role: party.role,
      name: party.name,
      taxId: party.taxId ?? "",
      taxCountry: party.taxCountry ?? "PT",
      idDocument: party.idDocument ?? "",
    })),
  };
}

/**
 * A tenancy on one sheet: the property, the tenant (an existing one, or a new one typed in here),
 * the rent and the term. Everything a receipt can wait for (co-tenants, the AT contract, the PDF,
 * the notice period, notes) sits behind one fold.
 *
 * It replaced a four-step wizard that could not create the tenant (its "Go to People" left the
 * wizard), and the property page's "Add tenant", which created a person but no lease. The same
 * sheet edits a lease, with the tenant fixed to a choice from the list.
 */
export function TenancySheet({ open, onOpenChange, lease, prefill }: TenancySheetProps) {
  const t = useTranslations("leases");
  const tImport = useTranslations("financasImport.tenancy");
  const locale = useLocale();
  const tActions = useTranslations("actions");
  const router = useRouter();
  const { state, addLease, updateLease, addTenant, refreshData } = useApp();
  const { properties, tenants } = state;
  const { currencySymbol } = useCurrency();
  const { success, error } = useToast();

  const editing = !!lease;
  const [form, setForm] = useState<LeaseFormData>(blankLease);
  const [tenantMode, setTenantMode] = useState<"new" | "existing">("new");
  const [newTenant, setNewTenant] = useState<NewTenant>(EMPTY_TENANT);
  const [contractFile, setContractFile] = useState<File | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<FieldError, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  // A contract proof from the Portal das Finanças the sheet was filled in from, and what in it
  // the owner must still check.
  const [readingProof, setReadingProof] = useState(false);
  // After a new tenancy that began before this month, or that the bank already shows paying: what
  // was paid before it reached Situs (`RentHistorySheet`).
  const [history, setHistory] = useState<{
    leaseId: string;
    rent: number;
    data: RentHistory;
  } | null>(null);

  const [proof, setProof] = useState<
    | {
        number: string | null;
        warnings: TenancyWarning[];
        article: string;
        fraction: string;
        /** The landlords on the proof, for the property when it has no owners yet. */
        shares: PlannedShare[];
      }
    | { failed: true }
    | null
  >(null);

  // Start afresh every time the sheet opens, from the lease being edited or from the prefill.
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setContractFile(null);
    setNewTenant(EMPTY_TENANT);
    setProof(null);
    if (lease) {
      setForm(fromLease(lease));
      setTenantMode("existing");
      setShowMore(true);
      return;
    }
    const base = blankLease();
    const tenant = tenants.find((tn) => tn.id === prefill?.tenantId);
    const propertyId = prefill?.propertyId ?? tenant?.propertyId ?? "";
    setForm({
      ...base,
      tenantId: tenant?.id ?? "",
      propertyId,
      ...onPropertyChosen(base, properties.find((p) => p.id === propertyId)?.rent),
    });
    setTenantMode(tenant ? "existing" : "new");
    setShowMore(false);
    // Only on opening: the lists refreshing underneath must not wipe what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lease?.id, prefill?.propertyId, prefill?.tenantId]);

  const update = (change: Partial<LeaseFormData>) => setForm((prev) => ({ ...prev, ...change }));

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    // The contract route's limit, so the form refuses what the server would.
    if (file.size > MAX_CONTRACT_BYTES) {
      error(t("toast.fileTooLarge", { size: MAX_CONTRACT_MB }));
      return;
    }
    if (file.type !== "application/pdf") {
      error(t("toast.pdfOnly"));
      return;
    }
    setContractFile(file);
  };

  /**
   * Fills the sheet from a contract proof downloaded from the Portal das Finanças (Arrendamento ›
   * Contratos): the property by its article and fraction, the tenants by NIF, the rent, the term
   * and AT's contract number. Nothing is saved: the owner checks the sheet and creates it as usual.
   */
  const handleProof = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_CONTRACT_BYTES) {
      error(t("toast.fileTooLarge", { size: MAX_CONTRACT_MB }));
      return;
    }
    setReadingProof(true);
    try {
      const contract = await readContractProof(file);
      if (!contract.recognised) {
        setProof({ failed: true });
        return;
      }
      const today = new Date().toISOString().slice(0, 10);
      const found = tenancyFromContract(contract, properties, tenants, today);
      setForm((prev) => {
        const startDate = found.startDate ?? prev.startDate;
        const withRent =
          found.monthlyRent != null ? { ...prev, ...onRentChanged(prev, found.monthlyRent) } : prev;
        return {
          ...withRent,
          propertyId: found.propertyId ?? prev.propertyId,
          startDate,
          endDate: found.endDate ?? (found.startDate ? oneYearTermEnd(startDate) : prev.endDate),
          atContractNumber: found.atContractNumber ?? prev.atContractNumber,
          parties: [
            ...(prev.parties ?? []).filter((p) => p.role !== "tenant"),
            ...found.coTenants.map((p) => ({
              role: "tenant" as const,
              name: p.name,
              taxId: p.taxId,
              taxCountry: "PT",
              idDocument: "",
            })),
          ],
        };
      });
      if (found.tenant && "existingId" in found.tenant) {
        setTenantMode("existing");
        update({ tenantId: found.tenant.existingId });
      } else if (found.tenant) {
        setTenantMode("new");
        setNewTenant({ ...EMPTY_TENANT, name: found.tenant.name, taxId: found.tenant.taxId });
      }
      // The proof is Finanças' record of the contract: kept with the lease unless one was chosen.
      setContractFile((prev) => prev ?? file);
      setShowMore(true);
      setErrors({});
      setProof({
        number: found.atContractNumber,
        warnings: found.warnings,
        article: contract.article ?? "",
        fraction: contract.fraction ?? "",
        shares: planShares(contract.landlords, state.owners ?? []),
      });
    } catch {
      setProof({ failed: true });
    } finally {
      setReadingProof(false);
    }
  };

  /** Every problem, each in the user's language: the schemas' English never reaches the screen. */
  const check = (): Partial<Record<FieldError, string>> => {
    const found: Partial<Record<FieldError, string>> = {};
    if (!form.propertyId) found.propertyId = t("sheet.error.property");
    if (tenantMode === "existing" && !form.tenantId) found.tenantId = t("sheet.error.tenant");
    if (tenantMode === "new") {
      const parsed = createTenantSchema.safeParse(newTenant);
      if (!newTenant.name.trim()) found.name = t("sheet.error.name");
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          if (issue.path[0] === "email") found.email = t("sheet.error.email");
          // TaxIdentityFields already says what is wrong with the NIF beside it.
          if (issue.path[0] === "taxId") found.taxId = "";
          if (issue.path[0] === "name") found.name = t("sheet.error.name");
        }
      }
    }
    if (!(form.monthlyRent > 0)) found.monthlyRent = t("sheet.error.rent");
    if (form.startDate && form.endDate && Date.parse(form.endDate) <= Date.parse(form.startDate)) {
      found.endDate = t("sheet.error.endDate");
    }
    if (leasePartiesInvalid(form.parties)) found.parties = t("parties.invalid");
    if (!/^\d*$/.test(form.atContractNumber ?? ""))
      found.atContractNumber = t("atContract.invalid");
    return found;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const found = check();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      // A problem behind the fold is no use hidden.
      if (found.parties !== undefined || found.atContractNumber !== undefined) setShowMore(true);
      return;
    }

    setSubmitting(true);
    try {
      let tenantId = form.tenantId;
      if (tenantMode === "new") {
        const tenant = await addTenant({
          name: newTenant.name.trim(),
          email: newTenant.email.trim() || null,
          taxId: newTenant.taxId,
          taxCountry: newTenant.taxCountry,
          idDocument: newTenant.idDocument,
        });
        tenantId = tenant.id;
        // Saved now: should the lease fail, trying again must not add the person twice.
        update({ tenantId });
        setTenantMode("existing");
      }

      const parsed = leaseSchema.parse({ ...form, tenantId });
      // Only a new lease starts active. An edit sends no status, so the lease keeps its own.
      const { status: _status, ...terms } = parsed;
      const saved = lease
        ? await updateLease(lease.id, terms)
        : await addLease({ ...terms, status: "active" as const });

      if (contractFile) {
        try {
          await uploadContract(saved.id, contractFile);
        } catch {
          error(t("toast.contractUploadFailed"));
        }
      }
      // The proof's landlords become the property's owners, unless it already has some: Situs keeps
      // landlords on the property, with dated shares, and an import never rewrites them.
      if (
        !lease &&
        proof &&
        !("failed" in proof) &&
        proof.shares.length > 0 &&
        !hasOwners(state.owners, form.propertyId)
      ) {
        try {
          await applyShares(form.propertyId, proof.shares, new Map());
        } catch {
          error(tImport("ownersFailed"));
        }
      }
      // The tenant's property, rent and dates are read from the lease, so read them again.
      await refreshData();
      success(lease ? t("toast.updated") : t("sheet.created"));
      if (!lease) {
        try {
          const data = await apiFetch<RentHistory>(`/api/leases/${saved.id}/rent-history`);
          const thisMonth = new Date().toISOString().slice(0, 7);
          if (data.startMonth < thisMonth || data.suggestions.length > 0) {
            setHistory({ leaseId: saved.id, rent: saved.monthlyRent, data });
          }
        } catch {
          // Only a help: the tenancy is saved, and its months can be settled from the ledger.
        }
      }
      onOpenChange(false);
    } catch (err) {
      // The app's actions report their own failures; saying so again would be a second toast.
      if (!wasReported(err)) error(t("sheet.error.saveFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const fieldError = (key: FieldError) =>
    errors[key] ? <p className="text-sm text-destructive">{errors[key]}</p> : null;
  const invalid = (key: FieldError) => (errors[key] !== undefined ? "border-destructive" : "");

  return (
    <>
      <RentHistorySheet
        leaseId={history?.leaseId ?? null}
        monthlyRent={history?.rent ?? 0}
        history={history?.data ?? null}
        onClose={() => setHistory(null)}
      />
      <Sheet open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
        <SheetContent side="center" className="md:max-w-2xl">
          <SheetHeader className="pr-14">
            <SheetTitle>{editing ? t("dialogEditTitle") : t("sheet.title")}</SheetTitle>
            <SheetDescription>
              {editing ? t("dialogEditDescription") : t("sheet.description")}
            </SheetDescription>
          </SheetHeader>

          <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
              {/* From Finanças: a registered contract's proof fills in what follows */}
              {!editing && (
                <section className="space-y-2">
                  <Input
                    id="tenancy-proof"
                    type="file"
                    accept=".pdf,application/pdf"
                    onChange={handleProof}
                    className="hidden"
                    disabled={readingProof || submitting}
                  />
                  <Label
                    htmlFor="tenancy-proof"
                    className="flex min-h-11 cursor-pointer items-center gap-2 border border-dashed border-[var(--color-border)] px-4 py-2 text-sm transition-colors hover:bg-[var(--color-surface-hover)]"
                  >
                    <FileUp className="h-4 w-4 shrink-0" />
                    <span className="min-w-0">
                      <span className="block">
                        {readingProof ? tImport("reading") : tImport("fill")}
                      </span>
                      {!proof && (
                        <span className="block text-xs text-[var(--color-muted-foreground)]">
                          {tImport("hint")}
                        </span>
                      )}
                    </span>
                  </Label>
                  {proof && "failed" in proof && (
                    <p className="text-sm text-destructive" role="alert">
                      {tImport("failed")}
                    </p>
                  )}
                  {proof && !("failed" in proof) && (
                    <div className="space-y-1 text-sm" aria-live="polite">
                      <p>
                        {proof.number
                          ? tImport("filled", { number: proof.number })
                          : tImport("filledNoNumber")}
                      </p>
                      {proof.shares.length > 0 && (
                        <p className="text-[var(--color-muted-foreground)]">
                          {form.propertyId && hasOwners(state.owners, form.propertyId)
                            ? tImport("landlordsKept")
                            : tImport("landlords", { list: describeShares(proof.shares, locale) })}
                        </p>
                      )}
                      {proof.warnings.length > 0 && (
                        <ul className="list-disc space-y-1 pl-5 text-[var(--color-warning)]">
                          {proof.warnings.map((warning) => (
                            <li key={warning}>
                              {tImport(`warning.${warning}`, {
                                article: proof.article || "?",
                                fraction: proof.fraction || "-",
                              })}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </section>
              )}

              {/* Property */}
              <section className="space-y-2">
                <Label htmlFor="tenancy-property">{t("field.property")}</Label>
                {properties.length === 0 ? (
                  <div className="border border-[var(--color-border)] bg-[var(--color-surface-hover)] p-4 text-center">
                    <p className="mb-2 text-sm text-[var(--color-muted-foreground)]">
                      {t("selectProperty.noneFound")}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => router.push("/portfolio")}
                    >
                      <Plus className="mr-2 h-4 w-4" /> {t("goToPortfolio")}
                    </Button>
                  </div>
                ) : (
                  <Select
                    value={form.propertyId}
                    onValueChange={(value) =>
                      update({
                        propertyId: value,
                        ...onPropertyChosen(form, properties.find((p) => p.id === value)?.rent),
                      })
                    }
                  >
                    <SelectTrigger id="tenancy-property" className={invalid("propertyId")}>
                      <SelectValue placeholder={t("selectProperty.placeholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {properties.map((property) => (
                        <SelectItem
                          key={property.id}
                          value={property.id}
                          description={property.address}
                        >
                          {property.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {fieldError("propertyId")}
              </section>

              {/* Tenant: typed in here, or picked from the list */}
              <section className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label htmlFor={tenantMode === "new" ? "tenancy-name" : "tenancy-tenant"}>
                    {t("field.tenant")}
                  </Label>
                  {!editing && tenants.length > 0 && (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto min-h-6 px-0"
                      onClick={() => {
                        setTenantMode(tenantMode === "new" ? "existing" : "new");
                        setErrors({});
                      }}
                    >
                      {tenantMode === "new" ? t("sheet.pickExisting") : t("sheet.typeNew")}
                    </Button>
                  )}
                </div>

                {tenantMode === "existing" ? (
                  <>
                    <Select
                      value={form.tenantId}
                      onValueChange={(value) => update({ tenantId: value })}
                    >
                      <SelectTrigger id="tenancy-tenant" className={invalid("tenantId")}>
                        <SelectValue placeholder={t("selectTenant.placeholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        {tenants.map((tenant) => (
                          <SelectItem
                            key={tenant.id}
                            value={tenant.id}
                            description={tenant.email ?? undefined}
                          >
                            {tenant.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {fieldError("tenantId")}
                  </>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Input
                        id="tenancy-name"
                        autoComplete="off"
                        placeholder={t("sheet.namePlaceholder")}
                        value={newTenant.name}
                        onChange={(e) =>
                          setNewTenant((prev) => ({ ...prev, name: e.target.value }))
                        }
                        aria-invalid={errors.name !== undefined}
                        className={invalid("name")}
                      />
                      {fieldError("name")}
                    </div>
                    <TaxIdentityFields
                      idPrefix="tenancy"
                      value={newTenant}
                      onChange={(change) => setNewTenant((prev) => ({ ...prev, ...change }))}
                    />
                    <div className="space-y-2">
                      <Label htmlFor="tenancy-email">{t("sheet.email")}</Label>
                      <Input
                        id="tenancy-email"
                        type="email"
                        autoComplete="off"
                        value={newTenant.email}
                        onChange={(e) =>
                          setNewTenant((prev) => ({ ...prev, email: e.target.value }))
                        }
                        aria-invalid={errors.email !== undefined}
                        className={invalid("email")}
                      />
                      {fieldError("email")}
                    </div>
                  </div>
                )}
              </section>

              {/* Rent and term, pre-filled */}
              <section className="space-y-3">
                <div>
                  <h3 className="text-sm font-medium">{t("sheet.terms")}</h3>
                  {!editing && !proof && (
                    <p className="text-xs text-[var(--color-muted-foreground)]">
                      {t("sheet.termsHint")}
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="tenancy-rent">
                      {t("sheet.rent", { symbol: currencySymbol })}
                    </Label>
                    <Input
                      id="tenancy-rent"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={form.monthlyRent || ""}
                      onChange={(e) => update(onRentChanged(form, parseFloat(e.target.value) || 0))}
                      aria-invalid={errors.monthlyRent !== undefined}
                      className={invalid("monthlyRent")}
                    />
                    {fieldError("monthlyRent")}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tenancy-deposit">
                      {t("sheet.deposit", { symbol: currencySymbol })}
                    </Label>
                    <Input
                      id="tenancy-deposit"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={form.deposit || ""}
                      onChange={(e) => update({ deposit: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tenancy-start">{t("field.startDate")}</Label>
                    <Input
                      id="tenancy-start"
                      type="date"
                      value={form.startDate}
                      onChange={(e) => update(onStartChanged(form, e.target.value))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tenancy-end">{t("field.endDate")}</Label>
                    <Input
                      id="tenancy-end"
                      type="date"
                      value={form.endDate}
                      onChange={(e) => update({ endDate: e.target.value })}
                      aria-invalid={errors.endDate !== undefined}
                      className={invalid("endDate")}
                    />
                    {fieldError("endDate")}
                  </div>
                </div>
              </section>

              {/* What can wait */}
              <section className="space-y-4">
                <button
                  type="button"
                  onClick={() => setShowMore((v) => !v)}
                  aria-expanded={showMore}
                  className="flex min-h-11 w-full items-center justify-between gap-2 border-t border-[var(--color-border)] pt-4 text-left"
                >
                  <span>
                    <span className="block text-sm font-medium">{t("sheet.more")}</span>
                    <span className="block text-xs text-[var(--color-muted-foreground)]">
                      {t("sheet.moreHint")}
                    </span>
                  </span>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 transition-transform",
                      showMore && "rotate-180",
                    )}
                  />
                </button>

                {showMore && (
                  <div className="space-y-6">
                    <LeasePartiesEditor
                      parties={form.parties ?? []}
                      onChange={(parties) => update({ parties })}
                      error={errors.parties}
                    />

                    <div className="space-y-2">
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="atContractNumber">{t("atContract.number")}</Label>
                          <Input
                            id="atContractNumber"
                            inputMode="numeric"
                            maxLength={20}
                            value={form.atContractNumber ?? ""}
                            onChange={(e) => update({ atContractNumber: e.target.value.trim() })}
                            aria-invalid={errors.atContractNumber !== undefined}
                            className={invalid("atContractNumber")}
                          />
                          {fieldError("atContractNumber")}
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="atContractVersion">{t("atContract.version")}</Label>
                          <Input
                            id="atContractVersion"
                            type="number"
                            min="1"
                            max="999"
                            value={form.atContractVersion ?? ""}
                            onChange={(e) => {
                              const version = parseInt(e.target.value, 10);
                              update({ atContractVersion: Number.isNaN(version) ? null : version });
                            }}
                          />
                        </div>
                      </div>
                      <p className="text-xs text-[var(--color-muted-foreground)]">
                        {t("atContract.hint")}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="renewalNoticeDays">{t("field.renewalNoticeDays")}</Label>
                        <Input
                          id="renewalNoticeDays"
                          type="number"
                          min="0"
                          value={form.renewalNoticeDays}
                          onChange={(e) =>
                            update({ renewalNoticeDays: parseInt(e.target.value) || 60 })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="contractFile">{t("contractPdf")}</Label>
                        <Input
                          id="contractFile"
                          type="file"
                          accept=".pdf"
                          onChange={handleFile}
                          className="hidden"
                        />
                        <Label
                          htmlFor="contractFile"
                          className="flex min-h-11 cursor-pointer items-center gap-2 border border-[var(--color-border)] bg-[var(--color-secondary)] px-4 py-2 transition-colors hover:bg-[var(--color-surface-hover)]"
                        >
                          <Upload className="h-4 w-4 shrink-0" />
                          <span className="truncate">
                            {contractFile ? contractFile.name : t("choosePdf")}
                          </span>
                        </Label>
                        <p className="text-xs text-[var(--color-muted-foreground)]">
                          {t("maxFileSize", { size: MAX_CONTRACT_MB })}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="notes">{t("additionalNotes")}</Label>
                      <Textarea
                        id="notes"
                        value={form.notes}
                        onChange={(e) => update({ notes: e.target.value })}
                        placeholder={t("notesPlaceholder")}
                        rows={4}
                      />
                    </div>
                  </div>
                )}
              </section>
            </div>

            <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-6 py-4">
              <Button
                type="button"
                variant="outline"
                disabled={submitting}
                onClick={() => onOpenChange(false)}
              >
                {tActions("cancel")}
              </Button>
              <Button type="submit" disabled={submitting}>
                {editing ? t("submitUpdate") : t("sheet.submit")}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
