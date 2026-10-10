"use client";

import { useTranslations } from "next-intl";
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
import { Loader2, AlertTriangle, Trash2 } from "lucide-react";
import type { UseConfirmDialogReturn } from "@/lib/hooks/use-confirm-dialog";

interface ConfirmationDialogProps {
  dialog: UseConfirmDialogReturn;
}

export function ConfirmationDialog({ dialog }: ConfirmationDialogProps) {
  const t = useTranslations("common");
  const { state, cancel, handleConfirm } = dialog;
  const isDestructive = state.variant === "destructive";

  return (
    <AlertDialog open={state.isOpen} onOpenChange={(open) => !open && cancel()}>
      <AlertDialogContent className="glass-modal rounded-xl max-w-md">
        <AlertDialogHeader>
          <div className="flex items-start gap-4">
            <div
              className={
                isDestructive
                  ? "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-destructive)]/10 text-[var(--color-destructive)]"
                  : "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
              }
            >
              {isDestructive ? (
                <Trash2 className="h-5 w-5" />
              ) : (
                <AlertTriangle className="h-5 w-5" />
              )}
            </div>
            <div className="space-y-2">
              <AlertDialogTitle className="text-lg font-semibold text-[var(--color-foreground)]">
                {state.title}
                {state.count && state.count > 1 && (
                  <span className="ml-2 inline-flex items-center justify-center rounded-full bg-[var(--color-destructive)]/10 px-2 py-0.5 text-xs font-medium text-[var(--color-destructive)]">
                    {state.count}
                  </span>
                )}
              </AlertDialogTitle>
              <AlertDialogDescription className="text-sm text-[var(--color-muted-foreground)]">
                {state.description}
              </AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-2 pt-4 border-t border-[var(--color-inner-border)]">
          <AlertDialogCancel
            onClick={cancel}
            disabled={state.isLoading}
            className="rounded-lg border-[var(--color-inner-border)] bg-transparent text-[var(--color-foreground)] hover:bg-[var(--color-hover)]"
          >
            {state.cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleConfirm();
            }}
            disabled={state.isLoading}
            className={
              isDestructive
                ? "rounded-lg bg-[var(--color-destructive)] text-white hover:bg-[var(--color-destructive)]/90 disabled:opacity-50"
                : "rounded-lg bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:bg-[var(--color-primary)]/90 disabled:opacity-50"
            }
          >
            {state.isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("processing")}
              </>
            ) : (
              state.confirmLabel
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
