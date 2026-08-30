"use client";

import { useState, useEffect, useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { withEntityDetail } from "@/lib/utils/entity-detail-url";
import { useSession } from "next-auth/react";
import { useCsrf } from "@/lib/contexts/csrf-context";
import { useDemoMode } from "@/lib/contexts/demo-context";
import { usePortalAccess } from "@/lib/contexts/portal-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { EmptyStateIllustration } from "@/components/ui/empty-state-illustrations";
import { Download, Trash2, Search, Filter, Clock } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DocumentType } from "./document-types";
import {
  documentTypeConfig,
  formatFileSize,
  formatDocumentDate,
  getExpiryInfo,
} from "./document-types";
import { useDocuments } from "./use-documents";
import { DocumentUploadDialog } from "./document-upload-dialog";
import { DocumentTemplateDialog } from "./document-template-dialog";
import { DocumentReviewQueue } from "./document-review-queue";

export interface DocumentsViewProps {
  /** Scopes the archive to a single property — set when embedded in the property detail overlay. */
  propertyId?: string;
  /**
   * Drops the internal header, the portfolio-wide stats cards, and the Inbox/OCR Queue/Review
   * Required triage tabs (those queues are about documents not yet linked to a property, so
   * they don't apply once this view is scoped to one). Upload/template actions stay available.
   */
  embedded?: boolean;
}

export function DocumentsView({ propertyId, embedded = false }: DocumentsViewProps = {}) {
  const t = useTranslations("documents");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const { token: csrfToken } = useCsrf();
  const { isOwnerPortal } = usePortalAccess();
  const { isDemoMode } = useDemoMode();
  const router = useRouter();
  const pathname = usePathname();

  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<DocumentType | "all">("all");
  const [propertyFilter, setPropertyFilter] = useState<string>(propertyId ?? "all");

  const openDocumentOverlay = (docId: string) => {
    router.push(withEntityDetail(pathname, searchParams.toString(), "document", docId));
  };

  useEffect(() => {
    const propertyIdParam = searchParams.get("propertyId");
    const search = searchParams.get("search");
    if (propertyIdParam) setPropertyFilter(propertyIdParam);
    if (search) setSearchTerm(search);
  }, [searchParams]);

  const {
    documents,
    stats,
    properties,
    tenants,
    owners,
    loading,
    error,
    setError,
    refetch,
    handleDownload,
    handleDelete,
  } = useDocuments({
    csrfToken,
    sessionReady: !!(session || isDemoMode),
    typeFilter,
    propertyFilter,
    searchTerm,
  });

  /**
   * Every group rendered every document, so a 42-file archive was a 5,900px page — you scrolled
   * past four properties' worth of files to reach the fifth. Each group now shows its first
   * few and expands on request; the badge already carries the full count either way.
   */
  const GROUP_PREVIEW = 4;
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (name: string) =>
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const groupedDocuments = useMemo(() => {
    return documents.reduce<Record<string, typeof documents>>((acc, doc) => {
      const key = isOwnerPortal
        ? doc.propertyName || doc.tenantName || t("unassigned")
        : t("sharedWithYou");
      if (!acc[key]) acc[key] = [];
      acc[key].push(doc);
      return acc;
    }, {});
  }, [documents, isOwnerPortal, t]);

  // Situs Inbox — uploads that still need entity triage (no property/tenant/
  // owner tagged). The OCR classifier proposes a link in the Review
  // Required tab; this is what still needs a human to start that process.
  const unassignedDocuments = useMemo(
    () => documents.filter((doc) => !doc.propertyId && !doc.tenantId && !doc.ownerId),
    [documents],
  );

  if (!session && !isDemoMode) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">{t("signInRequired")}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const uploadActions = isOwnerPortal && (
    <>
      <DocumentTemplateDialog csrfToken={csrfToken} />
      <DocumentUploadDialog
        csrfToken={csrfToken}
        properties={properties}
        tenants={tenants}
        owners={owners}
        onSuccess={refetch}
      />
    </>
  );

  return (
    <div className="space-y-6">
      {!embedded && (
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">
              {isOwnerPortal ? t("title") : t("titleTenant")}
            </h2>
            {/* The four stat cards that used to sit inside the Archive tab said exactly this,
                in four bordered panels 180px tall. None of the numbers is independently
                actionable, so per density rule 4 they belong in the subtitle. */}
            <p className="text-muted-foreground">
              {stats ? (
                <>
                  {t("summary", {
                    count: stats.totalDocuments,
                    size: formatFileSize(stats.totalSize),
                    contracts: stats.byType.contract || 0,
                    photos: stats.byType.photo || 0,
                  })}
                </>
              ) : isOwnerPortal ? (
                t("subtitle")
              ) : (
                t("subtitleTenant")
              )}
            </p>
          </div>
          {uploadActions && <div className="flex gap-2">{uploadActions}</div>}
        </div>
      )}

      {embedded && uploadActions && <div className="flex justify-end gap-2">{uploadActions}</div>}

      {error && (
        <div className="bg-destructive/15 text-destructive px-4 py-3 rounded-lg">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">
            {t("dismiss")}
          </button>
        </div>
      )}

      <Tabs defaultValue="archive" className="space-y-6">
        {!embedded && isOwnerPortal && (
          <TabsList>
            <TabsTrigger value="archive">{t("tabs.archive")}</TabsTrigger>
            <TabsTrigger value="inbox">
              {t("tabs.inbox")}
              {unassignedDocuments.length > 0 && (
                <span className="ml-1.5 rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-xs">
                  {unassignedDocuments.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="ocr-queue">{t("tabs.ocrQueue")}</TabsTrigger>
            <TabsTrigger value="review-required">{t("tabs.reviewRequired")}</TabsTrigger>
          </TabsList>
        )}

        <TabsContent value="inbox" className="mt-0 space-y-4">
          {unassignedDocuments.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-[var(--color-muted-foreground)]">
                {t("inboxEmpty")}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>{t("unassignedUploads")}</CardTitle>
                <CardDescription>
                  {t("unassignedCount", { count: unassignedDocuments.length })}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {unassignedDocuments.map((doc) => {
                  const config = documentTypeConfig[doc.type];
                  const Icon = config.icon;
                  return (
                    <div
                      key={doc.id}
                      className="flex items-center justify-between border border-[var(--color-border)] p-3 cursor-pointer hover:bg-[var(--color-hover)]"
                      onClick={() => openDocumentOverlay(doc.id)}
                    >
                      <div className="flex items-center gap-3">
                        <Icon className="h-5 w-5 text-[var(--color-muted-foreground)]" />
                        <div>
                          <p className="text-sm font-medium">{doc.name}</p>
                          <p className="text-xs text-[var(--color-muted-foreground)]">
                            {formatFileSize(doc.fileSize)} ·{" "}
                            {formatDocumentDate(doc.uploadedAt, locale)}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownload(doc);
                        }}
                        aria-label={t("download")}
                      >
                        <Download className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="ocr-queue" className="mt-0">
          <DocumentReviewQueue scope="queue" />
        </TabsContent>

        <TabsContent value="review-required" className="mt-0">
          <DocumentReviewQueue scope="review" />
        </TabsContent>

        <TabsContent value="archive" className="mt-0 space-y-6">
          {/* Utility row, not a bordered band. What stood here before: a 4-card stat row (now
              the page subtitle), a "Document workspace" card whose entire content was a static
              sentence of prose, and this filter set inside a third Card — three chrome bands
              that pushed the first file 670px down the page. */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t("search")}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            {/* Full width until the row turns horizontal. This utility row is `flex-col` below
                `sm`, so a fixed 180px left both filters as stubs under a full-width search box —
                ragged, and smaller tap targets than the control beside them. */}
            <Select
              value={typeFilter}
              onValueChange={(v) => setTypeFilter(v as DocumentType | "all")}
            >
              <SelectTrigger className="w-full sm:w-[180px]" aria-label={t("filterByType")}>
                <Filter className="mr-2 h-4 w-4" />
                <SelectValue placeholder={t("filterByType")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allTypes")}</SelectItem>
                {Object.entries(documentTypeConfig).map(([key, config]) => (
                  <SelectItem key={key} value={key}>
                    {t(config.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!embedded && isOwnerPortal && (
              <Select value={propertyFilter} onValueChange={setPropertyFilter}>
                <SelectTrigger className="w-full sm:w-[180px]" aria-label={t("filterByProperty")}>
                  <SelectValue placeholder={t("filterByProperty")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allProperties")}</SelectItem>
                  {properties.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Documents List — no card header: the tab label names the view, the group headings
              name each section, and the total is in the page subtitle. */}
          <Card>
            <CardContent className="pt-6">
              {documents.length === 0 ? (
                <EmptyStateIllustration
                  type="documents"
                  title={t("empty")}
                  description={isOwnerPortal ? t("emptyOwner") : t("emptyTenant")}
                />
              ) : (
                <div className="space-y-6">
                  {Object.entries(groupedDocuments).map(([groupName, groupDocs]) => {
                    const expanded = expandedGroups.has(groupName);
                    const visibleDocs = expanded ? groupDocs : groupDocs.slice(0, GROUP_PREVIEW);
                    return (
                      <div key={groupName} className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h3 className="font-medium text-foreground">{groupName}</h3>
                          <Badge variant="outline">{groupDocs.length}</Badge>
                        </div>

                        <div className="space-y-4">
                          {visibleDocs.map((doc) => {
                            const config = documentTypeConfig[doc.type];
                            const Icon = config.icon;
                            const expiry = getExpiryInfo(doc.expiresAt);
                            return (
                              <div
                                key={doc.id}
                                className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 transition-colors hover:bg-[var(--color-surface-hover)] cursor-pointer"
                                onClick={() => openDocumentOverlay(doc.id)}
                              >
                                <div className="flex items-center gap-4">
                                  <div className="rounded-lg bg-muted p-2">
                                    <Icon className="h-6 w-6" />
                                  </div>
                                  <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <h4 className="font-medium">{doc.name}</h4>
                                      <Badge variant="secondary" className={config.color}>
                                        {t(config.labelKey)}
                                      </Badge>
                                      {expiry && (
                                        <Badge
                                          variant={expiry.variant}
                                          className="flex items-center gap-1"
                                        >
                                          <Clock className="h-3 w-3" />
                                          {t(expiry.key, { days: expiry.days })}
                                        </Badge>
                                      )}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                                      <span>{formatFileSize(doc.fileSize)}</span>
                                      <span>•</span>
                                      <span>{formatDocumentDate(doc.uploadedAt, locale)}</span>
                                      {doc.propertyName && (
                                        <>
                                          <span>•</span>
                                          <span>{doc.propertyName}</span>
                                        </>
                                      )}
                                      {doc.tenantName && (
                                        <>
                                          <span>•</span>
                                          <span>{doc.tenantName}</span>
                                        </>
                                      )}
                                    </div>
                                    {doc.description && (
                                      <p className="mt-1 text-sm text-muted-foreground">
                                        {doc.description}
                                      </p>
                                    )}
                                  </div>
                                </div>
                                <div
                                  className="flex items-center gap-2"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleDownload(doc)}
                                    aria-label={t("download")}
                                  >
                                    <Download className="h-4 w-4" aria-hidden="true" />
                                  </Button>
                                  {isOwnerPortal && (
                                    <AlertDialog>
                                      <AlertDialogTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          aria-label={t("delete")}
                                        >
                                          <Trash2
                                            className="h-4 w-4 text-destructive"
                                            aria-hidden="true"
                                          />
                                        </Button>
                                      </AlertDialogTrigger>
                                      <AlertDialogContent>
                                        <AlertDialogHeader>
                                          <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
                                          <AlertDialogDescription>
                                            {t("deleteConfirm", { name: doc.name })}
                                          </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                                          <AlertDialogAction onClick={() => handleDelete(doc.id)}>
                                            {t("delete")}
                                          </AlertDialogAction>
                                        </AlertDialogFooter>
                                      </AlertDialogContent>
                                    </AlertDialog>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {groupDocs.length > GROUP_PREVIEW && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleGroup(groupName)}
                            aria-expanded={expanded}
                          >
                            {expanded
                              ? t("showLess")
                              : t("showAllIn", { count: groupDocs.length, group: groupName })}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
