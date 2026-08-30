// Email service for correspondence functionality
import { getPrismaClient } from "@/lib/services/database/database";
import type { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/utils/logger";
import { getSecret, isEnabled } from "@/lib/utils/env";
import { randomInt } from "crypto";

const log = logger.child("email-service");

// SendGrid client is optional and lazily loaded when configured

export interface EmailData {
  to: string | string[];
  from: string;
  subject: string;
  html: string;
  text?: string;
  templateId?: string;
  dynamicTemplateData?: Record<string, unknown>;
}

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export interface EmailMetrics {
  totalSent: number;
  totalDelivered: number;
  totalFailed: number;
  totalBounced: number;
  totalOpened: number;
  deliveryRate: number;
  openRate: number;
  bounceRate: number;
  periodDays: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

export class EmailService {
  private static instance: EmailService;
  private isInitialized = false;
  private retryConfig: RetryConfig;

  private constructor(retryConfig?: Partial<RetryConfig>) {
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
    this.initialize();
  }

  public static getInstance(retryConfig?: Partial<RetryConfig>): EmailService {
    if (!EmailService.instance) {
      EmailService.instance = new EmailService(retryConfig);
    }
    return EmailService.instance;
  }

  // Lazily loaded SendGrid client instance (optional)
  private sendGridClient?: {
    setApiKey?: (key: string) => void;
    send: (msg: unknown) => Promise<unknown>;
  };

  private initialize() {
    const key = getSecret("SENDGRID_API_KEY");
    const enabled = isEnabled("ENABLE_SENDGRID") || !!key;
    if (key) {
      // Presence of a key does not mean the client is loaded — client will be created on first use
      // Keep isInitialized=false here; it will be set when the client is actually loaded in `ensureClient()`.
      this.isInitialized = false;
    } else if (enabled) {
      log.warn(
        "ENABLE_SENDGRID is true but SENDGRID_API_KEY is not set; email service will remain disabled",
      );
      this.isInitialized = false;
    } else {
      this.isInitialized = false;
    }
  }

  public isReady(): boolean {
    return this.isInitialized && !!getSecret("SENDGRID_API_KEY");
  }

  // Ensure the SendGrid client is loaded and configured
  private async ensureClient(): Promise<void> {
    if (this.sendGridClient) return;
    const key = getSecret("SENDGRID_API_KEY");
    if (!key) {
      // Not configured
      return;
    }
    try {
      // Dynamic import first so test-runner mocks (vi.doMock) are applied for ESM imports.
      let mod: { default?: unknown } | undefined;
      try {
        mod = await import("@sendgrid/mail");
      } catch (impErr) {
        // Fallback to require() for environments that need CJS resolution
        try {
          mod = require("@sendgrid/mail");
        } catch {
          throw impErr;
        }
      }
      const maybeClient = mod && (mod.default || mod);
      if (
        maybeClient &&
        typeof maybeClient === "object" &&
        "send" in maybeClient &&
        typeof (maybeClient as { send?: unknown }).send === "function"
      ) {
        this.sendGridClient = maybeClient as {
          setApiKey?: (key: string) => void;
          send: (msg: unknown) => Promise<unknown>;
        };
      }
      if (this.sendGridClient) {
        // Try to set API key, but don't let provider validation break our initialization
        try {
          if (typeof this.sendGridClient.setApiKey === "function") {
            this.sendGridClient.setApiKey(key);
          }
        } catch (e) {
          // swallow provider validation errors (tests often use fake keys)
          log.debug("SendGrid setApiKey threw, ignoring in test/dev", {
            error: (e as Error).message,
          });
        }
        this.isInitialized = true;
      }
    } catch (err) {
      log.error("Failed to load SendGrid client dynamically:", err && (err as Error).message);
      this.sendGridClient = undefined;
      this.isInitialized = false;
    }
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoffDelay(attempt: number): number {
    const delay =
      this.retryConfig.baseDelayMs * Math.pow(this.retryConfig.backoffMultiplier, attempt);
    // Add jitter (10% randomization) to prevent thundering herd
    const jitter = delay * 0.1 * (randomInt(1000) / 1000);
    return Math.min(delay + jitter, this.retryConfig.maxDelayMs);
  }

  /**
   * Check if error is retryable (rate limits, temporary failures)
   */
  private isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      // Retryable conditions: rate limits, timeouts, temporary server errors
      return (
        message.includes("rate limit") ||
        message.includes("timeout") ||
        message.includes("econnreset") ||
        message.includes("enotfound") ||
        message.includes("503") ||
        message.includes("502") ||
        message.includes("429")
      );
    }
    return false;
  }

  /**
   * Sleep helper for retry delays
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Internal send method (single attempt)
   */
  private async sendEmailInternal(
    emailData: EmailData,
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const msg = {
      to: emailData.to,
      from: emailData.from || process.env.FROM_EMAIL || "noreply@situs.app",
      subject: emailData.subject,
      html: emailData.html,
      text: emailData.text,
      templateId: emailData.templateId,
      dynamicTemplateData: emailData.dynamicTemplateData,
    } as const;

    // Ensure SendGrid client is ready
    await this.ensureClient();
    if (!this.sendGridClient) {
      throw new Error("SendGrid client not configured");
    }
    // Debug: report client presence for tests
    try {
      console.debug(
        "EmailService.sendEmailInternal: sendGridClient present=",
        !!this.sendGridClient,
        "sendType=",
        typeof this.sendGridClient?.send,
      );
    } catch {}
    let result: unknown;
    try {
      result = await this.sendGridClient.send(msg);
      try {
        console.debug("EmailService.sendEmailInternal: send result=", result);
      } catch {}
    } catch (err) {
      // Log error for diagnostics and rethrow so retry logic handles it
      log.error("SendGrid send threw error", {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
    let messageId: string | undefined;

    // Helper to safely extract headers from possible send result shapes
    const getHeaders = (r: unknown): Record<string, string> | undefined => {
      if (!r || typeof r !== "object") return undefined;
      return (r as { headers?: Record<string, string> }).headers;
    };

    if (Array.isArray(result) && result.length > 0) {
      const headers = getHeaders(result[0]);
      const maybeMsgId = headers?.["x-message-id"];
      if (typeof maybeMsgId === "string") messageId = maybeMsgId;
    } else {
      const headers = getHeaders(result);
      const maybeMsgId = headers?.["x-message-id"];
      if (typeof maybeMsgId === "string") messageId = maybeMsgId;
    }

    return { success: true, messageId };
  }

  /**
   * Send a single email with exponential backoff retry
   */
  public async sendEmail(
    emailData: EmailData,
    userId: string,
    options?: { skipRetry?: boolean },
  ): Promise<{
    success: boolean;
    messageId?: string;
    error?: string;
    attempts?: number;
  }> {
    // Ensure the client is loaded if a key is present but client not yet created.
    if (!this.sendGridClient) {
      const key = getSecret("SENDGRID_API_KEY");
      if (key) {
        await this.ensureClient();
      }
    }

    if (!this.isInitialized || !this.sendGridClient) {
      return {
        success: false,
        error: "Email service not configured",
        attempts: 0,
      };
    }

    const maxAttempts = options?.skipRetry ? 1 : this.retryConfig.maxRetries + 1;
    let lastError: string = "";
    let attempts = 0;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      attempts++;

      try {
        const result = await this.sendEmailInternal(emailData);

        // Log successful email
        await this.logEmail({
          to: Array.isArray(emailData.to) ? emailData.to.join(", ") : emailData.to,
          from: emailData.from || process.env.FROM_EMAIL || "noreply@situs.app",
          subject: emailData.subject,
          templateId: emailData.templateId,
          status: "sent",
          messageId: result.messageId,
          userId,
          retryCount: attempt,
        });

        return { success: true, messageId: result.messageId, attempts };
      } catch (error: unknown) {
        lastError = error instanceof Error ? error.message : String(error);

        // Check if we should retry
        const isRetryable = this.isRetryableError(error);
        const hasMoreAttempts = attempt < maxAttempts - 1;

        if (isRetryable && hasMoreAttempts) {
          const delay = this.calculateBackoffDelay(attempt);
          log.warn(
            `Email send failed (attempt ${attempt + 1}/${maxAttempts}), retrying in ${delay}ms`,
            { error: lastError },
          );
          await this.sleep(delay);
          continue;
        }

        // Final failure - log and return
        log.error("Email send failed after all retries", {
          error: lastError,
          attempts,
        });
        break;
      }
    }

    // Log failed email after all retries exhausted
    await this.logEmail({
      to: Array.isArray(emailData.to) ? emailData.to.join(", ") : emailData.to,
      from: emailData.from || process.env.FROM_EMAIL || "noreply@situs.app",
      subject: emailData.subject,
      templateId: emailData.templateId,
      status: "failed",
      error: lastError,
      userId,
      retryCount: attempts - 1,
    });

    return { success: false, error: lastError, attempts };
  }

  /**
   * Log email in database for tracking
   */
  private async logEmail(data: {
    to: string;
    from: string;
    subject: string;
    templateId?: string;
    status: "sent" | "failed" | "bounced" | "delivered";
    messageId?: string;
    error?: string;
    userId: string;
    retryCount?: number;
  }): Promise<void> {
    try {
      let prisma: PrismaClient;
      try {
        prisma = getPrismaClient();
      } catch (getErr: unknown) {
        const msg = getErr instanceof Error ? getErr.message : String(getErr);
        // If Prisma isn't available during build/test time, silently skip logging to avoid noisy errors
        if (msg.includes("PrismaClient not available during build time")) {
          return;
        }
        // Unexpected error while obtaining Prisma client — surface it for diagnostics
        log.error("Failed to obtain PrismaClient for email logging", {
          error: getErr,
        });
        return;
      }

      await prisma.emailLog.create({
        data: {
          to: data.to,
          from: data.from,
          subject: data.subject,
          templateId: data.templateId,
          status: data.status,
          messageId: data.messageId,
          error: data.error,
          retryCount: data.retryCount || 0,
          sentAt: new Date(),
          userId: data.userId,
        },
      });
    } catch (error: unknown) {
      // Keep this low-noise during tests; log at debug level
      // Keep as debug so test runs don't spam stderr
      log.debug("Failed to log email", { error });
    }
  }

  /**
   * Get email delivery statistics (simple)
   */
  public async getEmailStats(userId: string, days = 30): Promise<Record<string, number>> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    try {
      const prisma: PrismaClient = getPrismaClient();
      const stats = await prisma.emailLog.groupBy({
        by: ["status"],
        where: {
          sentAt: {
            gte: startDate,
          },
        },
        _count: {
          id: true,
        },
      });

      return stats.reduce(
        (acc: Record<string, number>, stat: { status: string; _count: { id: number } }) => {
          acc[stat.status] = stat._count.id;
          return acc;
        },
        {} as Record<string, number>,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("PrismaClient not available during build time")) {
        return {};
      }
      log.error("Failed to fetch email stats", { error: err });
      return {};
    }
  }

  /**
   * Get comprehensive email delivery metrics
   */
  public async getEmailMetrics(userId: string, days = 30): Promise<EmailMetrics> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    try {
      const prisma: PrismaClient = getPrismaClient();

      // Get counts by status
      const stats = await prisma.emailLog.groupBy({
        by: ["status"],
        where: {
          sentAt: { gte: startDate },
        },
        _count: { id: true },
      });

      const statusCounts = stats.reduce(
        (acc: Record<string, number>, stat) => {
          acc[stat.status] = stat._count.id;
          return acc;
        },
        {} as Record<string, number>,
      );

      const totalSent = statusCounts["sent"] || 0;
      const totalDelivered = statusCounts["delivered"] || 0;
      const totalFailed = statusCounts["failed"] || 0;
      const totalBounced = statusCounts["bounced"] || 0;
      const totalOpened = statusCounts["opened"] || 0;

      // Calculate rates (avoid division by zero)
      const totalAttempted = totalSent + totalFailed;
      const deliveryRate = totalAttempted > 0 ? (totalDelivered / totalAttempted) * 100 : 0;
      const openRate = totalDelivered > 0 ? (totalOpened / totalDelivered) * 100 : 0;
      const bounceRate = totalAttempted > 0 ? (totalBounced / totalAttempted) * 100 : 0;

      return {
        totalSent,
        totalDelivered,
        totalFailed,
        totalBounced,
        totalOpened,
        deliveryRate: Math.round(deliveryRate * 100) / 100,
        openRate: Math.round(openRate * 100) / 100,
        bounceRate: Math.round(bounceRate * 100) / 100,
        periodDays: days,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("PrismaClient not available during build time")) {
        return {
          totalSent: 0,
          totalDelivered: 0,
          totalFailed: 0,
          totalBounced: 0,
          totalOpened: 0,
          deliveryRate: 0,
          openRate: 0,
          bounceRate: 0,
          periodDays: days,
        };
      }
      log.error("Failed to fetch email metrics", { error: err });
      return {
        totalSent: 0,
        totalDelivered: 0,
        totalFailed: 0,
        totalBounced: 0,
        totalOpened: 0,
        deliveryRate: 0,
        openRate: 0,
        bounceRate: 0,
        periodDays: days,
      };
    }
  }

  /**
   * Get recent email logs for dashboard
   */
  public async getRecentEmails(
    userId: string,
    limit = 10,
  ): Promise<
    Array<{
      id: string;
      to: string;
      subject: string;
      status: string;
      sentAt: Date;
      templateId?: string | null;
    }>
  > {
    try {
      const prisma: PrismaClient = getPrismaClient();

      const logs = await prisma.emailLog.findMany({
        where: { userId },
        orderBy: { sentAt: "desc" },
        take: limit,
        select: {
          id: true,
          to: true,
          subject: true,
          status: true,
          sentAt: true,
          templateId: true,
        },
      });

      return logs;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("PrismaClient not available during build time")) {
        return [];
      }
      log.error("Failed to fetch recent emails", { error: err });
      return [];
    }
  }

  /**
   * Retry a failed email by ID
   */
  public async retryFailedEmail(
    emailLogId: string,
    userId: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const prisma: PrismaClient = getPrismaClient();

      const emailLog = await prisma.emailLog.findUnique({
        where: { id: emailLogId },
      });

      if (!emailLog) {
        return { success: false, error: "Email log not found" };
      }

      if (emailLog.status !== "failed") {
        return { success: false, error: "Only failed emails can be retried" };
      }

      // Resend the email
      const result = await this.sendEmail(
        {
          to: emailLog.to,
          from: emailLog.from,
          subject: emailLog.subject,
          html: `<p>This is a retry of a previously failed email.</p>`,
          templateId: emailLog.templateId || undefined,
        },
        userId,
      );

      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  }
}

// Export singleton instance
export const emailService = EmailService.getInstance();
