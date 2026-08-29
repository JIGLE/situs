"use client";

import * as React from "react";
import { useState, useRef, useEffect, useCallback } from "react";
import { Check, X, Pencil } from "lucide-react";
import { useApiError } from "@/lib/utils/api-error";
import { Input } from "./input";
import { cn } from "@/lib/utils/utils";

type EditableCellType = "text" | "number" | "email" | "phone" | "currency";

interface EditableCellProps {
  /** Current value */
  value: string | number;
  /** Cell type for validation and formatting */
  type?: EditableCellType;
  /** Callback when value is saved */
  onSave: (newValue: string | number) => Promise<void> | void;
  /** Optional validation function */
  validate?: (value: string) => string | null;
  /** Placeholder text */
  placeholder?: string;
  /** Whether editing is disabled */
  disabled?: boolean;
  /** Custom display formatter */
  formatter?: (value: string | number) => string;
  /** Additional class name for the display value */
  className?: string;
  /** Show edit icon on hover */
  showEditIcon?: boolean;
}

/**
 * Inline editable cell component
 * Click to edit, blur or Enter to save, Escape to cancel
 */
export function EditableCell({
  value,
  type = "text",
  onSave,
  validate,
  placeholder = "Click to edit",
  disabled = false,
  formatter,
  className,
  showEditIcon = true,
}: EditableCellProps): React.ReactElement {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(String(value));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const apiError = useApiError();
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset edit value when external value changes
  useEffect(() => {
    if (!isEditing) {
      setEditValue(String(value));
    }
  }, [value, isEditing]);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const getInputType = (): string => {
    switch (type) {
      case "email":
        return "email";
      case "number":
      case "currency":
        return "number";
      case "phone":
        return "tel";
      default:
        return "text";
    }
  };

  const validateValue = useCallback(
    (val: string): string | null => {
      // Built-in validation
      if (type === "email" && val) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(val)) {
          return "Invalid email address";
        }
      }

      if (type === "phone" && val) {
        const phoneRegex = /^[+]?[\d\s-()]{7,}$/;
        if (!phoneRegex.test(val)) {
          return "Invalid phone number";
        }
      }

      if ((type === "number" || type === "currency") && val) {
        if (isNaN(Number(val))) {
          return "Must be a number";
        }
      }

      // Custom validation
      if (validate) {
        return validate(val);
      }

      return null;
    },
    [type, validate],
  );

  const handleStartEdit = () => {
    if (disabled) return;
    setIsEditing(true);
    setError(null);
  };

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setEditValue(String(value));
    setError(null);
  }, [value]);

  const handleSave = useCallback(async () => {
    const validationError = validateValue(editValue);
    if (validationError) {
      setError(validationError);
      return;
    }

    // Don't save if value hasn't changed
    if (editValue === String(value)) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    try {
      const finalValue = type === "number" || type === "currency" ? Number(editValue) : editValue;
      await onSave(finalValue);
      setIsEditing(false);
      setError(null);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setIsSaving(false);
    }
  }, [editValue, value, type, onSave, validateValue, apiError]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      handleCancel();
    }
  };

  const handleBlur = (e: React.FocusEvent) => {
    // Don't blur if clicking on save/cancel buttons
    const relatedTarget = e.relatedTarget as HTMLElement;
    if (relatedTarget?.closest("[data-editable-cell-action]")) {
      return;
    }
    handleSave();
  };

  const displayValue = formatter ? formatter(value) : String(value) || placeholder;

  if (isEditing) {
    return (
      <div className="flex items-center gap-1">
        <div className="relative flex-1">
          <Input
            ref={inputRef}
            type={getInputType()}
            value={editValue}
            onChange={(e) => {
              setEditValue(e.target.value);
              setError(null);
            }}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            disabled={isSaving}
            className={cn(
              "h-7 text-sm py-1 px-2",
              error && "border-[var(--color-error)] focus-visible:ring-[var(--color-error)]",
            )}
            placeholder={placeholder}
          />
          {error && (
            <p className="absolute -bottom-5 left-0 text-xs text-[var(--color-error)]">{error}</p>
          )}
        </div>
        <button
          data-editable-cell-action
          onClick={handleSave}
          disabled={isSaving}
          aria-label="Save changes"
          className="p-1 rounded hover:bg-[var(--color-success)]/20 text-[var(--color-success)] transition-colors"
          title="Save"
        >
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          data-editable-cell-action
          onClick={handleCancel}
          disabled={isSaving}
          aria-label="Cancel editing"
          className="p-1 rounded hover:bg-[var(--color-error)]/20 text-[var(--color-error)] transition-colors"
          title="Cancel"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={handleStartEdit}
      disabled={disabled}
      aria-label={disabled ? undefined : `Edit: ${displayValue}`}
      className={cn(
        "group flex items-center gap-1.5 text-left w-full",
        "hover:bg-[var(--color-hover)] rounded px-1 -mx-1 py-0.5 transition-colors",
        disabled && "cursor-default hover:bg-transparent",
        !value && "text-[var(--color-muted-foreground)] italic",
        className,
      )}
    >
      <span className="truncate">{displayValue}</span>
      {showEditIcon && !disabled && (
        <Pencil
          className="h-3 w-3 opacity-0 group-hover:opacity-50 flex-shrink-0 transition-opacity"
          aria-hidden="true"
        />
      )}
    </button>
  );
}

/**
 * Wrapper for making a table cell editable
 */
interface EditableTableCellProps extends EditableCellProps {
  /** Table cell alignment */
  align?: "left" | "center" | "right";
}

export function EditableTableCell({
  align = "left",
  ...props
}: EditableTableCellProps): React.ReactElement {
  return (
    <td
      className={cn(
        "py-2 px-3",
        align === "center" && "text-center",
        align === "right" && "text-right",
      )}
    >
      <EditableCell {...props} />
    </td>
  );
}
