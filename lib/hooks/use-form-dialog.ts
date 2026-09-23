"use client";

import * as React from "react";
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { ZodError, ZodSchema } from "zod";
import { useToast } from "@/lib/contexts/toast-context";
import { useSaveFailureMessage } from "@/lib/utils/api-error";
import { logger } from "@/lib/utils/logger";

// ============================================
// Types & Interfaces
// ============================================

export interface UseFormDialogOptions<T> {
  schema: ZodSchema<T>;
  onSubmit: (data: T, isEdit: boolean) => Promise<void>;
  /**
   * Replaces the failure toast. Called with the translated sentence for the form's own validation
   * failure, or for a failure nobody has reported — never for one the entity action already
   * toasted, which is the case that used to show twice.
   */
  onError?: (errorMessage: string) => void;
  /**
   * Toasted once `onSubmit` resolves. No default: a screen that reports its own success passes
   * none and gets no second toast. The default used to be English — "Item created successfully!".
   */
  successMessage?: {
    create: string;
    update: string;
  };
  initialData: T;
  // Auto-save options
  autoSave?: {
    enabled?: boolean;
    key: string;
    delay?: number;
    onSave?: (data: T) => Promise<void>;
    excludeFields?: string[];
  };
  // Form persistence options
  persistence?: {
    enabled?: boolean;
    key?: string;
    fields?: string[];
    ttl?: number; // Time to live in milliseconds
  };
  // Validation options
  validation?: {
    validateOnChange?: boolean;
    debounceValidation?: number;
    showFieldErrors?: boolean;
  };
}

interface PersistedData<T> {
  data: Partial<T>;
  timestamp: number;
  version: number;
}

export interface UseFormDialogReturn<T, E = T> {
  // Dialog state
  isOpen: boolean;
  isSubmitting: boolean;

  // Form data and errors
  formData: T;
  formErrors: Partial<Record<keyof T, string>>;
  editingItem: E | null;

  // Validation state
  isValidating: boolean;
  hasUnsavedChanges: boolean;

  // Auto-save state
  isSaving: boolean;
  lastSaved: Date | null;

  // Form recovery
  hasPersistedData: boolean;

  // Actions
  openDialog: () => void;
  closeDialog: () => void;
  openEditDialog: (item: E, mapToFormData?: (item: E) => T) => void;
  handleSubmit: (e: React.FormEvent) => Promise<void>;
  updateFormData: (updates: Partial<T>) => void;
  setFormData: (data: T) => void;
  resetForm: () => void;
  validateField: (field: keyof T, value: unknown) => Promise<string | null>;
  validateForm: () => Promise<boolean>;

  // Persistence actions
  restoreForm: () => boolean;
  clearPersistedData: () => void;
  forceSave: () => Promise<void>;
}

export function useFormDialog<T extends Record<string, unknown>, E = T>({
  schema,
  onSubmit,
  onError: onErrorCallback,
  successMessage,
  initialData,
  autoSave = { enabled: false, key: "form-autosave" },
  persistence = { enabled: false },
  validation = { validateOnChange: false, debounceValidation: 500, showFieldErrors: true },
}: UseFormDialogOptions<T>): UseFormDialogReturn<T, E> {
  const { success, error } = useToast();
  const failureMessage = useSaveFailureMessage();

  // ============================================
  // Core State
  // ============================================
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [formData, setFormData] = useState<T>(initialData);
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof T, string>>>({});
  const [editingItem, setEditingItem] = useState<E | null>(null);

  // ============================================
  // Persistence & Auto-save State
  // ============================================
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [persistedDataExists, setPersistedDataExists] = useState(false);

  // Refs for timers and tracking
  const validationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedDataRef = useRef<string>(JSON.stringify(initialData));

  // Current persistence version (for cache invalidation)
  const PERSISTENCE_VERSION = 1;

  // ============================================
  // Persistence Key Generation
  // ============================================
  const persistenceKey = useMemo(() => {
    if (persistence.enabled && persistence.key) {
      return `situs-form-${persistence.key}`;
    }
    return null;
  }, [persistence.enabled, persistence.key]);

  const autoSaveKey = useMemo(() => {
    if (autoSave.enabled && autoSave.key) {
      return `situs-autosave-${autoSave.key}`;
    }
    return null;
  }, [autoSave.enabled, autoSave.key]);

  // ============================================
  // Check for Unsaved Changes
  // ============================================
  const hasUnsavedChanges = useMemo(() => {
    const currentData = JSON.stringify(formData);
    return currentData !== lastSavedDataRef.current;
  }, [formData]);

  // ============================================
  // Persistence Helpers
  // ============================================

  /**
   * Filter form data based on configured fields or exclude fields
   */
  const filterDataForPersistence = useCallback(
    (data: T, fields?: string[], excludeFields?: string[]): Partial<T> => {
      if (fields && fields.length > 0) {
        // Only include specified fields
        const filtered: Partial<T> = {};
        for (const field of fields) {
          if (field in data) {
            filtered[field as keyof T] = data[field as keyof T];
          }
        }
        return filtered;
      }

      if (excludeFields && excludeFields.length > 0) {
        // Exclude specified fields
        const filtered = { ...data };
        for (const field of excludeFields) {
          delete filtered[field as keyof T];
        }
        return filtered;
      }

      return data;
    },
    [],
  );

  /**
   * Safely save data to localStorage
   */
  const saveToStorage = useCallback((key: string, data: PersistedData<T>): boolean => {
    if (typeof window === "undefined") return false;

    try {
      const serialized = JSON.stringify(data);
      localStorage.setItem(key, serialized);
      return true;
    } catch (err) {
      if (err instanceof Error && err.name === "QuotaExceededError") {
        logger.warn("localStorage quota exceeded, clearing old form data", { key });
        // Try to clear old form data and retry
        try {
          // Clear all situs form data
          const keysToRemove: string[] = [];
          for (let i = 0; i < localStorage.length; i++) {
            const storageKey = localStorage.key(i);
            if (
              storageKey?.startsWith("situs-form-") ||
              storageKey?.startsWith("situs-autosave-")
            ) {
              keysToRemove.push(storageKey);
            }
          }
          keysToRemove.forEach((k) => localStorage.removeItem(k));

          // Retry save
          localStorage.setItem(key, JSON.stringify(data));
          return true;
        } catch {
          logger.error("Failed to save form data after clearing storage", err);
        }
      }
      logger.error("Failed to save form data to localStorage", err);
      return false;
    }
  }, []);

  /**
   * Safely load data from localStorage
   */
  const loadFromStorage = useCallback(
    (key: string): PersistedData<T> | null => {
      if (typeof window === "undefined") return null;

      try {
        const serialized = localStorage.getItem(key);
        if (!serialized) return null;

        const data = JSON.parse(serialized) as PersistedData<T>;

        // Check version compatibility
        if (data.version !== PERSISTENCE_VERSION) {
          logger.debug("Persisted data version mismatch, clearing", {
            expected: PERSISTENCE_VERSION,
            found: data.version,
          });
          localStorage.removeItem(key);
          return null;
        }

        // Check TTL if persistence config has it
        if (persistence.ttl && data.timestamp) {
          const age = Date.now() - data.timestamp;
          if (age > persistence.ttl) {
            logger.debug("Persisted data expired", { age, ttl: persistence.ttl });
            localStorage.removeItem(key);
            return null;
          }
        }

        return data;
      } catch (err) {
        logger.error("Failed to load form data from localStorage", err);
        return null;
      }
    },
    [persistence.ttl],
  );

  /**
   * Clear persisted data from localStorage
   */
  const clearPersistedData = useCallback(() => {
    if (typeof window === "undefined") return;

    if (persistenceKey) {
      localStorage.removeItem(persistenceKey);
    }
    if (autoSaveKey) {
      localStorage.removeItem(autoSaveKey);
    }
    setPersistedDataExists(false);
    logger.debug("Cleared persisted form data");
  }, [persistenceKey, autoSaveKey]);

  /**
   * Force save current form data
   */
  const forceSave = useCallback(async () => {
    const key = autoSaveKey || persistenceKey;
    if (!key) return;

    setIsSaving(true);

    try {
      // Filter data based on configuration
      const dataToSave = autoSave.enabled
        ? filterDataForPersistence(formData, undefined, autoSave.excludeFields)
        : filterDataForPersistence(formData, persistence.fields);

      const persistedData: PersistedData<T> = {
        data: dataToSave,
        timestamp: Date.now(),
        version: PERSISTENCE_VERSION,
      };

      const saved = saveToStorage(key, persistedData);

      if (saved) {
        setLastSaved(new Date());
        lastSavedDataRef.current = JSON.stringify(formData);

        // Call custom onSave callback if provided
        if (autoSave.enabled && autoSave.onSave) {
          await autoSave.onSave(formData);
        }

        logger.debug("Form data saved", { key });
      }
    } catch (err) {
      logger.error("Failed to save form data", err);
    } finally {
      setIsSaving(false);
    }
  }, [
    autoSaveKey,
    persistenceKey,
    autoSave,
    persistence.fields,
    formData,
    filterDataForPersistence,
    saveToStorage,
  ]);

  /**
   * Restore form data from storage
   */
  const restoreForm = useCallback((): boolean => {
    const key = persistenceKey || autoSaveKey;
    if (!key) return false;

    const persisted = loadFromStorage(key);
    if (!persisted || !persisted.data) return false;

    try {
      // Merge persisted data with initial data (persisted takes precedence)
      const restoredData = { ...initialData, ...persisted.data } as T;

      // Validate restored data against schema (soft validation - don't reject if invalid)
      try {
        schema.parse(restoredData);
      } catch (validationErr) {
        logger.warn("Restored form data failed validation, using partial data", {
          error: validationErr instanceof Error ? validationErr.message : String(validationErr),
        });
      }

      setFormData(restoredData);
      lastSavedDataRef.current = JSON.stringify(restoredData);
      setLastSaved(new Date(persisted.timestamp));

      logger.debug("Form data restored", { key, timestamp: persisted.timestamp });
      return true;
    } catch (err) {
      logger.error("Failed to restore form data", err);
      return false;
    }
  }, [persistenceKey, autoSaveKey, loadFromStorage, initialData, schema]);

  /**
   * Check if persisted data exists
   */
  const checkPersistedData = useCallback((): boolean => {
    const key = persistenceKey || autoSaveKey;
    if (!key) return false;

    const persisted = loadFromStorage(key);
    return persisted !== null && persisted.data !== undefined;
  }, [persistenceKey, autoSaveKey, loadFromStorage]);

  // ============================================
  // Auto-save Effect
  // ============================================
  useEffect(() => {
    if (!autoSave.enabled || !autoSaveKey) return;

    // Clear existing timer
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    // Only auto-save if there are unsaved changes and dialog is open
    if (!hasUnsavedChanges || !isOpen) return;

    // Set debounced auto-save
    const delay = autoSave.delay ?? 3000;
    autoSaveTimerRef.current = setTimeout(() => {
      forceSave();
    }, delay);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [autoSave.enabled, autoSave.delay, autoSaveKey, hasUnsavedChanges, isOpen, forceSave]);

  // ============================================
  // Initialize persistence state on mount
  // ============================================
  useEffect(() => {
    const exists = checkPersistedData();
    setPersistedDataExists(exists);
  }, [checkPersistedData]);

  // Field validation function
  const validateField = useCallback(
    async (field: keyof T, value: unknown): Promise<string | null> => {
      try {
        // Validate the full form data with the updated field
        const testData = { ...formData, [field]: value };
        await schema.parseAsync(testData);
        return null;
      } catch (err) {
        if (err instanceof ZodError) {
          const fieldError = err.issues.find((issue) => issue.path[0] === field);
          return fieldError?.message || null;
        }
        return "Validation failed";
      }
    },
    [schema, formData],
  );

  // Form validation function
  const validateForm = useCallback(async (): Promise<boolean> => {
    try {
      setIsValidating(true);
      await schema.parseAsync(formData);
      setFormErrors({});
      return true;
    } catch (err) {
      if (err instanceof ZodError) {
        const errors: Partial<Record<keyof T, string>> = {};
        err.issues.forEach((issue) => {
          const field = issue.path[0] as keyof T;
          if (field) {
            errors[field] = issue.message;
          }
        });
        setFormErrors(errors);
      }
      return false;
    } finally {
      setIsValidating(false);
    }
  }, [formData, schema]);

  const resetForm = useCallback(() => {
    setFormData(initialData);
    setFormErrors({});
    setEditingItem(null);
  }, [initialData]);

  const openDialog = useCallback(() => {
    resetForm();
    setIsOpen(true);
  }, [resetForm]);

  const closeDialog = useCallback(() => {
    setIsOpen(false);
    setTimeout(resetForm, 200); // Delay reset to avoid visual glitch
  }, [resetForm]);

  const openEditDialog = useCallback((item: E, mapToFormData?: (item: E) => T) => {
    const mappedData = mapToFormData ? mapToFormData(item) : (item as unknown as T);
    setFormData(mappedData);
    setEditingItem(item);
    setFormErrors({});
    setIsOpen(true);
  }, []);

  const updateFormData = useCallback(
    (updates: Partial<T>) => {
      setFormData((prev) => {
        const newData = { ...prev, ...updates };

        // Validate on change if enabled
        if (validation.validateOnChange && validation.showFieldErrors) {
          // Clear existing timer
          if (validationTimerRef.current) {
            clearTimeout(validationTimerRef.current);
          }

          // Set new timer for debounced validation
          validationTimerRef.current = setTimeout(async () => {
            const newErrors: Partial<Record<keyof T, string>> = {};

            // Validate only the changed fields
            for (const [field, value] of Object.entries(updates)) {
              const fieldError = await validateField(field as keyof T, value);
              if (fieldError) {
                newErrors[field as keyof T] = fieldError;
              }
            }

            setFormErrors((prev) => ({
              ...prev,
              ...newErrors,
              // Clear errors for fields that are now valid
              ...Object.fromEntries(
                Object.keys(updates)
                  .map((field) => [field, newErrors[field as keyof T] || undefined])
                  .filter(([, error]) => error !== undefined),
              ),
            }));
          }, validation.debounceValidation || 500);
        }

        return newData;
      });
    },
    [
      validation.validateOnChange,
      validation.showFieldErrors,
      validation.debounceValidation,
      validateField,
    ],
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setIsSubmitting(true);
      setFormErrors({});

      try {
        // Validate form data
        const validatedData = schema.parse(formData);

        // Call the onSubmit handler
        await onSubmit(validatedData, !!editingItem);

        if (successMessage) {
          success(editingItem ? successMessage.update : successMessage.create);
        }

        // Close dialog and reset
        closeDialog();
      } catch (err: unknown) {
        if (err instanceof ZodError) {
          // Map Zod errors to form fields
          const errors: Partial<Record<keyof T, string>> = {};
          err.issues.forEach((issue) => {
            const field = issue.path[0] as keyof T;
            if (field) {
              errors[field] = issue.message;
            }
          });
          setFormErrors(errors);
        } else {
          logger.error(
            "Form submission error",
            err instanceof Error ? err : new Error(String(err)),
          );
        }

        // Null when the entity action has already told the user; see `useSaveFailureMessage`.
        const message = failureMessage(err);
        if (message) {
          if (onErrorCallback) {
            onErrorCallback(message);
          } else {
            error(message);
          }
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      formData,
      schema,
      onSubmit,
      onErrorCallback,
      editingItem,
      successMessage,
      failureMessage,
      success,
      error,
      closeDialog,
    ],
  );

  // Cleanup validation timer on unmount
  React.useEffect(() => {
    return () => {
      if (validationTimerRef.current) {
        clearTimeout(validationTimerRef.current);
      }
    };
  }, []);

  // ============================================
  // Cleanup timers on unmount
  // ============================================
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  return {
    isOpen,
    isSubmitting,
    isValidating,
    formData,
    formErrors,
    editingItem,
    hasUnsavedChanges,
    isSaving,
    lastSaved,
    hasPersistedData: persistedDataExists,
    openDialog,
    closeDialog,
    openEditDialog,
    handleSubmit,
    updateFormData,
    setFormData,
    resetForm,
    validateField,
    validateForm,
    restoreForm,
    clearPersistedData,
    forceSave,
  };
}
