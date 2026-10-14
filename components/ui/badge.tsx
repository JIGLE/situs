import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils/utils";

/**
 * A label that is not a state: a count, a flag, an attribute. A state is a `StatusMark`
 * (`components/ui/status-mark.tsx`), so this carries no success, warning or danger variant.
 */
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
        outline:
          "border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-hover)]",
        ghost:
          "border-transparent bg-[var(--color-muted)]/10 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]/20",
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
