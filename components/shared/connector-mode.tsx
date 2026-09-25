"use client";

import { useTranslations } from "next-intl";
import { MODE_KIND_STYLES, authorityName, modeKind } from "@/lib/tax/connectors/presentation";

/**
 * A tax connector's mode as the owner reads it: a label, a sentence saying what the mode does,
 * and the badge colour. Finance › Tax Summary and Settings › Integrations both show it, and each
 * used to branch on the kind itself — two ternaries that would have filed a new kind of mode
 * under whichever branch came last. One switch per string, checked exhaustively, is the only
 * place a mode is put into words.
 */
export function useConnectorMode() {
  const t = useTranslations("common");

  return {
    label(mode: string): string {
      switch (modeKind(mode)) {
        case "simulated":
          return t("connectorModeSimulated");
        case "test":
          return t("connectorModeTest");
        case "unsupported":
          return t("connectorModeUnsupported");
      }
    },
    help(mode: string, country: string): string {
      const authority = authorityName(country);
      switch (modeKind(mode)) {
        case "simulated":
          return t("connectorModeSimulatedHelp", { authority });
        case "test":
          return t("connectorModeTestHelp", { authority });
        case "unsupported":
          return t("connectorModeUnsupportedHelp", { mode });
      }
    },
    badgeClass(mode: string): string {
      return MODE_KIND_STYLES[modeKind(mode)];
    },
  };
}
