"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { countryOptions } from "@/lib/utils/countries";
import { validatePortugueseNIF } from "@/lib/utils/tax-id-validation";

export interface TaxIdentityValue {
  taxId?: string | null;
  taxCountry?: string | null;
  idDocument?: string | null;
}

/**
 * How AT names a tenant or co-tenant on a receipt: a NIF, the country that issued it, and, for
 * someone with no Portuguese NIF, an identity document.
 *
 * The NIF's check digit is tested here as it is typed, and the message is this component's own,
 * translated: the schema's English "Invalid NIF" never reaches the screen.
 */
export function TaxIdentityFields({
  idPrefix,
  value,
  onChange,
}: {
  /** Keeps the inputs' ids unique when several people are on one form. */
  idPrefix: string;
  value: TaxIdentityValue;
  onChange: (update: TaxIdentityValue) => void;
}) {
  const t = useTranslations("taxIdentity");
  const locale = useLocale();
  const countries = useMemo(() => countryOptions(locale), [locale]);

  const country = value.taxCountry || "PT";
  const portuguese = country === "PT";
  const nifInvalid = portuguese && !!value.taxId && !validatePortugueseNIF(value.taxId);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-taxCountry`}>{t("country")}</Label>
        <Select value={country} onValueChange={(code) => onChange({ taxCountry: code })}>
          <SelectTrigger id={`${idPrefix}-taxCountry`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {countries.map((option) => (
              <SelectItem key={option.code} value={option.code}>
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-taxId`}>{portuguese ? t("nif") : t("taxId")}</Label>
        <Input
          id={`${idPrefix}-taxId`}
          inputMode={portuguese ? "numeric" : "text"}
          autoComplete="off"
          maxLength={30}
          value={value.taxId ?? ""}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ taxId: e.target.value })}
          aria-invalid={nifInvalid}
          aria-describedby={nifInvalid ? `${idPrefix}-taxId-error` : undefined}
          className={nifInvalid ? "border-destructive" : ""}
        />
        {nifInvalid && (
          <p id={`${idPrefix}-taxId-error`} className="text-sm text-destructive">
            {t("invalidNif")}
          </p>
        )}
      </div>
      {!portuguese && (
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-idDocument`}>{t("idDocument")}</Label>
          <Input
            id={`${idPrefix}-idDocument`}
            autoComplete="off"
            maxLength={50}
            value={value.idDocument ?? ""}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onChange({ idDocument: e.target.value })
            }
          />
          <p className="text-xs text-[var(--color-muted-foreground)]">{t("idDocumentHint")}</p>
        </div>
      )}
    </div>
  );
}
