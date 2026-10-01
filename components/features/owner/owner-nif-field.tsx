"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { validatePortugueseNIF } from "@/lib/utils/tax-id-validation";

/**
 * The NIF Finanças names a landlord by on a rent receipt, for an owner's form.
 *
 * Its check digit is tested as it is typed, and the message is this component's own, translated:
 * the schema's English "Invalid NIF" never reaches the screen, as in `TaxIdentityFields`.
 */
export function OwnerNifField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations("owners");
  const tIdentity = useTranslations("taxIdentity");
  const invalid = value.trim() !== "" && !validatePortugueseNIF(value);

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{tIdentity("nif")}</Label>
      <Input
        id={id}
        inputMode="numeric"
        autoComplete="off"
        maxLength={30}
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        aria-invalid={invalid}
        aria-describedby={`${id}-note`}
        className={invalid ? "border-destructive" : ""}
      />
      <p
        id={`${id}-note`}
        className={
          invalid ? "text-sm text-destructive" : "text-xs text-[var(--color-muted-foreground)]"
        }
      >
        {invalid ? tIdentity("invalidNif") : t("nifHint")}
      </p>
    </div>
  );
}
