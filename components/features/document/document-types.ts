"use client";

import { File, FileText, Image, FileImage } from "lucide-react";

export type DocumentType =
  "contract" | "invoice" | "receipt" | "photo" | "floor_plan" | "certificate" | "other";

export interface Document {
  id: string;
  name: string;
  description?: string;
  type: DocumentType;
  mimeType: string;
  storagePath: string;
  fileSize: number;
  propertyId?: string;
  propertyName?: string;
  unitId?: string;
  unitNumber?: string;
  ownerId?: string;
  ownerName?: string;
  tenantId?: string;
  tenantName?: string;
  expiresAt?: string | null;
  uploadedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentStats {
  totalDocuments: number;
  totalSize: number;
  byType: Record<string, number>;
}

export interface DocumentRef {
  id: string;
  name: string;
}

/**
 * Type presentation, keyed by the value stored on the record.
 *
 * `labelKey` rather than `label`: this table carried the English word ("Contract", "Floor
 * Plan") and three components rendered it directly, so every type badge, the type filter and
 * the upload dialog's type Select were English in a Portuguese app. The translations existed
 * the whole time — `documents.contract` and its six siblings are populated in all four
 * catalogues — and nothing ever asked for them. `i18n:check:strict` compares the catalogues
 * against each other, never against what the components read, so a key can be complete in
 * four languages and unreachable from the UI.
 *
 * Holding a key instead of a word is what makes the leak structurally impossible: there is no
 * English string left in this table to render by accident.
 */
export const documentTypeConfig: Record<
  DocumentType,
  { labelKey: string; color: string; icon: typeof FileText }
> = {
  contract: {
    labelKey: "contract",
    color: "bg-blue-500/20 text-blue-800 dark:text-blue-300",
    icon: FileText,
  },
  invoice: {
    labelKey: "invoice",
    color: "bg-green-500/20 text-green-800 dark:text-green-300",
    icon: File,
  },
  receipt: {
    labelKey: "receipt",
    color: "bg-emerald-500/20 text-emerald-800 dark:text-emerald-300",
    icon: File,
  },
  photo: {
    labelKey: "photo",
    color: "bg-purple-500/20 text-purple-800 dark:text-purple-300",
    icon: Image,
  },
  floor_plan: {
    labelKey: "floorPlan",
    color: "bg-orange-500/20 text-orange-800 dark:text-orange-300",
    icon: FileImage,
  },
  certificate: {
    labelKey: "certificate",
    color: "bg-yellow-500/20 text-yellow-800 dark:text-yellow-300",
    icon: FileText,
  },
  other: {
    labelKey: "other",
    color: "bg-[var(--color-popover)] text-[var(--color-muted-foreground)]",
    icon: File,
  },
};

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * `locale` is a parameter because it used to be the literal "pt-PT". Every upload date in the
 * app rendered in Portuguese regardless of the language the user had chosen — the same defect
 * as a `toLocaleString("default")`, only pinned to one country rather than to the server's.
 */
export function formatDocumentDate(dateString: string, locale: string): string {
  return new Date(dateString).toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Returns which sentence to show and the number it needs, not the sentence itself — this
 * built "Expired" and `Expires in ${days}d` in English and handed them straight to a Badge.
 * The caller owns the wording because only the caller has the translator.
 */
export function getExpiryInfo(
  expiresAt: string | null | undefined,
): { key: "expired" | "expiresInDays"; days: number; variant: "destructive" | "warning" } | null {
  if (!expiresAt) return null;
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000);
  if (days < 0) return { key: "expired", days, variant: "destructive" };
  if (days <= 14) return { key: "expiresInDays", days, variant: "destructive" };
  if (days <= 60) return { key: "expiresInDays", days, variant: "warning" };
  return null;
}
