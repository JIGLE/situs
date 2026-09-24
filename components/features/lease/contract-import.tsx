"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FileUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useApp } from "@/lib/contexts/app-context";
import { useToast } from "@/lib/contexts/toast-context";
import { useApiError } from "@/lib/utils/api-error";
import { withEntityDetail } from "@/lib/utils/entity-detail-url";
import {
  MAX_CONTRACT_BYTES,
  MAX_CONTRACT_MB,
  MAX_PROOF_BYTES,
  MAX_PROOF_MB,
} from "@/lib/utils/contract-file";
import {
  draftFromReading,
  draftProblems,
  draftToImport,
  type ContractDraft,
  type DraftProblem,
} from "@/lib/services/contracts/draft";
import type { ContractExtraction } from "@/lib/services/contracts/schema";
import type { ContractMatches } from "@/lib/services/contracts/match";
import type en from "@/messages/en.json";
import {
  fetchReaderConfigured,
  importReviewed,
  readContract,
  type ImportFailure,
} from "./contract-import-api";
import { uploadContract } from "./lease-contract";
import { ContractReviewForm } from "./contract-review-form";

/**
 * Import a lease from its signed contract: choose the PDF (and AT's proof of registration), let
 * Claude read it, review every field against the words it came from, and confirm. Nothing is
 * written before Confirm; then the import route writes every record in one transaction, the
 * contract is stored through the lease's own contract route, and the new lease opens.
 *
 * The button shows only where a reader is configured. The sheet is `?import=contract`, so a link
 * or the mobile audit can open it, and closing it takes the parameter away.
 */

const PARAM = "import";
const VALUE = "contract";

type ImportErrorKey = keyof (typeof en)["leases"]["import"]["errors"];

/** The routes' `reason` codes the sheet has words for. Any other failure is said by its status. */
const REASONS = [
  "not_configured",
  "refused",
  "too_long",
  "unreadable",
  "rejected",
  "busy",
  "unavailable",
  "not_pdf",
  "too_large",
  "email_taken",
] as const satisfies readonly ImportErrorKey[];

const isReason = (reason: unknown): reason is (typeof REASONS)[number] =>
  (REASONS as readonly unknown[]).includes(reason);

export function ContractImport() {
  const t = useTranslations("leases.import");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { refreshData } = useApp();
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    let live = true;
    void fetchReaderConfigured().then((answer) => {
      if (live) setConfigured(answer);
    });
    return () => {
      live = false;
    };
  }, []);

  const open = configured && searchParams.get(PARAM) === VALUE;

  const withoutImport = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete(PARAM);
    return params;
  };
  // Not `params.size`: Safari before 17 has no such property, and every link would lose its query.
  const href = (params: URLSearchParams) => {
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  };

  const show = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.set(PARAM, VALUE);
    router.push(href(params), { scroll: false });
  };
  const close = () => router.replace(href(withoutImport()), { scroll: false });

  // Close first: the refresh swaps the page for its loading state, and the sheet would come back
  // empty on the way out if the parameter were still there. Then open what was just created.
  const imported = async (leaseId: string) => {
    const params = withoutImport();
    router.replace(href(params), { scroll: false });
    await refreshData();
    router.push(withEntityDetail(pathname, params.toString(), "lease", leaseId), {
      scroll: false,
    });
  };

  if (!configured) return null;

  return (
    <>
      <Button variant="outline" onClick={show} className="flex items-center gap-2">
        <FileUp className="h-4 w-4" aria-hidden="true" />
        {t("button")}
      </Button>
      <Sheet open={open} onOpenChange={(next) => !next && close()}>
        <SheetContent side="center" className="p-0">
          {/* Its own component, so closing the sheet unmounts it and the next import starts clean. */}
          <ImportFlow onCancel={close} onImported={imported} />
        </SheetContent>
      </Sheet>
    </>
  );
}

type Step = "choose" | "reading" | "review" | "saving";
type Reading = { reading: ContractExtraction; matches: ContractMatches };

function ImportFlow({
  onCancel,
  onImported,
}: {
  onCancel: () => void;
  onImported: (leaseId: string) => Promise<void>;
}) {
  const t = useTranslations("leases.import");
  const tLeases = useTranslations("leases");
  const tActions = useTranslations("actions");
  const locale = useLocale();
  const apiError = useApiError();
  const { success, error } = useToast();
  const { state } = useApp();

  const [step, setStep] = useState<Step>("choose");
  const [contract, setContract] = useState<File | null>(null);
  const [registration, setRegistration] = useState<File | null>(null);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const [answer, setAnswer] = useState<Reading | null>(null);
  const [draft, setDraft] = useState<ContractDraft | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  // A reading still running when the sheet closes is no longer wanted.
  useEffect(() => () => inFlight.current?.abort(), []);

  const messageFor = (err: unknown) => {
    const reason = (err as ImportFailure | null)?.reason;
    return isReason(reason) ? t(`errors.${reason}`) : apiError(err);
  };

  const problemText = (problem: DraftProblem) => {
    switch (problem.kind) {
      case "shares":
        return t("problems.shares", { total: problem.total });
      case "email":
        return t("problems.email", { name: problem.name });
      case "nif":
        return t("problems.nif", { name: problem.name });
      default:
        return t(`problems.${problem.kind}`);
    }
  };

  const pick = (
    input: HTMLInputElement,
    set: (file: File | null) => void,
    maxBytes: number,
    maxMb: number,
  ) => {
    const file = input.files?.[0] ?? null;
    const problem = !file
      ? null
      : file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)
        ? tLeases("toast.pdfOnly")
        : file.size > maxBytes
          ? tLeases("toast.fileTooLarge", { size: maxMb })
          : null;
    setFileProblem(problem);
    if (problem) input.value = "";
    set(problem ? null : file);
  };

  const read = async () => {
    if (!contract) return;
    const controller = new AbortController();
    inFlight.current = controller;
    setFailure(null);
    setStep("reading");
    try {
      const result = await readContract(contract, registration, locale, controller.signal);
      setAnswer(result);
      setDraft(draftFromReading(result.reading, result.matches));
      setStep("review");
    } catch (err) {
      if (controller.signal.aborted) return;
      setFailure(messageFor(err));
      setStep("choose");
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
    }
  };

  const confirm = async () => {
    if (!draft || !contract) return;
    setFailure(null);
    setStep("saving");
    let leaseId: string;
    try {
      ({ leaseId } = await importReviewed(draftToImport(draft)));
    } catch (err) {
      setFailure(messageFor(err));
      setStep("review");
      return;
    }
    // The lease exists now. A contract that fails to store is said, not undone: it can be
    // uploaded again from the lease.
    try {
      await uploadContract(leaseId, contract);
      success(t("created"));
    } catch {
      error(tLeases("toast.contractUploadFailed"));
    }
    await onImported(leaseId);
  };

  const problems = draft ? draftProblems(draft) : [];
  const reviewing = step === "review" || step === "saving";

  return (
    <>
      <SheetHeader className="pr-14">
        <SheetTitle>{t("title")}</SheetTitle>
        <SheetDescription>{t("description")}</SheetDescription>
      </SheetHeader>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
        {failure && (
          <p
            role="alert"
            className="rounded-md border border-[var(--color-destructive)]/30 bg-[var(--color-destructive)]/10 p-3 text-sm text-[var(--color-destructive)]"
          >
            {failure}
          </p>
        )}

        {/* Hidden rather than unmounted, so Back finds the files still chosen. */}
        <div className="space-y-5" hidden={step !== "choose"}>
          <div className="space-y-2">
            <Label htmlFor="import-contract-file">{t("contractFile")}</Label>
            <Input
              id="import-contract-file"
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => pick(e.target, setContract, MAX_CONTRACT_BYTES, MAX_CONTRACT_MB)}
            />
            <p className="text-sm text-[var(--color-muted-foreground)]">
              {tLeases("maxFileSize", { size: MAX_CONTRACT_MB })}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="import-proof-file">{t("proofFile")}</Label>
            <Input
              id="import-proof-file"
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => pick(e.target, setRegistration, MAX_PROOF_BYTES, MAX_PROOF_MB)}
            />
          </div>
          {fileProblem && (
            <p role="alert" className="text-sm text-[var(--color-destructive)]">
              {fileProblem}
            </p>
          )}
          <p className="rounded-md border border-[var(--color-info)]/30 bg-[var(--color-info-muted)] p-3 text-sm">
            {t("transfer")}
          </p>
        </div>

        {step === "reading" && (
          <p role="status" className="flex items-center gap-3 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t("reading")}
          </p>
        )}

        {reviewing && answer && draft && (
          <>
            {problems.length > 0 && (
              <div
                role="status"
                className="rounded-md border border-[var(--color-warning)]/30 bg-[var(--color-warning-muted)] p-3 text-sm"
                data-testid="import-problems"
              >
                <p className="font-medium">{t("problemsTitle")}</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {problems.map((problem, i) => (
                    <li key={i}>{problemText(problem)}</li>
                  ))}
                </ul>
              </div>
            )}
            <ContractReviewForm
              draft={draft}
              onChange={setDraft}
              reading={answer.reading}
              matches={answer.matches}
              properties={state.properties.map(({ id, name }) => ({ id, name }))}
              owners={state.owners.map(({ id, name }) => ({ id, name }))}
              tenants={state.tenants.map(({ id, name }) => ({ id, name }))}
            />
          </>
        )}
      </div>

      <div className="flex flex-col-reverse gap-2 border-t border-[var(--color-border)] px-6 py-4 sm:flex-row sm:justify-end">
        {reviewing ? (
          <>
            <Button
              variant="outline"
              disabled={step === "saving"}
              onClick={() => setStep("choose")}
            >
              {tActions("back")}
            </Button>
            <Button disabled={step === "saving" || problems.length > 0} onClick={confirm}>
              {step === "saving" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {t("confirm")}
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={onCancel}>
              {tActions("cancel")}
            </Button>
            <Button disabled={!contract || step === "reading"} onClick={read}>
              {step === "reading" && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              {t("read")}
            </Button>
          </>
        )}
      </div>
    </>
  );
}
