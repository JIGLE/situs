"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
import { Check, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "./button";
import { cn } from "@/lib/utils/utils";

export interface MultiStepFormStep {
  id: string;
  title: string;
  description?: string;
  icon?: React.ReactNode;
}

interface StepIndicatorProps {
  steps: MultiStepFormStep[];
  currentStep: number;
  completedSteps: Set<number>;
  visitedSteps: Set<number>;
  onStepClick?: (step: number) => void;
  variant?: "dots" | "line" | "numbered" | "pills";
}

/**
 * Step indicator showing progress through multi-step form
 */
export function StepIndicator({
  steps,
  currentStep,
  completedSteps,
  visitedSteps,
  onStepClick,
  variant = "numbered",
}: StepIndicatorProps): React.ReactElement {
  if (variant === "dots") {
    return (
      <div className="flex justify-center gap-2">
        {steps.map((step, index) => {
          const isCompleted = completedSteps.has(index);
          const isCurrent = index === currentStep;

          return (
            <motion.button
              key={step.id}
              onClick={() => visitedSteps.has(index) && onStepClick?.(index)}
              disabled={!visitedSteps.has(index)}
              className={cn(
                "h-2 rounded-full transition-all duration-300",
                isCurrent
                  ? "w-8 bg-accent-primary"
                  : isCompleted
                    ? "w-2 bg-accent-primary/60"
                    : "w-2 bg-[var(--color-muted)]",
                visitedSteps.has(index) && !isCurrent && "cursor-pointer hover:opacity-80",
              )}
              initial={false}
              animate={{ scale: isCurrent ? 1 : 0.85 }}
            />
          );
        })}
      </div>
    );
  }

  if (variant === "line") {
    const progress = ((currentStep + 1) / steps.length) * 100;

    return (
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-[var(--color-muted-foreground)]">
            Step {currentStep + 1} of {steps.length}
          </span>
          <span className="font-medium text-[var(--color-foreground)]">
            {steps[currentStep]?.title}
          </span>
        </div>
        <div className="h-2 bg-[var(--color-muted)] rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-accent-primary rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          />
        </div>
      </div>
    );
  }

  if (variant === "pills") {
    return (
      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
        {steps.map((step, index) => {
          const isCompleted = completedSteps.has(index);
          const isCurrent = index === currentStep;
          const canClick = visitedSteps.has(index);

          return (
            <button
              key={step.id}
              onClick={() => canClick && onStepClick?.(index)}
              disabled={!canClick}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all whitespace-nowrap",
                isCurrent
                  ? "bg-accent-primary text-white"
                  : isCompleted
                    ? "bg-[var(--color-success)]/20 text-[var(--color-success)]"
                    : canClick
                      ? "bg-[var(--color-hover)] text-[var(--color-foreground)] hover:bg-[var(--color-muted)]"
                      : "bg-[var(--color-muted)]/50 text-[var(--color-muted-foreground)]",
              )}
            >
              {isCompleted && <Check className="h-3.5 w-3.5" />}
              {step.title}
            </button>
          );
        })}
      </div>
    );
  }

  // Numbered variant (default)
  return (
    <div className="flex items-center justify-between">
      {steps.map((step, index) => {
        const isCompleted = completedSteps.has(index);
        const isCurrent = index === currentStep;
        const canClick = visitedSteps.has(index);
        const isLast = index === steps.length - 1;

        return (
          <React.Fragment key={step.id}>
            <button
              onClick={() => canClick && onStepClick?.(index)}
              disabled={!canClick}
              className={cn(
                "flex items-center gap-3 transition-colors",
                canClick && !isCurrent && "cursor-pointer hover:opacity-80",
              )}
            >
              {/* Step number/check */}
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors",
                  isCurrent
                    ? "bg-accent-primary text-white"
                    : isCompleted
                      ? "bg-[var(--color-success)] text-white"
                      : canClick
                        ? "bg-[var(--color-hover)] text-[var(--color-foreground)]"
                        : "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]",
                )}
              >
                {isCompleted ? <Check className="h-4 w-4" /> : index + 1}
              </div>

              {/* Step info */}
              <div className="hidden sm:block text-left">
                <p
                  className={cn(
                    "text-sm font-medium",
                    isCurrent
                      ? "text-[var(--color-foreground)]"
                      : "text-[var(--color-muted-foreground)]",
                  )}
                >
                  {step.title}
                </p>
                {step.description && (
                  <p className="text-xs text-[var(--color-muted-foreground)]">{step.description}</p>
                )}
              </div>
            </button>

            {/* Connector line */}
            {!isLast && (
              <div
                className={cn(
                  "flex-1 h-px mx-4",
                  isCompleted ? "bg-[var(--color-success)]" : "bg-[var(--color-border)]",
                )}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

interface MultiStepFormContainerProps {
  /** Step configurations */
  steps: MultiStepFormStep[];
  /** Current step index */
  currentStep: number;
  /** Set of completed step indices */
  completedSteps: Set<number>;
  /** Set of visited step indices */
  visitedSteps: Set<number>;
  /** Progress percentage */
  progress: number;
  /** Whether form is submitting */
  isSubmitting: boolean;
  /** Whether on first step */
  isFirstStep: boolean;
  /** Whether on last step */
  isLastStep: boolean;
  /** Go to previous step */
  onPrevStep: () => void;
  /** Go to next step */
  onNextStep: () => Promise<boolean>;
  /** Submit form */
  onSubmit: () => Promise<void>;
  /** Go to specific step */
  onGoToStep: (step: number) => void;
  /** Step indicator variant */
  indicatorVariant?: "dots" | "line" | "numbered" | "pills";
  /** Children (step content) */
  children: React.ReactNode;
  /** Additional class name */
  className?: string;
  /** Custom submit button text */
  submitText?: string;
  /** Show step indicator */
  showIndicator?: boolean;
}

/**
 * Container component for multi-step forms
 * Provides navigation, progress indicator, and animation
 */
export function MultiStepFormContainer({
  steps,
  currentStep,
  completedSteps,
  visitedSteps,
  progress: _progress,
  isSubmitting,
  isFirstStep,
  isLastStep,
  onPrevStep,
  onNextStep,
  onSubmit,
  onGoToStep,
  indicatorVariant = "numbered",
  children,
  className,
  submitText = "Submit",
  showIndicator = true,
}: MultiStepFormContainerProps): React.ReactElement {
  // Back / Continue / Processing were hardcoded English here. This is a shared primitive, so
  // every wizard in the app inherited them, and lease creation showed English navigation in all
  // four locales. Every consumer renders under `[locale]`, so the provider is always present.
  const tActions = useTranslations("actions");
  const [direction, setDirection] = React.useState(1);

  const handleNext = async () => {
    setDirection(1);
    if (isLastStep) {
      await onSubmit();
    } else {
      await onNextStep();
    }
  };

  const handlePrev = () => {
    setDirection(-1);
    onPrevStep();
  };

  const handleGoToStep = (step: number) => {
    setDirection(step > currentStep ? 1 : -1);
    onGoToStep(step);
  };

  return (
    <div className={cn("space-y-6", className)}>
      {/* Step indicator */}
      {showIndicator && (
        <StepIndicator
          steps={steps}
          currentStep={currentStep}
          completedSteps={completedSteps}
          visitedSteps={visitedSteps}
          onStepClick={handleGoToStep}
          variant={indicatorVariant}
        />
      )}

      {/* Step content with animation */}
      <div className="relative min-h-[200px]">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={currentStep}
            custom={direction}
            initial={{ opacity: 0, x: direction * 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -50 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Navigation buttons */}
      <div className="flex items-center justify-between pt-4 border-t border-[var(--color-border)]">
        <Button
          type="button"
          variant="outline"
          onClick={handlePrev}
          disabled={isFirstStep || isSubmitting}
          className="gap-2"
        >
          <ChevronLeft className="h-4 w-4" />
          {tActions("back")}
        </Button>

        <div className="flex items-center gap-2">
          {/* Step counter for mobile */}
          <span className="text-sm text-[var(--color-muted-foreground)] sm:hidden">
            {currentStep + 1}/{steps.length}
          </span>

          <Button
            type="button"
            onClick={handleNext}
            disabled={isSubmitting}
            className="gap-2 bg-accent-primary hover:bg-accent-primary/90"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {tActions("processing")}
              </>
            ) : isLastStep ? (
              <>
                {submitText}
                <Check className="h-4 w-4" />
              </>
            ) : (
              <>
                {tActions("continue")}
                <ChevronRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Wrapper for step content
 */
interface StepContentProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export function StepContent({
  title,
  description,
  children,
  className,
}: StepContentProps): React.ReactElement {
  return (
    <div className={cn("space-y-6", className)}>
      <div>
        <h3 className="text-lg font-semibold text-[var(--color-foreground)]">{title}</h3>
        {description && (
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">{description}</p>
        )}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

/**
 * Draft recovery banner
 */
interface DraftBannerProps {
  onRestore: () => void;
  onDiscard: () => void;
}

export function DraftBanner({ onRestore, onDiscard }: DraftBannerProps): React.ReactElement {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center justify-between p-3 rounded-lg bg-[var(--color-info)]/10 border border-[var(--color-info)]/30"
    >
      <p className="text-sm text-[var(--color-info)]">
        You have an unsaved draft. Would you like to continue?
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onDiscard}
          className="text-[var(--color-muted-foreground)]"
        >
          Discard
        </Button>
        <Button
          size="sm"
          onClick={onRestore}
          className="bg-[var(--color-info)] hover:bg-[var(--color-info)]/90"
        >
          Continue
        </Button>
      </div>
    </motion.div>
  );
}
