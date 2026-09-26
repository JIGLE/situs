import type { Session, User as NextAuthUser } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { logger } from "@/lib/utils/logger";

// Minimal local typing for NextAuth options we use to avoid fragile cross-package type imports
type NextAuthOptions = {
  secret?: string | undefined;
  providers?: unknown[] | undefined;
  session?: { strategy?: string; maxAge?: number } | undefined;
  callbacks?: Record<string, unknown> | undefined;
  events?: Record<string, unknown> | undefined;
  pages?: Record<string, string> | undefined;
  adapter?: unknown;
};

type Account = {
  provider: string;
  providerAccountId: string;
  type: string;
  access_token?: string;
  expires_at?: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
  token_type?: string;
  session_state?: string;
};

import CredentialsProvider from "next-auth/providers/credentials";
import { isDemoLoginEnabled } from "@/lib/utils/demo-login";
import { getPrismaClient } from "@/lib/services/database/database";
import { isMockMode } from "@/lib/config/data-mode";
import { resolveSignIn } from "@/lib/services/auth/registration";
import { createDevSession, isDevAuthEnabled } from "@/lib/services/auth/dev-session";
import { hasLocale } from "next-intl";
import { locales, type Locale } from "@/lib/i18n/config";

function createBaseAuthOptions(): NextAuthOptions {
  const secret = process.env.NEXTAUTH_SECRET;
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

  // Only add Google OAuth when real credentials are configured
  const hasRealGoogle =
    googleClientId &&
    googleClientId !== "dummy-client-id" &&
    googleClientSecret &&
    googleClientSecret !== "dummy-client-secret";

  const providers: unknown[] = [];

  if (hasRealGoogle) {
    try {
      // Require here to avoid importing optional OAuth providers at module-import time

      const GoogleProvider = require("next-auth/providers/google").default;
      providers.push(
        GoogleProvider({
          clientId: googleClientId,
          clientSecret: googleClientSecret,
        }),
      );
    } catch (err: unknown) {
      logger.warn("Failed to load GoogleProvider dynamically", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Credentials provider for demo / self-hosted auth — disabled in production unless
  // ENABLE_DEMO_LOGIN=true. Shares isDemoLoginEnabled() with the sign-in pages so the provider
  // and the form that exposes it can never disagree about whether this path exists.
  if (isDemoLoginEnabled()) {
    providers.push(
      CredentialsProvider({
        // @ts-ignore — 'id' may not exist in CredentialsProvider type depending on resolution mode
        id: "credentials",
        name: "Credentials",
        credentials: {
          email: { label: "Email", type: "email" },
          password: { label: "Password", type: "password" },
        },
        async authorize(credentials: { email?: string; password?: string } | undefined) {
          if (credentials?.email === "demo@situs.local" && credentials?.password === "demo123") {
            // In mock mode, return a stable demo user without DB access
            if (isMockMode) {
              logger.debug("Demo auth successful (mock mode)");
              return {
                id: "mock-user",
                email: credentials.email,
                name: "Demo User",
                image: null,
                role: "ADMIN",
              };
            }

            try {
              const prisma = getPrismaClient();
              let user = await prisma.user.findUnique({
                where: { email: credentials.email },
              });

              if (!user) {
                user = await prisma.user.create({
                  data: {
                    email: credentials.email,
                    name: "Demo User",
                    role: "ADMIN",
                    imageConsent: true,
                  },
                });
                logger.debug("Demo user created in database", { id: user.id });
              }

              logger.debug("Demo auth successful", { id: user.id });
              return {
                id: user.id,
                email: user.email,
                name: user.name,
                image: user.image,
                role: user.role,
              };
            } catch (error) {
              logger.error(
                "Demo auth error — database may be unavailable, using synthetic demo user",
                error instanceof Error ? error : new Error(String(error)),
              );
              // Return synthetic demo user so demo mode works even when DB is down
              return {
                id: "demo-user",
                email: credentials.email,
                name: "Demo User",
                image: null,
                role: "ADMIN",
              };
            }
          }
          return null;
        },
      }),
    );
  }

  // JWT strategy works with both OAuth and CredentialsProvider
  const options: NextAuthOptions = {
    secret,
    providers,
    session: {
      strategy: "jwt",
      maxAge: 24 * 60 * 60, // 1 day — SaaS-grade session lifetime
    },
    pages: {
      signIn: "/auth/signin",
      error: "/auth/error",
    },
    callbacks: {
      async jwt({
        token,
        user,
        account,
      }: {
        token: JWT;
        user?: NextAuthUser | null;
        account?: { provider?: string } | null;
      }): Promise<JWT> {
        // If no user yet and dev auth is enabled, inject dev session
        if (
          !user &&
          isDevAuthEnabled() &&
          !(token as unknown as Record<string, unknown>).isDevAuth
        ) {
          const devSession = createDevSession();
          const t = token as JWT & {
            id?: string;
            sub?: string;
            email?: string;
            name?: string;
            picture?: string;
            role?: string;
            isDevAuth?: boolean;
          };
          t.id = devSession.user.id;
          t.sub = devSession.user.id;
          t.email = devSession.user.email ?? undefined;
          t.name = devSession.user.name ?? undefined;
          t.picture = devSession.user.image ?? undefined;
          t.role = devSession.user.role;
          t.isDevAuth = true;
          logger.debug("Dev session injected into JWT");
          return token;
        }

        if (user) {
          const t = token as JWT & {
            id?: string;
            sub?: string;
            email?: string;
            name?: string;
            picture?: string;
            role?: string;
            mfaPending?: boolean;
            locale?: Locale;
          };
          // Resolve the id that owned records (properties, tenants, settings…)
          // foreign-key against. The credentials provider already returns a real
          // DB User.id. OAuth (Google) has no PrismaAdapter under the JWT
          // strategy, so NextAuth never creates a User row on sign-in — provision
          // one here and use its DB id, otherwise every owned-entity create fails
          // with "Foreign key constraint violated".
          let resolvedId = user.id;
          if (
            !isMockMode &&
            user.email &&
            account?.provider &&
            account.provider !== "credentials"
          ) {
            try {
              const prisma = getPrismaClient();
              const dbUser = await prisma.user.upsert({
                where: { email: user.email },
                update: {},
                create: {
                  email: user.email,
                  name: user.name ?? undefined,
                  image: user.image ?? undefined,
                  // ADMIN is correct here and only here: the signIn gate above admits a NEW
                  // email in exactly two cases — first-run bootstrap, which should own the
                  // instance, and an explicit AUTH_ALLOWED_EMAILS entry, which is a deliberate
                  // act. Before that gate existed, this line handed admin to any Google account.
                  role: "ADMIN",
                  imageConsent: true,
                },
                select: { id: true },
              });
              resolvedId = dbUser.id;
            } catch (err) {
              // Do NOT fall through to user.id here. That is the OAuth provider's
              // account id, not a DB id, so the session would be issued against a
              // User row that does not exist — the app loads, reads come back
              // empty, and every write dies with a raw Prisma P2003/P2025. Failing
              // the sign-in is the honest outcome: the user lands on the error page
              // instead of a working-looking app that cannot save anything.
              logger.error(
                "Failed to provision OAuth user row — refusing to issue a session",
                err instanceof Error ? err : new Error(String(err)),
              );
              throw new Error("USER_PROVISIONING_FAILED");
            }
          }

          t.id = resolvedId;
          t.sub = resolvedId;
          t.email = user.email ?? undefined;
          t.name = user.name ?? undefined;
          t.picture = user.image ?? undefined;
          t.role = (user as NextAuthUser & { role?: string }).role ?? t.role ?? "ADMIN";

          // Check TOTP enrollment for non-mock users, and read the language the account chose.
          if (!isMockMode && resolvedId && resolvedId !== "demo-user") {
            try {
              const prisma = getPrismaClient();
              const dbUser = await prisma.user.findUnique({
                where: { id: resolvedId },
                select: {
                  totpEnabled: true,
                  settings: { select: { language: true, languageChosenAt: true } },
                },
              });
              if (dbUser?.totpEnabled) {
                t.mfaPending = true;
              }
              // Carried from sign-in so a device with no language of its own can take it on
              // (`LanguageSync`). Read once, here: a choice made later on another device does
              // not reach a session already running, so it cannot switch a page under anyone.
              // Only a choice travels; the column's default is not one.
              const chosen = dbUser?.settings;
              t.locale =
                chosen?.languageChosenAt && hasLocale(locales, chosen.language)
                  ? chosen.language
                  : undefined;
            } catch {
              // DB unavailable — allow login without MFA check
            }
          }
        } else {
          // Token refresh — if mfaPending is set, check if user has recently verified
          const t = token as JWT & {
            id?: string;
            sub?: string;
            email?: string;
            mfaPending?: boolean;
            isDevAuth?: boolean;
            uidVerified?: boolean;
          };

          // Tokens minted before the sign-in branch started failing closed can
          // still carry a provider id that matches no User row, and nothing else
          // re-resolves it — the session stays unable to write for its whole
          // 24h life. Verify once per token (the flag keeps this off the hot
          // path), repair from email when we can, and drop the bad id when we
          // can't so requireAuth's email fallback takes over instead.
          const tokenUid = t.sub || t.id;
          if (
            !isMockMode &&
            !t.isDevAuth &&
            !t.uidVerified &&
            tokenUid &&
            tokenUid !== "demo-user"
          ) {
            try {
              const prisma = getPrismaClient();
              const byId = await prisma.user.findUnique({
                where: { id: tokenUid },
                select: { id: true },
              });
              if (byId) {
                t.uidVerified = true;
              } else {
                const byEmail = t.email
                  ? await prisma.user.findUnique({
                      where: { email: t.email },
                      select: { id: true },
                    })
                  : null;
                if (byEmail) {
                  t.id = byEmail.id;
                  t.sub = byEmail.id;
                  t.uidVerified = true;
                  logger.warn("Repaired a session id that matched no User row", {
                    provider: tokenUid,
                  });
                } else {
                  // Drop the unusable id rather than leaving it in place: with no
                  // id on the session, requireAuth falls back to an email lookup
                  // and 401s cleanly if that finds nothing too.
                  const clearable = t as unknown as Record<string, unknown>;
                  delete clearable.id;
                  delete clearable.sub;
                  logger.warn("Session id matches no User row and no email to repair from");
                }
              }
            } catch {
              // DB unavailable — leave the token untouched and re-check next refresh
            }
          }

          if (t.mfaPending) {
            const uid = t.sub || t.id;
            if (uid && !isMockMode) {
              try {
                const prisma = getPrismaClient();
                const dbUser = await prisma.user.findUnique({
                  where: { id: uid },
                  select: { totpVerifiedAt: true },
                });
                // Accept verification within the last 5 minutes
                if (
                  dbUser?.totpVerifiedAt &&
                  Date.now() - dbUser.totpVerifiedAt.getTime() < 5 * 60 * 1000
                ) {
                  t.mfaPending = false;
                }
              } catch {
                // DB unavailable — keep pending
              }
            }
          }
        }
        return token;
      },
      async session({
        session,
        token,
      }: {
        session: Session;
        token: JWT;
        user?: NextAuthUser;
      }): Promise<Session> {
        try {
          if (session?.user) {
            const sessionUser = session.user as {
              id?: string;
              email?: string | null;
              name?: string | null;
              image?: string | null;
            };
            const t = token as JWT & {
              sub?: string;
              id?: string;
              email?: string;
              name?: string;
              picture?: string;
              role?: string;
              isDevAuth?: boolean;
              mfaPending?: boolean;
              locale?: Locale;
            };
            sessionUser.id = t.sub || t.id;
            if (t.email) sessionUser.email = t.email;
            if (t.name) sessionUser.name = t.name;
            if (t.picture) sessionUser.image = t.picture;
            session.user.role = t.role || session.user.role || "ADMIN";
            (session as unknown as Record<string, unknown>).mfaPending = t.mfaPending ?? false;
            if (t.locale) session.locale = t.locale;

            // If dev auth, update session expiry to 24 hours from now
            if (t.isDevAuth) {
              const expiresAt = new Date();
              expiresAt.setHours(expiresAt.getHours() + 24);
              session.expires = expiresAt.toISOString();
            }
          }
          return session;
        } catch (err: unknown) {
          logger.error(
            "NextAuth session callback error",
            err instanceof Error ? err : new Error(String(err)),
          );
          return session;
        }
      },
      async signIn({
        user,
        account,
      }: {
        user?: NextAuthUser | null;
        account?: Account | undefined;
        profile?: unknown;
      }): Promise<boolean> {
        // Credentials provider — user already validated inside authorize()
        if (account?.provider === "credentials") return true;

        // Registration gate. Runs BEFORE the JWT callback provisions a row, so a refused sign-in
        // leaves nothing behind — no User, no Account, no email stored. This callback previously
        // ended in an unconditional `return true`, and the provisioning below created every new
        // OAuth identity as an ADMIN.
        if (!isMockMode && user?.email) {
          try {
            const decision = await resolveSignIn(user.email);
            if (!decision.allow) {
              logger.warn("Refused sign-in: registration is closed on this instance", {
                provider: account?.provider,
              });
              return false;
            }
          } catch (error: unknown) {
            // Fails CLOSED. A database outage must not become a signup window.
            logger.error(
              "Could not evaluate the registration gate — refusing sign-in",
              error instanceof Error ? error : new Error(String(error)),
            );
            return false;
          }
        }

        // For OAuth providers, clean up stale account links
        if (user && account?.provider && account?.providerAccountId) {
          try {
            const prisma = getPrismaClient();
            await prisma.account.deleteMany({
              where: {
                provider: account.provider,
                providerAccountId: account.providerAccountId,
                userId: { not: user.id },
              },
            });
          } catch (error: unknown) {
            logger.warn("Failed to remove stale account before linking", {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        return true;
      },
    },
    events: {
      async signIn({
        user,
        account,
        isNewUser,
      }: {
        user?: NextAuthUser | null;
        account?: { provider?: string } | undefined;
        profile?: unknown;
        isNewUser?: boolean;
      }) {
        logger.debug("NextAuth event: signIn", {
          email: user?.email,
          provider: account?.provider,
          isNewUser,
        });
      },
      async createUser({ user }: { user: { id: string; email?: string } }) {
        logger.debug("NextAuth event: createUser", {
          id: user.id,
          email: user.email,
        });
      },
    },
  };

  return options;
}

// JWT strategy doesn't need PrismaAdapter at all
export function getAuthOptions(): NextAuthOptions {
  return createBaseAuthOptions();
}
