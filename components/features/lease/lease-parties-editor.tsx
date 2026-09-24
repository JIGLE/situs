"use client";

import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TaxIdentityFields } from "@/components/shared/tax-identity-fields";
import { validatePortugueseNIF } from "@/lib/utils/tax-id-validation";

export interface LeasePartyDraft {
  role: "tenant" | "guarantor";
  name: string;
  taxId?: string | null;
  taxCountry?: string | null;
  idDocument?: string | null;
}

/**
 * A party the step cannot save: no name, or a Portuguese NIF whose check digit fails. The same
 * rules the lease schema applies, checked on the step so "Continue" can say so in the user's
 * language.
 */
export function leasePartiesInvalid(parties: LeasePartyDraft[] | undefined): boolean {
  return (parties ?? []).some(
    (party) =>
      !party.name.trim() ||
      ((party.taxCountry || "PT") === "PT" && !!party.taxId && !validatePortugueseNIF(party.taxId)),
  );
}

/** Co-tenants and guarantors: everyone on the contract besides the main tenant. */
export function LeasePartiesEditor({
  parties,
  onChange,
  error,
}: {
  parties: LeasePartyDraft[];
  onChange: (parties: LeasePartyDraft[]) => void;
  error?: string;
}) {
  const t = useTranslations("leases.parties");

  const update = (index: number, change: Partial<LeasePartyDraft>) =>
    onChange(parties.map((party, i) => (i === index ? { ...party, ...change } : party)));

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">{t("title")}</legend>
      <p className="text-xs text-[var(--color-muted-foreground)]">{t("description")}</p>

      {parties.map((party, index) => (
        <div
          key={index}
          className="space-y-3 rounded-lg border border-[var(--color-border)] p-3"
          data-testid="lease-party"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor={`party-${index}-role`}>{t("role")}</Label>
              <Select
                value={party.role}
                onValueChange={(role) => update(index, { role: role as LeasePartyDraft["role"] })}
              >
                <SelectTrigger id={`party-${index}-role`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tenant">{t("roleTenant")}</SelectItem>
                  <SelectItem value="guarantor">{t("roleGuarantor")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`party-${index}-name`}>{t("name")}</Label>
              <Input
                id={`party-${index}-name`}
                maxLength={200}
                value={party.name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  update(index, { name: e.target.value })
                }
              />
            </div>
          </div>
          <TaxIdentityFields
            idPrefix={`party-${index}`}
            value={party}
            onChange={(change) => update(index, change)}
          />
          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange(parties.filter((_, i) => i !== index))}
            >
              <Trash2 className="h-4 w-4 mr-2" aria-hidden="true" />
              {t("remove")}
            </Button>
          </div>
        </div>
      ))}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          onChange([...parties, { role: "tenant", name: "", taxId: "", taxCountry: "PT" }])
        }
      >
        <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
        {t("add")}
      </Button>
    </fieldset>
  );
}
