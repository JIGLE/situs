import * as React from "react";
import SafeSlot from "./safe-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-all duration-200 focus-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        primary:
          "bg-accent-primary text-accent-primary-foreground hover:bg-accent-primary/90 hover:-translate-y-0.5",
        success: "bg-success text-success-foreground hover:bg-success/90",
        warning: "bg-warning text-warning-foreground hover:bg-warning/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-border bg-card hover:bg-hover hover:text-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-hover hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline hover:text-primary/80",
      },
      size: {
        // Below `md`, min-h/min-w floor every variant to the 44px WCAG 2.2 AA touch target
        // (rendered height/width still wins when it's already larger, e.g. `xl`) without
        // changing desktop density, which stays mouse-tuned at the smaller `h-*`/`w-*` value.
        //
        // The text sizes carry `min-w` too, which reads redundant — a button with a label is
        // always wider than 44px, so the floor never binds. It binds when an icon is passed to
        // a text size instead of an `icon*` one, which is easy to do by accident and renders a
        // 28×44 target: exactly what the audit found on the portfolio tree. Floor the width
        // here rather than chase each call site, which is what the comment above always
        // claimed this did.
        xs: "h-7 px-2 text-xs max-md:min-h-11 max-md:min-w-11",
        sm: "h-8 px-3 text-sm max-md:min-h-11 max-md:min-w-11",
        default: "h-9 px-4 text-sm max-md:min-h-11 max-md:min-w-11",
        lg: "h-10 px-6 text-base max-md:min-h-11 max-md:min-w-11",
        xl: "h-12 px-8 text-lg",
        icon: "h-9 w-9 max-md:min-h-11 max-md:min-w-11",
        "icon-sm": "h-8 w-8 max-md:min-h-11 max-md:min-w-11",
        "icon-lg": "h-10 w-10 max-md:min-h-11 max-md:min-w-11",
      },
      emphasis: {
        low: "font-normal",
        medium: "font-medium",
        high: "font-semibold",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      emphasis: "medium",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      emphasis,
      asChild = false,
      loading = false,
      children,
      disabled,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? SafeSlot : "button";
    // Ensure a single React element is passed to Slot when `asChild` is used.
    let childForSlot: React.ReactNode = children;
    if (asChild) {
      try {
        if (React.Children.count(children) === 1) {
          childForSlot = React.isValidElement(children) ? children : <span>{children}</span>;
        } else {
          childForSlot = <span>{children}</span>;
        }
      } catch {
        // Defensive fallback: if React.Children.only throws (e.g., unexpected null),
        // wrap children to avoid server render crashes in development.
        // This prevents `React.Children.only` from bubbling up errors during SSR.
        childForSlot = <span>{children}</span>;
      }
    } else {
      childForSlot = children;
    }
    const commonProps = {
      className: cn(buttonVariants({ variant, size, emphasis, className })),
      ref,
      disabled: disabled || loading,
      ...props,
    };

    // asChild merges onto a single child via Radix Slot — a sibling spinner node here would
    // make that a two-child array, forcing SafeSlot's span-wrapping fallback, which floats
    // Button's classes (including the touch-target floor) onto a wrapper the user can't
    // actually tap instead of the real interactive child. Loading + asChild isn't used
    // anywhere today, so asChild always renders exactly one child: childForSlot.
    if (asChild) {
      return <Comp {...commonProps}>{childForSlot}</Comp>;
    }

    return (
      <Comp {...commonProps}>
        {loading && (
          <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        )}
        {childForSlot}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
