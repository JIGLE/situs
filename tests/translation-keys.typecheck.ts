/**
 * Keeps translation keys type-checked.
 *
 * Not a Vitest file: `npm run type-check` is what runs it. Each `@ts-expect-error` below expects
 * the compiler to reject a key that is not in messages/en.json. If keys stop being checked — a
 * `declare module "next-intl"` stub back in types/ambient-modules.d.ts, or types/next-intl.d.ts
 * deleted — there is no error left to expect, and the type-check fails on this file instead.
 */
import { useTranslations } from "next-intl";

export function useTranslationKeyTypeCheck() {
  const t = useTranslations("leases");
  // @ts-expect-error: not a key under `leases`
  t("noSuchKey");
  // @ts-expect-error: not a namespace; the maintenance catalogue was cut with ticketing
  useTranslations("maintenance");
  return t("active");
}
