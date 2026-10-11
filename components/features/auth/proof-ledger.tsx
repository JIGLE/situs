import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils/utils";

/** The three steps of the owner's workflow, one ruled line each. */
const PROOF_KEYS = [
  { k: "01", label: "bankLabel", note: "bankNote" },
  { k: "02", label: "receiptLabel", note: "receiptNote" },
  { k: "03", label: "auditLabel", note: "auditNote" },
] as const;

/**
 * What Situs does, as a statement would list it: bank movement, receipt, audit trail, numbered and
 * ruled. It is the sign-in page's brand content on every screen size (it replaced a panel that only
 * a computer saw), and it gives way before the form does: below 760px of screen height the
 * one-line notes go, below 700px the whole list, so a short phone never scrolls.
 */
export function ProofLedger({ className }: { className?: string }): React.ReactElement {
  const t = useTranslations("auth");
  const tBrand = useTranslations("auth.brand");

  return (
    <ol
      aria-label={t("ledgerLabel")}
      className={cn("border-t border-[var(--color-border)]", className)}
    >
      {PROOF_KEYS.map((proof) => (
        <li
          key={proof.k}
          className="flex items-start gap-4 border-b border-[var(--color-border)] py-3"
        >
          <span className="mono-label-xs pt-0.5 tabular-nums text-[var(--country-highlight-readable)]">
            {proof.k}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-[var(--color-foreground)]">
              {tBrand(`proof.${proof.label}`)}
            </p>
            <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)] [@media(max-height:760px)]:hidden">
              {tBrand(`proof.${proof.note}`)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
