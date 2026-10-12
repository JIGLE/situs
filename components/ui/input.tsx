import * as React from "react";

import { cn } from "@/lib/utils/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, value, onChange, readOnly, ...props }, ref) => {
    const controlledWithoutOnChange =
      value !== undefined && onChange === undefined && readOnly === undefined;

    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full border border-[var(--color-border)] bg-[var(--color-input)] px-3 py-2 text-sm transition-all duration-200 ring-offset-background max-md:min-h-11",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-[var(--color-foreground)]",
          "placeholder:text-[var(--color-muted-foreground)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:ring-offset-2 focus-visible:border-[var(--color-focus)]",
          "hover:border-[var(--color-border-hover)]",
          "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-[var(--color-surface-disabled)]",
          className,
        )}
        ref={ref}
        value={value}
        onChange={onChange}
        readOnly={controlledWithoutOnChange ? true : readOnly}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
