"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/utils";

const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;
const SheetPortal = DialogPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/50 backdrop-blur-sm",
      "data-[state=open]:animate-in data-[state=closed]:animate-out",
      "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
SheetOverlay.displayName = "SheetOverlay";

type SheetSide = "left" | "right" | "top" | "bottom" | "center";

// Safe-area padding applies only on the edges each variant actually touches at mobile
// widths (a bottom sheet only needs the bottom inset; a full-height side sheet needs both).
const SAFE_TOP = "pt-[env(safe-area-inset-top,0px)]";
const SAFE_BOTTOM = "pb-[env(safe-area-inset-bottom,0px)]";

const sheetVariants: Record<SheetSide, string> = {
  right: `inset-y-0 right-0 h-full w-full border-l sm:w-[520px] lg:inset-0 lg:w-full lg:h-full lg:border-0 lg:rounded-none ${SAFE_TOP} ${SAFE_BOTTOM} lg:pt-0 lg:pb-0 data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right`,
  left: `inset-y-0 left-0 h-full w-full border-r sm:w-[520px] ${SAFE_TOP} ${SAFE_BOTTOM} data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left`,
  top: `inset-x-0 top-0 border-b ${SAFE_TOP} data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top`,
  bottom: `inset-x-0 bottom-0 border-t ${SAFE_BOTTOM} data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom`,
  // Center variant: full-screen on mobile, centered floating modal on large screens.
  //
  // `md:max-h-`, not `md:h-`. It was a fixed height, so every centered overlay was exactly
  // `100vh - 6.5rem` tall whatever it contained — at a 900px viewport that is 796px, and the
  // tenant detail's Resumo tab fills about 200 of them. The remaining ~600px of empty panel
  // read as a loading state that never finished. A ceiling gives the same protection against a
  // long overlay outgrowing the viewport while letting a short one be short.
  //
  // Mobile is untouched: `inset-0 h-full` still makes it full-screen below `md`.
  center: `inset-0 h-full w-full ${SAFE_TOP} ${SAFE_BOTTOM} md:pt-0 md:pb-0 md:inset-auto md:left-1/2 md:top-16 md:translate-x-[-50%] md:transform md:w-[75vw] md:max-w-5xl md:h-auto md:max-h-[calc(100vh-6.5rem)] md:rounded-xl md:border md:border-[var(--color-border)] md:shadow-2xl md:ring-1 md:ring-[var(--color-border)] data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95`,
};

interface SheetContentProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  side?: SheetSide;
}

const SheetContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(({ side = "right", className, children, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed z-50 flex flex-col gap-0",
        "bg-[var(--color-card-solid)] border-[var(--color-border)] shadow-2xl",
        "transition ease-in-out",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=closed]:duration-200 data-[state=open]:duration-300",
        sheetVariants[side],
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        aria-label="Close"
        className="absolute right-4 top-[calc(1rem+env(safe-area-inset-top,0px))] z-50 inline-flex items-center justify-center rounded-md p-1.5 text-[var(--color-muted-foreground)] opacity-70 ring-offset-[var(--color-card-solid)] transition-opacity hover:opacity-100 hover:text-[var(--color-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] focus:ring-offset-2 disabled:pointer-events-none max-md:min-h-11 max-md:min-w-11"
      >
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </SheetPortal>
));
SheetContent.displayName = "SheetContent";

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col gap-1.5 border-b border-[var(--color-border)] px-6 py-5",
      className,
    )}
    {...props}
  />
);
SheetHeader.displayName = "SheetHeader";

const SheetTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-base font-semibold text-[var(--color-foreground)]", className)}
    {...props}
  />
));
SheetTitle.displayName = "SheetTitle";

const SheetDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-[var(--color-muted-foreground)]", className)}
    {...props}
  />
));
SheetDescription.displayName = "SheetDescription";

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
};
