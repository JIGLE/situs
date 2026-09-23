"use client";

import * as React from "react";
import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2,
  Circle,
  ChevronDown,
  ChevronUp,
  Sparkles,
  ArrowRight,
  X,
} from "lucide-react";
import { Button } from "./button";
import { cn } from "@/lib/utils/utils";
import { useTranslations } from "next-intl";
import { csrfHeaders } from "@/lib/utils/api-client";

// Collapse state is a pure UI-density preference — fine to keep client-only.
const CHECKLIST_COLLAPSED_KEY = "situs.onboarding.checklist.collapsed";

export interface OnboardingChecklistStep {
  id: string;
  label: string;
  description: string;
  completed: boolean;
  icon: React.ComponentType<{ className?: string }>;
  action?: () => void;
  actionLabel?: string;
}

interface OnboardingChecklistProps {
  steps: OnboardingChecklistStep[];
  className?: string;
  /** Called when user dismisses the checklist */
  onDismiss?: () => void;
  /** Called when all steps are complete */
  onAllComplete?: () => void;
}

export function OnboardingChecklist({
  steps,
  className,
  onDismiss,
  onAllComplete,
}: OnboardingChecklistProps): React.ReactElement | null {
  const [dismissed, setDismissed] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [celebrateComplete, setCelebrateComplete] = useState(false);
  const t = useTranslations("onboarding");

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(CHECKLIST_COLLAPSED_KEY) === "true");
    } catch {
      // Ignore
    }

    // Dismissal is a server-side UserSettings field (was localStorage-only,
    // so it didn't survive across browsers/devices and couldn't be measured).
    let cancelled = false;
    fetch("/api/settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled) return;
        if (json?.data?.onboardingDismissedAt) setDismissed(true);
      })
      .catch(() => {
        // Default to not-dismissed on failure — showing the checklist again
        // is the safe direction to fail in, not hiding it permanently.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const completedCount = useMemo(() => steps.filter((s) => s.completed).length, [steps]);
  const totalSteps = steps.length;
  const allComplete = completedCount === totalSteps;
  const progress = totalSteps > 0 ? (completedCount / totalSteps) * 100 : 0;

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    fetch("/api/settings", {
      method: "POST",
      headers: csrfHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ onboardingDismissedAt: new Date().toISOString() }),
    }).catch(() => {
      // Fire-and-forget: the optimistic local dismiss already happened, and
      // /api/settings will be retried next time the user (or a settings
      // change) triggers a save. Worst case the checklist reappears once.
    });
    onDismiss?.();
  }, [onDismiss]);

  // Trigger celebration when all complete
  useEffect(() => {
    if (allComplete && !celebrateComplete) {
      setCelebrateComplete(true);
      onAllComplete?.();
    }
  }, [allComplete, celebrateComplete, onAllComplete]);

  const handleToggleCollapse = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(CHECKLIST_COLLAPSED_KEY, String(next));
      } catch {
        // Ignore
      }
      return next;
    });
  }, []);

  if (dismissed) return null;

  // Find the first incomplete step to highlight
  const nextStep = steps.find((s) => !s.completed);

  // This card is the guided first-run itself (property → tenant → lease → payment) —
  // observed live to sometimes render permanently stuck at its `initial` (opacity: 0)
  // keyframe on mount, hiding the whole checklist with no way to recover short of a
  // hard reload. A decorative entrance fade isn't worth the risk of hiding required
  // first-run UI, so this renders as a plain (always-visible) element; the collapse/
  // expand interaction below is user-triggered and unaffected.
  return (
    <div
      className={cn(
        "rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] overflow-hidden",
        className,
      )}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-[var(--color-surface-hover)] transition-colors"
        onClick={handleToggleCollapse}
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleToggleCollapse();
          }
        }}
      >
        <div className="flex items-center gap-3">
          <Sparkles className="h-4 w-4 text-amber-400" />
          <div>
            <h3 className="text-sm font-semibold text-[var(--color-foreground)]">
              {allComplete ? `🎉 ${t("setupComplete")}` : t("gettingStarted")}
            </h3>
            <p className="text-xs text-[var(--color-muted-foreground)]">
              {allComplete ? t("allSet") : `${completedCount} of ${totalSteps} ${t("complete")}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Progress indicator */}
          <div className="hidden sm:flex items-center gap-1.5">
            {steps.map((step) => (
              <div
                key={step.id}
                className={cn(
                  "h-1.5 w-1.5 rounded-full transition-colors",
                  step.completed ? "bg-[var(--color-success)]" : "bg-[var(--color-muted)]",
                )}
              />
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={(e) => {
              e.stopPropagation();
              handleDismiss();
            }}
            title={t("dismissTooltip")}
            aria-label={t("dismissAriaLabel")}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
          {collapsed ? (
            <ChevronDown className="h-4 w-4 text-[var(--color-muted-foreground)]" />
          ) : (
            <ChevronUp className="h-4 w-4 text-[var(--color-muted-foreground)]" />
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-0.5 bg-[var(--color-muted)]">
        <motion.div
          className="h-full bg-[var(--color-success)]"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      </div>

      {/* Steps */}
      <AnimatePresence>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            {allComplete ? (
              /* Completion state with What's Next? */
              <div className="p-4">
                <div className="text-center mb-3">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: [0, 1.3, 1] }}
                    transition={{
                      type: "spring",
                      stiffness: 400,
                      damping: 15,
                    }}
                    className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[var(--color-success)]/20 mb-3"
                  >
                    <CheckCircle2 className="h-6 w-6 text-[var(--color-success)]" />
                  </motion.div>
                  <motion.p
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="text-sm text-[var(--color-foreground)] font-medium"
                  >
                    {t("allSetHeadline")}
                  </motion.p>
                </div>

                {/* What's Next? suggestions */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5 }}
                  className="border-t border-[var(--color-border)] pt-3 mt-1"
                >
                  <p className="text-xs font-semibold text-[var(--color-foreground)] mb-2">
                    {t("whatsNext")}
                  </p>
                  <ul className="space-y-1.5">
                    <li className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
                      <ArrowRight className="h-3 w-3 text-[var(--color-primary)] shrink-0" />
                      <span>{t("nextStepLease")}</span>
                    </li>
                    <li className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
                      <ArrowRight className="h-3 w-3 text-[var(--color-primary)] shrink-0" />
                      <span>{t("nextStepInsights")}</span>
                    </li>
                  </ul>
                </motion.div>
              </div>
            ) : (
              /* Step list */
              <div className="p-2">
                {steps.map((step, index) => {
                  const isNext = nextStep?.id === step.id;

                  return (
                    <motion.div
                      key={step.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors",
                        isNext
                          ? "bg-[var(--color-accent)]/5 border border-[var(--color-accent)]/20"
                          : "hover:bg-[var(--color-surface-hover)]",
                      )}
                    >
                      {/* Status icon */}
                      {step.completed ? (
                        <motion.div
                          initial={{ scale: 1 }}
                          animate={{ scale: [1, 1.3, 1] }}
                          transition={{
                            type: "spring",
                            stiffness: 400,
                            damping: 15,
                          }}
                        >
                          <CheckCircle2 className="h-5 w-5 text-[var(--color-success)] flex-shrink-0" />
                        </motion.div>
                      ) : (
                        <Circle
                          className={cn(
                            "h-5 w-5 flex-shrink-0",
                            isNext
                              ? "text-[var(--color-accent)]"
                              : "text-[var(--color-muted-foreground)]",
                          )}
                        />
                      )}

                      {/* Step info */}
                      <div className="flex-1 min-w-0">
                        <p
                          className={cn(
                            "text-sm font-medium transition-all duration-300",
                            step.completed
                              ? "text-[var(--color-muted-foreground)] line-through decoration-[var(--color-success)]/50"
                              : "text-[var(--color-foreground)]",
                          )}
                        >
                          {step.label}
                        </p>
                        {isNext && (
                          <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
                            {step.description}
                          </p>
                        )}
                      </div>

                      {/* Action button for next step */}
                      {isNext && step.action && (
                        <Button
                          size="sm"
                          onClick={step.action}
                          className="gap-1.5 text-xs shrink-0"
                        >
                          {step.actionLabel || t("startAction")}
                          <ArrowRight className="h-3 w-3" />
                        </Button>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
