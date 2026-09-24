"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TaxIdentityFields } from "@/components/shared/tax-identity-fields";
import { LeasePartiesEditor } from "./lease-parties-editor";
import { NEW, type ContractDraft } from "@/lib/services/contracts/draft";
import type { ContractExtraction } from "@/lib/services/contracts/schema";
import type { ContractMatches } from "@/lib/services/contracts/match";
import { nifInvalid } from "@/lib/services/contracts/review";

/**
 * The review of a contract's reading: every field editable, each shown with the words and page it
 * was read from, and each person and the property linked to one of the owner's records or marked
 * new. The sheet around it (contract-import.tsx) owns the draft and Confirm.
 */

type Source = ContractExtraction["property"]["source"];
type Choice = { id: string; name: string };

const PROPERTY_TYPES = ["apartment", "house", "condo", "townhouse", "commercial", "other"] as const;

/** Where a value was read, or that the documents do not say. */
function SourceLine({ source }: { source: Source }) {
  const t = useTranslations("leases.import");
  return (
    <p className="text-xs text-[var(--color-muted-foreground)]">
      {source ? t("source", { page: source.page, quote: source.quote }) : t("notStated")}
    </p>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

/** Link to an existing record, or create one. */
function RecordPicker({
  id,
  value,
  onChange,
  records,
  newLabel,
  matchedBy,
}: {
  id: string;
  value: string;
  onChange: (recordId: string) => void;
  records: Choice[];
  newLabel: string;
  matchedBy: string | null;
}) {
  const t = useTranslations("leases.import");
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{t("linkTo")}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NEW}>{newLabel}</SelectItem>
          {records.map((record) => (
            <SelectItem key={record.id} value={record.id}>
              {record.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {matchedBy && <p className="text-xs text-[var(--color-success)]">{matchedBy}</p>}
    </div>
  );
}

export function ContractReviewForm({
  draft,
  onChange,
  reading,
  matches,
  properties,
  owners,
  tenants,
}: {
  draft: ContractDraft;
  onChange: (draft: ContractDraft) => void;
  reading: ContractExtraction;
  matches: ContractMatches;
  properties: Choice[];
  owners: Choice[];
  tenants: Choice[];
}) {
  const t = useTranslations("leases.import");
  const tLeases = useTranslations("leases");
  const tProperty = useTranslations("properties");
  const tForms = useTranslations("forms");
  const tTax = useTranslations("taxIdentity");

  const matchedBy = (match: { id: string; by: keyof typeof BY_KEY } | null, recordId: string) =>
    match && match.id === recordId ? t("matched", { by: t(BY_KEY[match.by]) }) : null;

  const { property, tenant, terms } = draft;
  const setProperty = (change: Partial<ContractDraft["property"]>) =>
    onChange({ ...draft, property: { ...property, ...change } });
  const setTenant = (change: Partial<ContractDraft["tenant"]>) =>
    onChange({ ...draft, tenant: { ...tenant, ...change } });
  const setTerms = (change: Partial<ContractDraft["terms"]>) =>
    onChange({ ...draft, terms: { ...terms, ...change } });
  const setLandlord = (index: number, change: Partial<ContractDraft["landlords"][number]>) =>
    onChange({
      ...draft,
      landlords: draft.landlords.map((l, i) => (i === index ? { ...l, ...change } : l)),
    });

  return (
    <div className="space-y-8">
      <section className="space-y-4" aria-labelledby="import-property">
        <h3 id="import-property" className="text-sm font-semibold">
          {t("property")}
        </h3>
        <RecordPicker
          id="import-property-record"
          value={property.recordId}
          onChange={(recordId) => setProperty({ recordId })}
          records={properties}
          newLabel={t("newProperty")}
          matchedBy={matchedBy(matches.property, property.recordId)}
        />
        {property.recordId === NEW && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field id="import-property-name" label={tProperty("fields.name")}>
              <Input
                id="import-property-name"
                value={property.name}
                onChange={(e) => setProperty({ name: e.target.value })}
              />
            </Field>
            <Field id="import-property-address" label={tForms("address")}>
              <Input
                id="import-property-address"
                value={property.address}
                onChange={(e) => setProperty({ address: e.target.value })}
              />
            </Field>
            <Field id="import-property-cadaster" label={tProperty("fields.cadasterReference")}>
              <Input
                id="import-property-cadaster"
                value={property.cadasterReference}
                onChange={(e) => setProperty({ cadasterReference: e.target.value })}
              />
            </Field>
            <Field id="import-property-fraction" label={tProperty("fields.fraction")}>
              <Input
                id="import-property-fraction"
                value={property.fraction}
                onChange={(e) => setProperty({ fraction: e.target.value })}
              />
            </Field>
            <Field id="import-property-type" label={tProperty("fields.type")}>
              <Select
                value={property.type}
                onValueChange={(type) =>
                  setProperty({ type: type as ContractDraft["property"]["type"] })
                }
              >
                <SelectTrigger id="import-property-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROPERTY_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {tProperty(`types.${type}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field id="import-property-bedrooms" label={tProperty("fields.bedrooms")}>
                <Input
                  id="import-property-bedrooms"
                  type="number"
                  min={0}
                  value={property.bedrooms}
                  onChange={(e) => setProperty({ bedrooms: e.target.value })}
                />
              </Field>
              <Field id="import-property-bathrooms" label={tProperty("fields.bathrooms")}>
                <Input
                  id="import-property-bathrooms"
                  type="number"
                  min={0}
                  value={property.bathrooms}
                  onChange={(e) => setProperty({ bathrooms: e.target.value })}
                />
              </Field>
            </div>
          </div>
        )}
        <SourceLine source={reading.property.source} />
      </section>

      {draft.landlords.length > 0 && (
        <section className="space-y-4" aria-labelledby="import-landlords">
          <h3 id="import-landlords" className="text-sm font-semibold">
            {t("landlords")}
          </h3>
          <p className="text-xs text-[var(--color-muted-foreground)]">{t("ownedNote")}</p>
          {draft.landlords.map((landlord, i) => (
            <div
              key={i}
              className="space-y-4 rounded-lg border border-[var(--color-border)] p-3"
              data-testid="import-landlord"
            >
              <p className="text-sm font-medium">{landlord.name}</p>
              <RecordPicker
                id={`import-landlord-${i}-record`}
                value={landlord.recordId}
                onChange={(recordId) => setLandlord(i, { recordId })}
                records={owners}
                newLabel={t("newOwner")}
                matchedBy={matchedBy(matches.landlords[i] ?? null, landlord.recordId)}
              />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {landlord.recordId === NEW && (
                  <>
                    <Field id={`import-landlord-${i}-email`} label={tForms("email")}>
                      <Input
                        id={`import-landlord-${i}-email`}
                        type="email"
                        value={landlord.email}
                        onChange={(e) => setLandlord(i, { email: e.target.value })}
                      />
                    </Field>
                    <Field id={`import-landlord-${i}-nif`} label={tTax("nif")}>
                      <Input
                        id={`import-landlord-${i}-nif`}
                        inputMode="numeric"
                        value={landlord.taxId}
                        aria-invalid={nifInvalid(landlord.taxId, landlord.taxCountry)}
                        onChange={(e) => setLandlord(i, { taxId: e.target.value })}
                      />
                    </Field>
                  </>
                )}
                <Field id={`import-landlord-${i}-share`} label={t("share")}>
                  <Input
                    id={`import-landlord-${i}-share`}
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={landlord.share}
                    onChange={(e) => setLandlord(i, { share: e.target.value })}
                  />
                </Field>
              </div>
              <SourceLine source={reading.landlords[i]?.source ?? null} />
            </div>
          ))}
        </section>
      )}

      <section className="space-y-4" aria-labelledby="import-tenant">
        <h3 id="import-tenant" className="text-sm font-semibold">
          {t("tenant")}
        </h3>
        <RecordPicker
          id="import-tenant-record"
          value={tenant.recordId}
          onChange={(recordId) => setTenant({ recordId })}
          records={tenants}
          newLabel={t("newTenant")}
          matchedBy={matchedBy(matches.tenants[0] ?? null, tenant.recordId)}
        />
        {tenant.recordId === NEW && (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field id="import-tenant-name" label={tForms("fullName")}>
                <Input
                  id="import-tenant-name"
                  value={tenant.name}
                  onChange={(e) => setTenant({ name: e.target.value })}
                />
              </Field>
              <Field id="import-tenant-email" label={tForms("email")}>
                <Input
                  id="import-tenant-email"
                  type="email"
                  value={tenant.email}
                  onChange={(e) => setTenant({ email: e.target.value })}
                />
              </Field>
              <Field id="import-tenant-phone" label={tForms("phone")}>
                <Input
                  id="import-tenant-phone"
                  type="tel"
                  value={tenant.phone}
                  onChange={(e) => setTenant({ phone: e.target.value })}
                />
              </Field>
            </div>
            <TaxIdentityFields
              idPrefix="import-tenant"
              value={tenant}
              onChange={(change) =>
                setTenant({
                  ...(change.taxId !== undefined && { taxId: change.taxId ?? "" }),
                  ...(change.taxCountry !== undefined && { taxCountry: change.taxCountry ?? "PT" }),
                  ...(change.idDocument !== undefined && { idDocument: change.idDocument ?? "" }),
                })
              }
            />
          </>
        )}
        <SourceLine source={reading.tenants[0]?.source ?? null} />
      </section>

      <LeasePartiesEditor
        parties={draft.parties}
        onChange={(parties) =>
          onChange({
            ...draft,
            parties: parties.map((party) => ({
              role: party.role,
              name: party.name,
              taxId: party.taxId ?? "",
              taxCountry: party.taxCountry ?? "PT",
              idDocument: party.idDocument ?? "",
            })),
          })
        }
      />

      <section className="space-y-4" aria-labelledby="import-terms">
        <h3 id="import-terms" className="text-sm font-semibold">
          {t("terms")}
        </h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {(
            [
              ["startDate", "field.startDate", "date"],
              ["endDate", "field.endDate", "date"],
              ["monthlyRent", "field.monthlyRent", "number"],
              ["deposit", "field.deposit", "number"],
              ["renewalNoticeDays", "field.renewalNoticeDays", "number"],
            ] as const
          ).map(([key, label, type]) => (
            <div key={key} className="space-y-2">
              <Label htmlFor={`import-${key}`}>{tLeases(label)}</Label>
              <Input
                id={`import-${key}`}
                type={type}
                min={type === "number" ? 0 : undefined}
                value={terms[key]}
                onChange={(e) => setTerms({ [key]: e.target.value })}
              />
              <SourceLine source={reading.terms[key].source} />
            </div>
          ))}
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Switch
                id="import-autoRenew"
                checked={terms.autoRenew}
                onCheckedChange={(autoRenew) => setTerms({ autoRenew })}
              />
              <Label htmlFor="import-autoRenew">{tLeases("autoRenew")}</Label>
            </div>
            <SourceLine source={reading.terms.autoRenew.source} />
          </div>
          <Field id="import-atNumber" label={tLeases("atContract.number")}>
            <Input
              id="import-atNumber"
              inputMode="numeric"
              value={terms.atContractNumber}
              onChange={(e) => setTerms({ atContractNumber: e.target.value.trim() })}
            />
          </Field>
          <Field id="import-atVersion" label={tLeases("atContract.version")}>
            <Input
              id="import-atVersion"
              type="number"
              min={1}
              value={terms.atContractVersion}
              onChange={(e) => setTerms({ atContractVersion: e.target.value })}
            />
          </Field>
        </div>
        {reading.registration && <SourceLine source={reading.registration.source} />}
      </section>

      {draft.clauses.length > 0 && (
        <section className="space-y-3" aria-labelledby="import-clauses">
          <h3 id="import-clauses" className="text-sm font-semibold">
            {t("clauses")}
          </h3>
          <ul className="space-y-3">
            {draft.clauses.map((clause, i) => (
              <li key={i} className="rounded-lg border border-[var(--color-border)] p-3 text-sm">
                <p className="font-medium">{t(`clauseKind.${clause.kind}`)}</p>
                <p>{clause.summary}</p>
                {clause.page ? (
                  <SourceLine source={{ page: clause.page, quote: clause.quote }} />
                ) : (
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    <q>{clause.quote}</q>
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** How a match was made, as its label key under `leases.import.matchedBy`. */
const BY_KEY = {
  matrix: "matchedBy.matrix",
  address: "matchedBy.address",
  nif: "matchedBy.nif",
  email: "matchedBy.email",
} as const;
