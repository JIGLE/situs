"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Download, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EntityLink } from "@/components/shared/entity-link";
import { useCsrf } from "@/lib/contexts/csrf-context";
import { apiFetch } from "@/lib/utils/api-client";
import {
  documentTypeConfig,
  formatFileSize,
  formatDocumentDate,
  getExpiryInfo,
  type Document,
} from "./document-types";

export function DocumentDetailPanel({ documentId }: { documentId: string }) {
  const t = useTranslations("documents");
  const locale = useLocale();
  const tForms = useTranslations("forms");
  const { token: csrfToken } = useCsrf();
  const [doc, setDoc] = useState<Document | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // `apiFetch` already unwraps the `{ data }` envelope every route replies with — it returns
    // `body.data` when present. Annotating the call as `{ data: Document }` and then reading
    // `.data` off the result unwrapped it a second time, so `setDoc` always received
    // `undefined` and this panel rendered "Document not found" for every document that
    // exists. The annotation is what hid it: it asserted the shape instead of checking it, so
    // the compiler agreed with a claim that the runtime had already made false.
    apiFetch<Document>(`/api/documents/${documentId}`, csrfToken)
      .then((document) => {
        if (!cancelled) setDoc(document);
      })
      .catch(() => {
        if (!cancelled) setError(t("loadFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [documentId, csrfToken, t]);

  const handleDownload = async () => {
    if (!doc) return;
    try {
      const response = await fetch(`/api/documents/${doc.id}/download`);
      if (!response.ok) throw new Error("Download failed");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = window.document.createElement("a");
      a.href = url;
      a.download = doc.name;
      window.document.body.appendChild(a);
      a.click();
      window.document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch {
      setError(t("downloadFailed"));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2">
        <p className="text-sm text-[var(--color-muted-foreground)]">{error ?? t("notFound")}</p>
      </div>
    );
  }

  const config = documentTypeConfig[doc.type];
  const Icon = config.icon;
  const expiry = getExpiryInfo(doc.expiresAt);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="rounded-lg bg-[var(--color-muted)] p-2 shrink-0">
            <Icon className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold leading-none tracking-tight text-[var(--color-foreground)] truncate">
              {doc.name}
            </h2>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <Badge variant="secondary" className={config.color}>
                {t(config.labelKey)}
              </Badge>
              {expiry && (
                <Badge variant={expiry.variant} className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {t(expiry.key, { days: expiry.days })}
                </Badge>
              )}
            </div>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleDownload} className="shrink-0">
          <Download className="h-4 w-4 mr-1" /> {t("download")}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-[12px] md:text-[10px] text-[var(--color-muted-foreground)] uppercase tracking-wide">
            {t("panel.size")}
          </p>
          <p className="mt-0.5 text-[var(--color-foreground)]">{formatFileSize(doc.fileSize)}</p>
        </div>
        <div>
          <p className="text-[12px] md:text-[10px] text-[var(--color-muted-foreground)] uppercase tracking-wide">
            {t("panel.uploaded")}
          </p>
          <p className="mt-0.5 text-[var(--color-foreground)]">
            {formatDocumentDate(doc.uploadedAt, locale)}
          </p>
        </div>
      </div>

      {doc.description && (
        <div>
          <p className="text-[12px] md:text-[10px] text-[var(--color-muted-foreground)] uppercase tracking-wide mb-1">
            {tForms("description")}
          </p>
          <p className="text-sm text-[var(--color-foreground)]">{doc.description}</p>
        </div>
      )}

      {(doc.propertyId || doc.tenantId || doc.ownerId) && (
        <div>
          <p className="text-[12px] md:text-[10px] text-[var(--color-muted-foreground)] uppercase tracking-wide mb-2">
            {t("panel.linkedTo")}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {doc.propertyId && (
              <EntityLink
                type="property"
                id={doc.propertyId}
                title={doc.propertyName ?? "Property"}
                variant="card"
              />
            )}
            {doc.tenantId && (
              <EntityLink
                type="tenant"
                id={doc.tenantId}
                title={doc.tenantName ?? "Tenant"}
                variant="card"
              />
            )}
            {doc.ownerId && (
              <EntityLink
                type="owner"
                id={doc.ownerId}
                title={doc.ownerName ?? "Owner"}
                variant="card"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
