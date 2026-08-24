import * as React from "react";

import { cn } from "@/lib/utils/utils";

/**
 * Padding is `p-4`, not shadcn's stock `p-6`.
 *
 * The default was not chosen, it was inherited — and the codebase had been arguing with it: of
 * the call sites that override the padding, twenty pass `p-4` and five more pass `p-3` or `p-5`,
 * against five that keep `p-6`. A default that most callers overrule is the wrong default, and
 * every screen that did not bother to overrule it paid 24px on four sides plus 24 again between
 * header and body.
 *
 * This is the single biggest lever on how heavy the app reads, because it is the one value that
 * every panel on every surface inherits. Existing `p-4` overrides are now redundant rather than
 * wrong; they can be swept later without changing a pixel.
 */

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-xl bg-[var(--color-card)] text-[var(--color-card-foreground)]",
        "border border-[var(--color-inner-border)]",
        "shadow-[var(--shadow-card)]",
        // `transition-colors`, not `transition-all`. Both `--shadow-card` and
        // `--shadow-card-hover` are `none` and every radius token is 0, so border colour is the
        // only thing left that actually changes — `all` was animating a list of properties that
        // no longer move.
        "transition-colors duration-200 ease-out",
        // The 2px hover lift is gone. It arrived with the shadowed, rounded card it was designed
        // for; against a zero-radius panel with no shadow it reads as the surface twitching, and
        // it fired on static panels that are not interactive at all. The border-colour change is
        // the affordance, and it is the honest one — it lands on cards that respond to a click.
        "hover:shadow-[var(--shadow-card-hover)] hover:border-[var(--color-inner-border-hover)]",
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1 p-4", className)} {...props} />
  ),
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn(
        "text-lg font-semibold leading-none tracking-tight text-[var(--color-foreground)]",
        className,
      )}
      {...props}
    />
  ),
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-[var(--color-muted-foreground)] leading-relaxed", className)}
    {...props}
  />
));
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-4 pt-0", className)} {...props} />
  ),
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-4 pt-0", className)} {...props} />
  ),
);
CardFooter.displayName = "CardFooter";

export type CardProps = React.HTMLAttributes<HTMLDivElement>;
export type CardHeaderProps = React.HTMLAttributes<HTMLDivElement>;
export type CardTitleProps = React.HTMLAttributes<HTMLHeadingElement>;
export type CardDescriptionProps = React.HTMLAttributes<HTMLParagraphElement>;
export type CardContentProps = React.HTMLAttributes<HTMLDivElement>;
export type CardFooterProps = React.HTMLAttributes<HTMLDivElement>;

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
