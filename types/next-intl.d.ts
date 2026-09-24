/**
 * Types every translation key against the English catalogue.
 *
 * `types/ambient-modules.d.ts` used to declare next-intl's modules by hand, with
 * `useTranslations(namespace?: string)` returning `(key: string) => string`, so no key was ever
 * checked: a typo or a deleted key compiled and rendered as its own path. next-intl's own types
 * resolve under `moduleResolution: "bundler"`, and with `Messages` below `t("no.such.key")` is a
 * type error. English is the reference; `npm run i18n:check:strict` holds the other three
 * catalogues to the same keys.
 */
import type messages from "@/messages/en.json";

declare module "next-intl" {
  interface AppConfig {
    Messages: typeof messages;
  }
}
