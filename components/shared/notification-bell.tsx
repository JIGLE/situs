"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import * as Popover from "@/components/ui/popover";
import { cn } from "@/lib/utils/utils";
import { useCsrf } from "@/lib/contexts/csrf-context";
import { apiFetch } from "@/lib/utils/api-client";
import { formatDateTime } from "@/lib/utils/format-date";
import { withEntityDetail } from "@/lib/utils/entity-detail-url";
import {
  NOTIFICATION_TYPE_ICON,
  NOTIFICATION_TYPE_KEY,
  type NotificationType,
} from "@/lib/utils/notification-labels";

interface NotificationRow {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
  read: boolean;
  createdAt: string;
}

interface NotificationsResponse {
  notifications: NotificationRow[];
  total: number;
  unreadCount: number;
}

const LIST_LIMIT = 20;
/** Cheap enough to poll — one row per user, a single COUNT under the hood. */
const POLL_MS = 60_000;

/**
 * Header bell: the primary surface for `Notification`, which until now was written every day by
 * `/api/cron/notifications` and read by nothing — see notification-center.tsx's removal in
 * 18327fd. Deliberately not that component restored: its NotificationType union had drifted
 * from the Prisma enum in both directions, and it invented a `priority` the schema has no column
 * for. This derives its labels from notification-labels.ts instead, which mirrors the enum.
 */
/** `className` sizes the trigger, so the rail's header can match it to its collapse button. */
export function NotificationBell({ className }: { className?: string } = {}): React.ReactElement {
  const t = useTranslations("notificationCenter");
  const tTypes = useTranslations("notifications");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { token: csrfToken } = useCsrf();

  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<NotificationsResponse>(`/api/notifications?limit=${LIST_LIMIT}`);
      setNotifications(res.notifications ?? []);
      setUnreadCount(res.unreadCount ?? 0);
    } catch {
      // A failed background refresh should not clear what's already on screen.
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_MS);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    if (open) {
      setLoading(true);
      load().finally(() => setLoading(false));
    }
  }, [open, load]);

  const markRead = useCallback(
    async (id: string) => {
      setNotifications((rows) => rows.map((r) => (r.id === id ? { ...r, read: true } : r)));
      setUnreadCount((n) => Math.max(0, n - 1));
      try {
        await apiFetch(`/api/notifications/${id}`, csrfToken, "PUT", { read: true });
      } catch {
        // Best-effort — a failed mark-as-read is not worth interrupting the user over; the next
        // load() reconciles it either way.
      }
    },
    [csrfToken],
  );

  const markAllRead = useCallback(async () => {
    const previous = notifications;
    setNotifications((rows) => rows.map((r) => ({ ...r, read: true })));
    setUnreadCount(0);
    try {
      await apiFetch(`/api/notifications/mark-all-read`, csrfToken, "PUT");
    } catch {
      setNotifications(previous);
      load();
    }
  }, [csrfToken, notifications, load]);

  const handleSelect = useCallback(
    (row: NotificationRow) => {
      if (!row.read) markRead(row.id);

      if (row.entityType === "Lease" && row.entityId) {
        setOpen(false);
        router.push(withEntityDetail(pathname, searchParams.toString(), "lease", row.entityId));
      }
    },
    [markRead, router, pathname, searchParams],
  );

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "relative text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
            className,
          )}
          aria-label={
            unreadCount > 0 ? t("bellAriaLabelUnread", { count: unreadCount }) : t("bellAriaLabel")
          }
        >
          <Bell className="h-[18px] w-[18px]" />
          {unreadCount > 0 && (
            <span
              className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[var(--color-destructive)]"
              aria-hidden="true"
            />
          )}
        </Button>
      </Popover.Trigger>
      <Popover.Content
        align="end"
        sideOffset={8}
        className="w-[min(360px,calc(100vw-2rem))] rounded-lg border border-[var(--color-border)] bg-[var(--color-card-solid)] shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--color-foreground)]">{t("title")}</h2>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" className="h-auto p-0 text-xs" onClick={markAllRead}>
              {t("markAllRead")}
            </Button>
          )}
        </div>

        <div className="max-h-[70vh] overflow-y-auto sm:max-h-96">
          {loading && notifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-[var(--color-muted-foreground)]">
              …
            </div>
          ) : notifications.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm font-medium text-[var(--color-foreground)]">
                {t("allCaughtUp")}
              </p>
              <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                {t("notificationsWillAppear")}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {notifications.map((row) => {
                const Icon = NOTIFICATION_TYPE_ICON[row.type];
                const navigable = row.entityType === "Lease";
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => handleSelect(row)}
                      className={cn(
                        "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--color-hover)]",
                        !row.read && "bg-[var(--color-surface-elevated)]",
                        !navigable && "cursor-default",
                      )}
                    >
                      <span className="mt-0.5 shrink-0 rounded-md bg-[var(--color-muted)] p-1.5">
                        <Icon className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span
                            className={cn(
                              "truncate text-sm",
                              row.read
                                ? "text-[var(--color-muted-foreground)]"
                                : "font-medium text-[var(--color-foreground)]",
                            )}
                          >
                            {row.title}
                          </span>
                          {!row.read && (
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--country-highlight-readable)]"
                              aria-hidden="true"
                            />
                          )}
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-xs text-[var(--color-muted-foreground)]">
                          {row.message}
                        </span>
                        <span className="mt-1 block text-[12px] md:text-[10px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
                          {tTypes(NOTIFICATION_TYPE_KEY[row.type])} ·{" "}
                          {formatDateTime(row.createdAt, locale)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Popover.Content>
    </Popover.Root>
  );
}
