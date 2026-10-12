import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils/utils";

const badgeVariants = cva(
  // Situs is rectilinear — badges are square-cornered, 1px-bordered chips.
  "inline-flex items-center border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:bg-[var(--color-primary)]/80",
        secondary:
          "border-transparent bg-[var(--color-secondary)] text-[var(--color-secondary-foreground)] hover:bg-[var(--color-secondary)]/80",
        destructive:
          "border-transparent bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)] hover:bg-[var(--color-destructive)]/80",
        success:
          "border-transparent bg-[var(--color-success)] text-[var(--color-success-foreground)] hover:bg-[var(--color-success)]/80",
        warning:
          "border-transparent bg-[var(--color-warning)] text-[var(--color-warning-foreground)] hover:bg-[var(--color-warning)]/80",
        info: "border-transparent bg-[var(--color-info)] text-[var(--color-info-foreground)] hover:bg-[var(--color-info)]/80",
        outline:
          "border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-hover)]",
        ghost:
          "border-transparent bg-[var(--color-muted)]/10 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]/20",
        // System voice: JetBrains Mono uppercase over a bordered soft wash —
        // for machine states (receipt/tax/match status codes), per Situs spec.
        status:
          "border-[var(--color-border)] bg-[var(--color-surface)] font-mono text-[12px] md:text-[10px] font-normal uppercase tracking-[0.06em] text-[var(--color-muted-foreground)]",
        "status-success":
          "border-[var(--semantic-success)] bg-[var(--semantic-success-soft)] font-mono text-[12px] md:text-[10px] font-normal uppercase tracking-[0.06em] text-[var(--semantic-success-readable)]",
        "status-warning":
          "border-[var(--semantic-warning)] bg-[var(--semantic-warning-soft)] font-mono text-[12px] md:text-[10px] font-normal uppercase tracking-[0.06em] text-[var(--semantic-warning-readable)]",
        "status-danger":
          "border-[var(--semantic-danger)] bg-[var(--semantic-danger-soft)] font-mono text-[12px] md:text-[10px] font-normal uppercase tracking-[0.06em] text-[var(--semantic-danger-readable)]",
        "status-info":
          "border-[var(--semantic-info)] bg-[var(--semantic-info-soft)] font-mono text-[12px] md:text-[10px] font-normal uppercase tracking-[0.06em] text-[var(--semantic-info-readable)]",
      },
      size: {
        sm: "px-2 py-0.5 text-xs",
        default: "px-2.5 py-0.5 text-xs",
        lg: "px-3 py-1 text-sm",
      },
      emphasis: {
        low: "font-medium",
        medium: "font-semibold",
        high: "font-bold",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      emphasis: "medium",
    },
  },
);

interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {
  icon?: React.ReactNode;
}

function Badge({
  className,
  variant,
  size,
  emphasis,
  icon,
  children,
  ...props
}: BadgeProps): React.ReactElement {
  return (
    <div className={cn(badgeVariants({ variant, size, emphasis }), className)} {...props}>
      {icon && <span className="mr-1 flex items-center">{icon}</span>}
      {children}
    </div>
  );
}

export { Badge, badgeVariants };
