// Email service for correspondence functionality
import { getPrismaClient } from "@/lib/services/database/database";
import type { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/utils/logger";
import {
  createMailTransport,
  isMailConfigured,
  type MailSendResult,
  type MailTransport,
} from "./transport";
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

  /**
   * The mail transport, built on first use. Null while this instance has no SMTP configured,
   * which is a valid state: the app starts and simply does not send.
   */
  private transport?: MailTransport;

  private initialize() {
    // Configuration is only read here; the transport itself is built on first send, so an
    // instance that never sends mail never constructs an SMTP client.
    if (!isMailConfigured()) {
      log.debug("No SMTP_HOST configured; email service is disabled");
    }
    this.isInitialized = false;
  }

  public isReady(): boolean {
    return this.isInitialized && isMailConfigured();
  }

  /** Build the transport on first use. A missing configuration leaves it undefined. */
  private async ensureClient(): Promise<void> {
    if (this.transport) return;
    this.transport = createMailTransport() ?? undefined;
    this.isInitialized = !!this.transport;
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

    await this.ensureClient();
    if (!this.transport) {
      throw new Error("Mail transport not configured (set SMTP_HOST)");
    }

    let result: MailSendResult;
    try {
      result = await this.transport.send({
        to: msg.to,
        from: msg.from,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      });
    } catch (err) {
      // Logged for diagnostics and rethrown, so the retry loop above decides what happens next.
      log.error("SMTP send threw", {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    // A provider that accepts the envelope but rejects every recipient has not sent anything.
    // Treated as a failure rather than a silent success, which is how a bounced reminder used
    // to look identical to a delivered one.
    if (result.accepted.length === 0 && result.rejected.length > 0) {
      throw new Error(`All recipients rejected: ${result.rejected.join(", ")}`);
    }

    const messageId: string | undefined = result.messageId;

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
    await this.ensureClient();

    if (!this.isInitialized || !this.transport) {
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
