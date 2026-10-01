"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { useApp } from "@/lib/contexts/app-context";
import { useAttention } from "@/lib/hooks/use-attention";
import type { AttentionItem } from "@/lib/services/attention/rules";
import { useApiError, wasReported } from "@/lib/utils/api-error";
import { ATTENTION_WEIGHT_KEY } from "@/lib/utils/attention-labels";

/** AT's contract numbers are `long`: eighteen digits is always one. */
const CONTRACT_NUMBER_DIGITS = 18;

/**
 * What is still missing, in the order that matters, with what is skipped at the end. Skipping moves
 * an item behind the others; skipping it again moves it behind the ones skipped before it.
 */
function inOrder(items: AttentionItem[], skipped: string[]): AttentionItem[] {
  const later = new Set(skipped);
  return [
    ...items.filter((item) => !later.has(item.id)),
    ...skipped.flatMap((id) => items.filter((item) => item.id === id)),
  ];
}

/**
 * The guided list: one missing field at a time, what Situs already knows about it, and a box to
 * fill it in. An answer is saved through its record's own action, so the record's own validation
 * applies and every other screen sees the change.
 */
export function CompleteView() {
  const t = useTranslations("completion");
  const apiError = useApiError();
  const { updateLease, updateOwner, updateTenant } = useApp();
  const { data, error, reload } = useAttention();

  const [skipped, setSkipped] = useState<string[]>([]);
  // What is typed, and what went wrong, each for the item it is about: a new question starts from
  // what is stored without an effect to reset it, and a refetch that leaves the question alone
  // leaves the owner's typing alone.
  const [draft, setDraft] = useState<{ id: string; value: string } | null>(null);
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const queue = inOrder(data?.items ?? [], skipped);
  const current = queue[0] ?? null;
  const currentId = current?.id;

  // A value that was refused is offered back, to be corrected rather than typed again.
  const value = draft && draft.id === currentId ? draft.value : (current?.current ?? "");
  const problem = failure && failure.id === currentId ? failure.message : null;

  useEffect(() => {
    inputRef.current?.focus();
  }, [currentId]);

  const save = (item: AttentionItem, answer: string): Promise<unknown> => {
    switch (item.kind) {
      case "contract_number":
        return updateLease(item.record.id, { atContractNumber: answer });
      case "landlord_nif":
        return updateOwner(item.record.id, { taxIdentificationNumber: answer });
      case "tenant_nif":
        return updateTenant(item.record.id, { taxId: answer });
      case "tenant_document":
        return updateTenant(item.record.id, { idDocument: answer });
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const answer = value.trim();
    if (!current || !answer || saving) return;

    setSaving(true);
    setFailure(null);
    try {
      await save(current, answer);
      await reload();
    } catch (err) {
      // The action has already told the owner, in their language, when it could.
      if (!wasReported(err)) setFailure({ id: current.id, message: apiError(err) });
    } finally {
      setSaving(false);
    }
  };

  const skip = () => {
    if (!current) return;
    setSkipped((previous) => [...previous.filter((id) => id !== current.id), current.id]);
  };

  let body: React.ReactNode;
  if (error && !data) {
    body = (
      <div className="panel space-y-4 p-5" role="alert">
        <p className="text-sm text-[var(--semantic-danger-readable)]">{apiError(error)}</p>
        <Button variant="outline" onClick={() => void reload()}>
          {t("retry")}
        </Button>
      </div>
    );
  } else if (!data) {
    body = (
      <div className="panel p-5" aria-busy="true">
        <div className="h-24 animate-pulse bg-[var(--color-muted)]/30" />
        <span className="sr-only">{t("loading")}</span>
      </div>
    );
  } else if (!current) {
    body = (
      <div className="panel space-y-4 p-5" data-testid="complete-done">
        <h2 className="text-base font-medium text-[var(--color-foreground)]">{t("doneTitle")}</h2>
        <p className="text-sm text-[var(--color-muted-foreground)]">{t("doneBody")}</p>
        <Button asChild>
          <Link href="/dashboard">{t("backToDashboard")}</Link>
        </Button>
      </div>
    );
  } else {
    const kind = current.kind;
    body = (
      <form onSubmit={submit} className="panel space-y-4 p-5" data-testid="complete-item">
        <p className="mono-label">{t(ATTENTION_WEIGHT_KEY[current.weight])}</p>
        <p className="text-sm text-[var(--color-foreground)]">
          {t(`kind.${kind}.about`, { name: current.name, property: current.property ?? "—" })}
        </p>

        <div>
          <label htmlFor="complete-value" className="mono-label-xs mb-1.5 block">
            {t(`kind.${kind}.label`)}
          </label>
          <input
            ref={inputRef}
            id="complete-value"
            name="value"
            type="text"
            inputMode={kind === "tenant_document" ? "text" : "numeric"}
            autoComplete="off"
            spellCheck={false}
            maxLength={kind === "contract_number" ? CONTRACT_NUMBER_DIGITS : 50}
            value={value}
            onChange={(event) => setDraft({ id: current.id, value: event.target.value })}
            placeholder={t(`kind.${kind}.placeholder`)}
            aria-describedby="complete-hint"
            className="w-full border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm text-[var(--color-foreground)] outline-none transition-colors placeholder:text-[var(--color-muted-foreground)] focus:border-[var(--country-highlight-readable)] focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
          />
          <p id="complete-hint" className="mt-1.5 text-xs text-[var(--color-muted-foreground)]">
            {t(`kind.${kind}.hint`)}
          </p>
        </div>

        {current.problem === "invalid" && current.current && (
          <p className="text-sm text-[var(--semantic-danger-readable)]">
            {t("notValid", { value: current.current })}
          </p>
        )}
        {problem && (
          <p role="alert" className="text-sm text-[var(--semantic-danger-readable)]">
            {problem}
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {queue.length > 1 && (
            <Button type="button" variant="outline" onClick={skip} disabled={saving}>
              {t("skip")}
            </Button>
          )}
          <Button type="submit" disabled={saving || !value.trim()}>
            {saving ? t("saving") : t("save")}
          </Button>
        </div>

        {skipped.length > 0 && (
          <p className="text-xs text-[var(--color-muted-foreground)]">{t("skippedNote")}</p>
        )}
      </form>
    );
  }

  return (
    <section className="mx-auto w-full max-w-xl space-y-4" aria-labelledby="complete-title">
      <div>
        <h1
          id="complete-title"
          className="text-[clamp(22px,4vw,28px)] font-normal leading-tight tracking-[-0.02em] text-[var(--color-foreground)]"
        >
          {t("title")}
        </h1>
        {data && data.items.length > 0 && (
          <p
            className="mt-1 text-sm text-[var(--color-muted-foreground)]"
            aria-live="polite"
            data-testid="complete-left"
          >
            {t("left", { count: queue.length })}
          </p>
        )}
      </div>
      {body}
    </section>
  );
}
