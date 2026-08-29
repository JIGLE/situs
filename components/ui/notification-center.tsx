"use client";

import * as React from "react";
import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocale, useTranslations } from "next-intl";
import {
  Bell,
  X,
  Check,
  CheckCheck,
  DollarSign,
  Wrench,
  FileText,
  Calendar,
  Users,
  Trash2,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils/utils";
import { csrfHeaders } from "@/lib/utils/api-client";
import { Button } from "./button";
import { Badge } from "./badge";
import * as Popover from "@/components/ui/popover";

// Types
export type NotificationType =
  | "payment_overdue"
  | "payment_received"
  | "maintenance_new"
  | "maintenance_update"
  | "lease_expiring"
  | "lease_expired"
  | "tenant_added"
  | "document_uploaded"
  | "system";

export type NotificationPriority = "low" | "medium" | "high" | "urgent";

/**
 * Fire-and-forget product-analytics event — see lib/services/analytics/product-events.ts.
 * Records that a notification (often an automated reminder — see
 * lib/services/notifications/notification-automation.ts) was clicked, as
 * opposed to merely marked read via a bulk action.
 */
function trackReminderClicked(notification: Notification): void {
  fetch("/api/events", {
    method: "POST",
    headers: csrfHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      name: "reminder_clicked",
      metadata: { type: notification.type },
    }),
  }).catch(() => {});
}

export interface Notification {
  id: string;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
}

interface NotificationCenterProps {
  notifications: Notification[];
  onMarkAsRead: (id: string) => void;
  onMarkAllAsRead: () => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
  onNotificationClick?: (notification: Notification) => void;
  className?: string;
}

// Icon mapping for notification types
const notificationIcons: Record<NotificationType, React.ElementType> = {
  payment_overdue: DollarSign,
  payment_received: DollarSign,
  maintenance_new: Wrench,
  maintenance_update: Wrench,
  lease_expiring: Calendar,
  lease_expired: FileText,
  tenant_added: Users,
  document_uploaded: FileText,
  system: Bell,
};

// Color mapping for notification types
const notificationColors: Record<NotificationType, string> = {
  payment_overdue: "text-red-400 bg-red-400/10",
  payment_received: "text-green-400 bg-green-400/10",
  maintenance_new: "text-orange-400 bg-orange-400/10",
  maintenance_update: "text-blue-400 bg-blue-400/10",
  lease_expiring: "text-yellow-400 bg-yellow-400/10",
  lease_expired: "text-red-400 bg-red-400/10",
  tenant_added: "text-purple-400 bg-purple-400/10",
  document_uploaded: "text-blue-400 bg-blue-400/10",
  system: "text-[var(--color-muted-foreground)] bg-[var(--color-popover)]",
};

// Priority badge colors
const priorityColors: Record<NotificationPriority, string> = {
  low: "bg-[var(--color-popover)] text-[var(--color-muted-foreground)]",
  medium: "bg-blue-500/20 text-blue-400",
  high: "bg-orange-500/20 text-orange-400",
  urgent: "bg-red-500/20 text-red-400",
};

// Format relative time
function formatRelativeTime(
  date: Date,
  t: ReturnType<typeof useTranslations>,
  locale: string,
): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return t("justNow");
  if (diffMins < 60) return t("minutesAgo", { count: diffMins });
  if (diffHours < 24) return t("hoursAgo", { count: diffHours });
  if (diffDays < 7) return t("daysAgo", { count: diffDays });
  return date.toLocaleDateString(locale);
}

// Single notification item
function NotificationItem({
  notification,
  onMarkAsRead,
  onDelete,
  onClick,
}: {
  notification: Notification;
  onMarkAsRead: (id: string) => void;
  onDelete: (id: string) => void;
  onClick?: (notification: Notification) => void;
}): React.ReactElement {
  const t = useTranslations("notificationCenter");
  const locale = useLocale();
  const Icon = notificationIcons[notification.type];
  const colorClass = notificationColors[notification.type];

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -100 }}
      className={cn(
        "group relative flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors",
        notification.read
          ? "bg-transparent hover:bg-[var(--color-hover)]"
          : "bg-[var(--color-surface-elevated)] hover:bg-[var(--color-hover)]",
      )}
      onClick={() => {
        if (!notification.read) {
          onMarkAsRead(notification.id);
          trackReminderClicked(notification);
        }
        onClick?.(notification);
      }}
    >
      {/* Unread indicator */}
      {!notification.read && (
        <div className="absolute left-1 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-accent-primary" />
      )}

      {/* Icon */}
      <div className={cn("p-2 rounded-lg shrink-0", colorClass)}>
        <Icon className="h-4 w-4" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <p
            className={cn(
              "text-sm font-medium truncate",
              notification.read
                ? "text-[var(--color-muted-foreground)]"
                : "text-[var(--color-foreground)]",
            )}
          >
            {notification.title}
          </p>
          {notification.priority !== "low" && (
            <Badge
              className={cn(
                "text-[12px] md:text-[10px] px-1.5 py-0",
                priorityColors[notification.priority],
              )}
            >
              {t(`priority.${notification.priority}`)}
            </Badge>
          )}
        </div>
        <p className="text-xs text-[var(--color-muted-foreground)] line-clamp-2">
          {notification.message}
        </p>
        <p className="text-[12px] md:text-[10px] text-[var(--color-muted-foreground)]">
          {formatRelativeTime(notification.timestamp, t, locale)}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {!notification.read && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={(e) => {
              e.stopPropagation();
              onMarkAsRead(notification.id);
            }}
            title={t("markAsReadLabel")}
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(notification.id);
          }}
          title={t("deleteLabel")}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </motion.div>
  );
}

// Main notification center component
export function NotificationCenter({
  notifications,
  onMarkAsRead,
  onMarkAllAsRead,
  onDelete,
  onClearAll,
  onNotificationClick,
  className: _className,
}: NotificationCenterProps): React.ReactElement {
  const t = useTranslations("notificationCenter");
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">("all");

  const unreadCount = notifications.filter((n) => !n.read).length;
  const filteredNotifications =
    filter === "unread" ? notifications.filter((n) => !n.read) : notifications;

  // Sort by timestamp (newest first) and then by priority
  const sortedNotifications = [...filteredNotifications].sort((a, b) => {
    const priorityOrder: Record<NotificationPriority, number> = {
      urgent: 0,
      high: 1,
      medium: 2,
      low: 3,
    };
    if (!a.read && b.read) return -1;
    if (a.read && !b.read) return 1;
    if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    }
    return b.timestamp.getTime() - a.timestamp.getTime();
  });

  return (
    <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
      <Popover.Trigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="relative h-9 w-9 p-0"
          aria-label={
            unreadCount > 0 ? t("bellAriaLabelUnread", { count: unreadCount }) : t("bellAriaLabel")
          }
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[12px] md:text-[10px] font-bold text-destructive-foreground">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="w-full max-w-md sm:w-96 max-h-[calc(100vh-5rem)] z-[var(--z-popover)] rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-xl overflow-hidden flex flex-col data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-3 border-b border-[var(--color-border)] flex-none">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-[var(--color-foreground)]">{t("title")}</h3>
              {unreadCount > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {t("newBadge", { count: unreadCount })}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={onMarkAllAsRead}
                  aria-label={t("markAllAsReadLabel")}
                >
                  <CheckCheck className="h-3.5 w-3.5 mr-1" />
                  {t("markAllRead")}
                </Button>
              )}
              <Popover.Close asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  aria-label={t("closeLabel")}
                >
                  <X className="h-4 w-4" />
                </Button>
              </Popover.Close>
            </div>
          </div>

          {/* Filter tabs */}
          <div className="flex items-center gap-1 p-2 border-b border-[var(--color-border)] flex-none">
            <Button
              variant={filter === "all" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setFilter("all")}
            >
              {t("all", { count: notifications.length })}
            </Button>
            <Button
              variant={filter === "unread" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setFilter("unread")}
            >
              {t("unread", { count: unreadCount })}
            </Button>
          </div>

          {/* Notification list */}
          <div className="flex-1 overflow-hidden">
            <div className="h-full overflow-y-auto scrollbar-thin">
              {sortedNotifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Bell className="h-10 w-10 text-[var(--color-muted-foreground)] mb-3" />
                  <p className="text-sm font-medium text-[var(--color-foreground)]">
                    {filter === "unread" ? t("noUnreadNotifications") : t("noNotifications")}
                  </p>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    {filter === "unread" ? t("allCaughtUp") : t("notificationsWillAppear")}
                  </p>
                </div>
              ) : (
                <div className="p-2 space-y-1">
                  <AnimatePresence mode="popLayout">
                    {sortedNotifications.map((notification) => (
                      <NotificationItem
                        key={notification.id}
                        notification={notification}
                        onMarkAsRead={onMarkAsRead}
                        onDelete={onDelete}
                        onClick={onNotificationClick}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="flex items-center justify-between p-2 border-t border-[var(--color-border)] flex-none">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-destructive hover:text-destructive"
                onClick={onClearAll}
                aria-label={t("clearAllLabel")}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                {t("clearAll")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                aria-label={t("settingsLabel")}
              >
                <Settings className="h-3.5 w-3.5 mr-1" />
                {t("settings")}
              </Button>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// Map DB notification type to UI type
const dbTypeToUiType: Record<string, NotificationType> = {
  lease_expiring: "lease_expiring",
  payment_due: "payment_overdue",
  payment_received: "payment_received",
  maintenance_created: "maintenance_new",
  maintenance_completed: "maintenance_update",
  document_uploaded: "document_uploaded",
  system: "system",
  other: "system",
};

// Derive priority from notification type
function derivePriority(type: string): NotificationPriority {
  switch (type) {
    case "payment_due":
    case "payment_overdue":
      return "urgent";
    case "maintenance_created":
    case "maintenance_new":
      return "high";
    case "lease_expiring":
      return "medium";
    default:
      return "low";
  }
}

interface DbNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  entityType?: string | null;
  entityId?: string | null;
  payload?: string | null;
  createdAt: string;
}

function mapDbToUi(n: DbNotification): Notification {
  return {
    id: n.id,
    type: dbTypeToUiType[n.type] ?? "system",
    priority: derivePriority(n.type),
    title: n.title,
    message: n.message,
    read: n.read,
    timestamp: new Date(n.createdAt),
    actionUrl:
      n.entityType && n.entityId ? `/${n.entityType.toLowerCase()}s/${n.entityId}` : undefined,
    metadata: n.payload ? JSON.parse(n.payload) : undefined,
  };
}

// Hook to manage notifications state with API integration
export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch notifications from API on mount
  React.useEffect(() => {
    let cancelled = false;
    async function fetchNotifications() {
      try {
        const res = await fetch("/api/notifications?limit=50");
        if (!res.ok) {
          setLoading(false);
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          const mapped = (data.notifications ?? []).map(mapDbToUi);
          setNotifications(mapped);
        }
      } catch {
        // Silently fail — notifications are non-critical
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchNotifications();
    return () => {
      cancelled = true;
    };
  }, []);

  const addNotification = useCallback(
    async (notification: Omit<Notification, "id" | "timestamp" | "read">) => {
      // Optimistic local add
      const tempId = `temp-${Date.now()}`;
      const optimistic: Notification = {
        ...notification,
        id: tempId,
        timestamp: new Date(),
        read: false,
      };
      setNotifications((prev) => [optimistic, ...prev]);

      try {
        const res = await fetch("/api/notifications", {
          method: "POST",
          headers: csrfHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            type:
              Object.entries(dbTypeToUiType).find(([, v]) => v === notification.type)?.[0] ??
              "other",
            title: notification.title,
            message: notification.message,
          }),
        });
        if (res.ok) {
          const created = await res.json();
          setNotifications((prev) => prev.map((n) => (n.id === tempId ? mapDbToUi(created) : n)));
          return created.id;
        }
      } catch {
        // Keep optimistic entry
      }
      return tempId;
    },
    [],
  );

  const markAsRead = useCallback((id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    // Fire and forget API call
    fetch(`/api/notifications/${id}`, {
      method: "PUT",
      headers: csrfHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ read: true }),
    }).catch(() => {});
  }, []);

  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    fetch("/api/notifications/mark-all-read", {
      method: "PUT",
      headers: csrfHeaders(),
    }).catch(() => {});
  }, []);

  const deleteNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    fetch(`/api/notifications/${id}`, { method: "DELETE", headers: csrfHeaders() }).catch(() => {});
  }, []);

  const clearAll = useCallback(() => {
    const ids = notifications.map((n) => n.id);
    setNotifications([]);
    // Delete all in background
    Promise.allSettled(
      ids.map((id) =>
        fetch(`/api/notifications/${id}`, { method: "DELETE", headers: csrfHeaders() }),
      ),
    ).catch(() => {});
  }, [notifications]);

  return {
    notifications,
    loading,
    addNotification,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearAll,
    unreadCount: notifications.filter((n) => !n.read).length,
  };
}
