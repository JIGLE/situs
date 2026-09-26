import { NextRequest } from "next/server";
import { z } from "zod";

import { requireAuth } from "@/lib/services/auth/auth-middleware";
import { getPrismaClient } from "@/lib/services/database/database";
import { isMockMode } from "@/lib/config/data-mode";
import {
  ValidationError,
  createSuccessResponse,
  parseBody,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";
import { locales } from "@/lib/i18n/locales";

export const runtime = "nodejs";

const chooseLanguageSchema = z.object({ language: z.enum(locales) });

/**
 * PUT /api/settings/language — the owner chose a language.
 *
 * The interface reads the `situs-locale` cookie, which the client writes before calling this.
 * What this saves is the account's copy: reminder emails are written in it, and a device with no
 * language of its own takes it on at sign-in. `languageChosenAt` is what makes it a choice rather
 * than the column's default, so this route, and nothing that posts back a whole settings row, is
 * its writer.
 */
async function handlePut(request: NextRequest): Promise<Response> {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  // A body that is not JSON is the caller's mistake; `withErrorHandler` would answer its
  // SyntaxError as a server error.
  const raw: unknown = await request.json().catch(() => {
    throw new ValidationError("Invalid request: the body is not JSON");
  });
  const { language } = parseBody(raw, chooseLanguageSchema);
  const languageChosenAt = new Date();

  if (isMockMode) return createSuccessResponse({ language, languageChosenAt });

  const saved = await getPrismaClient().userSettings.upsert({
    where: { userId },
    update: { language, languageChosenAt },
    create: { userId, language, languageChosenAt },
    select: { language: true, languageChosenAt: true },
  });
  return createSuccessResponse(saved);
}

export const PUT = withErrorHandler(withRateLimit(handlePut));
