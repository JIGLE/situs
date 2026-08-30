/**
 * Tenant Portal Authentication
 *
 * Handles token generation and verification for tenant self-service portal.
 * Uses signed JWTs with HMAC-SHA256 for secure, stateless authentication.
 */

import crypto from "crypto";
import { getPrismaClient } from "../database/database";
import { timingSafeEqualString } from "@/lib/utils/security";
import { t } from "@/lib/utils/format-message";
import { MESSAGES, resolveTenantLocale } from "@/lib/services/email/email-locale";

// Token expiration in seconds (default: 7 days)
const TOKEN_EXPIRATION = 7 * 24 * 60 * 60;

export interface PortalTokenPayload {
  tenantId: string;
  userId: string;
  exp: number;
  iat: number;
}

/**
 * Generate a cryptographically signed token for tenant portal access
 * Uses HMAC-SHA256 for secure token signing
 */
export function generatePortalToken(tenantId: string, userId: string): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET is required for secure token generation");
  }

  const payload: PortalTokenPayload = {
    tenantId,
    userId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + TOKEN_EXPIRATION,
  };

  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payloadStr = Buffer.from(JSON.stringify(payload)).toString("base64url");

  // Create HMAC-SHA256 signature
  const signatureData = `${header}.${payloadStr}`;
  const signature = crypto.createHmac("sha256", secret).update(signatureData).digest("base64url");

  return `${header}.${payloadStr}.${signature}`;
}

/**
 * Verify a portal token and return payload if valid
 * Uses HMAC-SHA256 for cryptographic verification
 */
export async function verifyPortalToken(token: string): Promise<PortalTokenPayload | null> {
  try {
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) {
      throw new Error("NEXTAUTH_SECRET is required for token verification");
    }

    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [header, payloadStr, signature] = parts;

    // Verify HMAC-SHA256 signature
    const signatureData = `${header}.${payloadStr}`;
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(signatureData)
      .digest("base64url");

    // Constant-time: `!==` on a signature short-circuits at the first differing byte, so response
    // time leaks how many leading bytes matched and a forged signature can be built one byte at a
    // time. Every other secret comparison in this codebase already goes through this helper —
    // CSRF, the cron tokens, the db-init guard — this was the site that was missed.
    if (!timingSafeEqualString(signature, expectedSignature)) {
      return null;
    }

    // Decode payload
    const payload: PortalTokenPayload = JSON.parse(Buffer.from(payloadStr, "base64url").toString());

    // Check expiration
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    // Verify tenant exists
    const prisma = getPrismaClient();
    const tenant = await prisma.tenant.findUnique({
      where: { id: payload.tenantId },
      select: { id: true, userId: true, portalAccessRevokedAt: true },
    });

    if (!tenant || tenant.userId !== payload.userId) {
      return null;
    }

    // Revocation. These tokens are stateless, so expiry was the only thing that ever ended
    // access: a link forwarded to the wrong address, or a tenant who moved out, kept working
    // for up to 7 days with no way to stop it. The owner can now set a revocation instant, and
    // every token issued at or before it is refused.
    //
    // `iat` is whole seconds while the column is milliseconds, so a token issued during the
    // same second as the revocation is ambiguous. It is refused: over-rejecting inside a
    // one-second window costs the owner one click to regenerate, while under-rejecting leaves
    // the link they just revoked working.
    if (
      tenant.portalAccessRevokedAt &&
      payload.iat * 1000 < tenant.portalAccessRevokedAt.getTime() + 1000
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Generate a portal link for a tenant
 */
export function generatePortalLink(tenantId: string, userId: string, baseUrl?: string): string {
  const token = generatePortalToken(tenantId, userId);
  const base = baseUrl || process.env.NEXTAUTH_URL || "http://localhost:3000";
  return `${base}/tenant-portal/${token}`;
}

/**
 * Service for managing tenant portal access
 */
/**
 * Revoke every outstanding portal link for a tenant.
 *
 * Scoped by `userId` as well as `tenantId`: the caller supplies both from their own session, so
 * this cannot be used to revoke another landlord's tenant. Returns false when the tenant does
 * not belong to the caller, rather than throwing, so the route answers 404 and does not confirm
 * the id exists.
 *
 * Idempotent — revoking twice just moves the instant forward.
 */
export async function revokePortalAccess(tenantId: string, userId: string): Promise<boolean> {
  const prisma = getPrismaClient();
  const result = await prisma.tenant.updateMany({
    where: { id: tenantId, userId },
    data: { portalAccessRevokedAt: new Date() },
  });
  return result.count > 0;
}

export const tenantPortalService = {
  generateToken: generatePortalToken,
  verifyToken: verifyPortalToken,
  generateLink: generatePortalLink,
  /**
   * Replaces a stub that took a tenantId, ignored it, and returned `{ success: true }` with the
   * comment "tokens are stateless and expire naturally". Any caller reading that result would
   * report revocation to a landlord while every outstanding link kept working — the failure is
   * silent and the affected party is the tenant whose data stays reachable.
   */
  revokeAccess: revokePortalAccess,

  /**
   * Send portal invitation email to tenant
   */
  async sendInvitation(
    tenantId: string,
    userId: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const prisma = getPrismaClient();
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        include: {
          // `propertyCountry` is what answers "which language" when the tenant has no explicit
          // one — see `resolveTenantLocale`. It is the reason this select grew a field.
          property: { select: { name: true, propertyCountry: true } },
          user: { select: { name: true } },
        },
      });

      if (!tenant) {
        return { success: false, error: "Tenant not found" };
      }

      const portalLink = generatePortalLink(tenantId, userId);

      // Import email service dynamically to avoid circular deps
      const { emailService } = await import("../email/email-service");

      const fromEmail = process.env.FROM_EMAIL || "noreply@situs.app";
      // This is usually the first thing the system ever sends a tenant, and it was English for
      // everyone — including a tenant who reached it through the portal's own resend form, which
      // is itself fully translated. `resolveTenantLocale` reads their explicit language, then the
      // property's country, then falls back to English.
      const locale = resolveTenantLocale(tenant);
      const messages = MESSAGES[locale];
      const tr = (key: string, values?: Record<string, string | number>) =>
        t(messages, `notifications.email.portalInvite.${key}`, values);

      const result = await emailService.sendEmail(
        {
          to: tenant.email,
          from: fromEmail,
          subject: tr("subject"),
          html: `
          <h1>${tr("heading")}</h1>
          <p>${tr("greeting", { tenant: tenant.name })}</p>
          <p>${tr("intro", { manager: tenant.user.name || tr("fallbackManager") })}</p>
          <p><strong>${tr("propertyLabel")}:</strong> ${tenant.property?.name || tr("fallbackProperty")}</p>
          <p>${tr("listIntro")}</p>
          <ul>
            <li>${tr("itemInvoices")}</li>
            <li>${tr("itemHistory")}</li>
            <li>${tr("itemMaintenance")}</li>
          </ul>
          <p><a href="${portalLink}" style="display:inline-block;background:#2563eb;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;">${tr("cta")}</a></p>
          <p>${tr("expiry")}</p>
          <p>${tr("closing")}</p>
        `,
        },
        userId,
      );

      return { success: result.success, error: result.error };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to send invitation",
      };
    }
  },
};
