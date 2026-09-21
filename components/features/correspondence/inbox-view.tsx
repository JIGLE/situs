"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Archive, ArchiveRestore, Check, Paperclip, ShieldAlert, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LoadingState } from "@/components/ui/loading-state";
import { useApp } from "@/lib/contexts/app-context";
import { useCsrf } from "@/lib/contexts/csrf-context";
import { useToast } from "@/lib/contexts/toast-context";
import { apiFetch } from "@/lib/utils/api-client";
import { formatDateTime } from "@/lib/utils/format-date";
import { cn } from "@/lib/utils/utils";
import { isSenderAuthenticated } from "@/lib/services/inbound/matching";

interface InboxListItem {
  id: string;
  fromAddress: string;
  fromName: string | null;
  subject: string;
  snippet: string;
  read: boolean;
  archived: boolean;
  receivedAt: string;
  spfResult: string | null;
  dkimResult: string | null;
  suggestedTenantId: string | null;
  suggestedTenantName: string | null;
  tenantId: string | null;
  tenantName: string | null;
  attachmentCount: number;
}

interface InboxAttachment {
  id: string;
  filename: string;
  mimeType: string;
  fileSize: number;
  documentId: string | null;
}

interface InboxDetail extends Omit<
  InboxListItem,
  "snippet" | "suggestedTenantName" | "tenantName"
> {
  toAddress: string;
  textBody: string;
  suggestedTenantName: string | null;
  tenantName: string | null;
  propertyId: string | null;
  propertyName: string | null;
  attachments: InboxAttachment[];
}

const NO_TENANT = "__none__";

/**
 * The Inbox tab of Correspondence: InboundMessage, list → detail. Sibling to
 * `correspondence-view.tsx`'s outbound (template/send) content, mounted in the same page's
 * Tabs so `/correspondence` keeps its one nav entry.
 */
export function InboxView(): React.ReactElement {
  const t = useTranslations("correspondence.inbox");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { token: csrfToken } = useCsrf();
  const { success, error } = useToast();
  const {
    state: { tenants },
  } = useApp();

  const [messages, setMessages] = useState<InboxListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<InboxDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [savingTenant, setSavingTenant] = useState(false);
  const [savingAttachmentId, setSavingAttachmentId] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ messages: InboxListItem[]; total: number }>(
        `/api/inbound-messages?limit=50${showArchived ? "&archived=true" : ""}`,
      );
      setMessages(res.messages ?? []);
    } catch {
      error(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [showArchived, error, t]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const openDetail = useCallback(
    async (id: string) => {
      setSelectedId(id);
      setDetailLoading(true);
      setDetail(null);
      try {
        const message = await apiFetch<InboxDetail>(`/api/inbound-messages/${id}`);
        setDetail(message);
        if (!message.read) {
          apiFetch(`/api/inbound-messages/${id}`, csrfToken, "PUT", { read: true }).catch(() => {});
          setMessages((rows) => rows.map((r) => (r.id === id ? { ...r, read: true } : r)));
        }
      } catch {
        error(t("loadFailed"));
        setSelectedId(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [csrfToken, error, t],
  );

  // A notification click (`?messageId=`) opens straight to that message, whether or not it's
  // on the currently loaded page of the list.
  useEffect(() => {
    const messageId = searchParams.get("messageId");
    if (messageId) openDetail(messageId);
    // Only on mount / when the param itself changes — openDetail's identity changes every list
    // reload and must not re-trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const closeDetail = useCallback(() => {
    setSelectedId(null);
    setDetail(null);
    if (searchParams.get("messageId")) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("messageId");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
  }, [searchParams, router, pathname]);

  const setTenantLink = useCallback(
    async (tenantId: string | null) => {
      if (!detail) return;
      setSavingTenant(true);
      try {
        const updated = await apiFetch<{ tenantId: string | null; propertyId: string | null }>(
          `/api/inbound-messages/${detail.id}`,
          csrfToken,
          "PUT",
          { tenantId },
        );
        const linkedTenant = tenants.find((tn) => tn.id === updated.tenantId);
        setDetail((d) =>
          d
            ? {
                ...d,
                tenantId: updated.tenantId,
                tenantName: linkedTenant?.name ?? null,
                propertyId: updated.propertyId,
              }
            : d,
        );
        setMessages((rows) =>
          rows.map((r) =>
            r.id === detail.id
              ? { ...r, tenantId: updated.tenantId, tenantName: linkedTenant?.name ?? null }
              : r,
          ),
        );
        success(t("linkSaved"));
      } catch {
        error(t("linkFailed"));
      } finally {
        setSavingTenant(false);
      }
    },
    [detail, csrfToken, tenants, success, error, t],
  );

  const toggleArchive = useCallback(
    async (id: string, archived: boolean) => {
      try {
        await apiFetch(`/api/inbound-messages/${id}`, csrfToken, "PUT", { archived });
        setMessages((rows) => rows.filter((r) => r.id !== id));
        setDetail((d) => (d && d.id === id ? { ...d, archived } : d));
        success(archived ? t("archived") : t("unarchived"));
        if (selectedId === id) closeDetail();
      } catch {
        error(t("archiveFailed"));
      }
    },
    [csrfToken, success, error, t, selectedId, closeDetail],
  );

  const saveAttachment = useCallback(
    async (attachmentId: string) => {
      setSavingAttachmentId(attachmentId);
      try {
        const result = await apiFetch<{ documentId: string }>(
          `/api/inbound-attachments/${attachmentId}/save`,
          csrfToken,
          "POST",
        );
        setDetail((d) =>
          d
            ? {
                ...d,
                attachments: d.attachments.map((a) =>
                  a.id === attachmentId ? { ...a, documentId: result.documentId } : a,
                ),
              }
            : d,
        );
        success(t("attachmentSaved"));
      } catch {
        error(t("attachmentSaveFailed"));
      } finally {
        setSavingAttachmentId(null);
      }
    },
    [csrfToken, success, error, t],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <Button variant="ghost" size="sm" onClick={() => setShowArchived((v) => !v)}>
          {showArchived ? t("showActive") : t("showArchived")}
        </Button>
      </div>

      {loading ? (
        <LoadingState count={4} />
      ) : messages.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[var(--color-border)] py-16 text-center">
          <p className="text-sm font-medium text-[var(--color-foreground)]">
            {showArchived ? t("emptyArchivedTitle") : t("emptyTitle")}
          </p>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {showArchived ? t("emptyArchivedDescription") : t("emptyDescription")}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
          {messages.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => openDetail(m.id)}
                className={cn(
                  "flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-[var(--color-hover)] sm:flex-row sm:items-center sm:gap-4",
                  !m.read && "bg-[var(--color-surface-elevated)]",
                )}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  {!m.read && (
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--country-highlight-readable)]"
                      aria-hidden="true"
                    />
                  )}
                  <div className="min-w-0">
                    <p
                      className={cn(
                        "truncate text-sm",
                        m.read
                          ? "text-[var(--color-muted-foreground)]"
                          : "font-medium text-[var(--color-foreground)]",
                      )}
                    >
                      {m.fromName || m.fromAddress}
                    </p>
                    <p className="truncate text-sm text-[var(--color-foreground)]">{m.subject}</p>
                    <p className="truncate text-xs text-[var(--color-muted-foreground)]">
                      {m.snippet}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2 pl-3.5 sm:pl-0">
                  {m.tenantName ? (
                    <Badge variant="secondary" className="text-xs">
                      {m.tenantName}
                    </Badge>
                  ) : m.suggestedTenantName ? (
                    <Badge variant="outline" className="text-xs">
                      {t("suggested", { name: m.suggestedTenantName })}
                    </Badge>
                  ) : null}
                  {m.attachmentCount > 0 && (
                    <span className="flex items-center gap-0.5 text-xs text-[var(--color-muted-foreground)]">
                      <Paperclip className="h-3 w-3" /> {m.attachmentCount}
                    </span>
                  )}
                  <span className="text-[12px] md:text-[10px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
                    {formatDateTime(m.receivedAt, locale)}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Sheet open={selectedId !== null} onOpenChange={(open) => !open && closeDetail()}>
        <SheetContent side="right" className="flex flex-col p-0">
          <SheetHeader>
            <SheetTitle className="truncate pr-8">{detail?.subject ?? t("detailTitle")}</SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            {detailLoading || !detail ? (
              <LoadingState count={3} />
            ) : (
              <div className="space-y-5">
                <div>
                  <p className="text-sm font-medium text-[var(--color-foreground)]">
                    {detail.fromName || detail.fromAddress}
                  </p>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    {detail.fromAddress} · {formatDateTime(detail.receivedAt, locale)}
                  </p>
                  {/* Quiet on purpose — see the note on InboundMessage. A pass on either check
                      means some domain took responsibility for the message; it is not identity. */}
                  <p className="mt-1 flex items-center gap-1 text-[12px] md:text-[10px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
                    {isSenderAuthenticated(detail.spfResult, detail.dkimResult) ? (
                      <>
                        <ShieldCheck className="h-3 w-3" /> {t("senderChecked")}
                      </>
                    ) : (
                      <>
                        <ShieldAlert className="h-3 w-3" /> {t("senderUnverified")}
                      </>
                    )}
                  </p>
                </div>

                <p className="whitespace-pre-wrap text-sm text-[var(--color-foreground)]">
                  {detail.textBody}
                </p>

                {detail.attachments.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[12px] md:text-[10px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
                      {t("attachments")}
                    </p>
                    {detail.attachments.map((a) => (
                      <div
                        key={a.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-[var(--color-border)] px-3 py-2"
                      >
                        <span className="flex min-w-0 items-center gap-2 text-sm text-[var(--color-foreground)]">
                          <Paperclip className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
                          <span className="truncate">{a.filename}</span>
                        </span>
                        {a.documentId ? (
                          <span className="flex shrink-0 items-center gap-1 text-xs text-[var(--color-success)]">
                            <Check className="h-3.5 w-3.5" /> {t("attachmentSavedLabel")}
                          </span>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            disabled={savingAttachmentId === a.id}
                            onClick={() => saveAttachment(a.id)}
                          >
                            {savingAttachmentId === a.id
                              ? t("attachmentSaving")
                              : t("saveAttachment")}
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-2 border-t border-[var(--color-border)] pt-4">
                  <p className="text-[12px] md:text-[10px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
                    {t("linkedTenant")}
                  </p>
                  {!detail.tenantId && detail.suggestedTenantName && (
                    <div className="flex items-center justify-between gap-2 rounded-md bg-[var(--color-surface)] px-3 py-2 text-sm">
                      <span>{t("suggested", { name: detail.suggestedTenantName })}</span>
                      <Button
                        size="sm"
                        disabled={savingTenant}
                        onClick={() => setTenantLink(detail.suggestedTenantId)}
                      >
                        {t("confirm")}
                      </Button>
                    </div>
                  )}
                  <Select
                    value={detail.tenantId ?? NO_TENANT}
                    onValueChange={(value) => setTenantLink(value === NO_TENANT ? null : value)}
                    disabled={savingTenant}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_TENANT}>{t("noTenant")}</SelectItem>
                      {tenants.map((tenant) => (
                        <SelectItem key={tenant.id} value={tenant.id}>
                          {tenant.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>

          {detail && (
            <div className="flex justify-end border-t border-[var(--color-border)] px-6 py-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
              <Button variant="outline" onClick={() => toggleArchive(detail.id, !detail.archived)}>
                {detail.archived ? (
                  <>
                    <ArchiveRestore className="mr-1.5 h-4 w-4" /> {t("unarchive")}
                  </>
                ) : (
                  <>
                    <Archive className="mr-1.5 h-4 w-4" /> {t("archive")}
                  </>
                )}
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
