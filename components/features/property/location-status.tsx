"use client";

import { useTranslations } from "next-intl";
import { MapPin, MapPinCheck, MapPinOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/utils";
import type { Property } from "@/lib/types";

/** The last lookup of the address as typed: none yet, in flight, or what it answered. */
export type LookupState = "idle" | "looking" | "found" | "notFound" | "unreachable";

interface LocationStatusProps {
  lookup: LookupState;
  /** How the form's coordinates place it, or null when it has none. */
  precision: NonNullable<Property["locationPrecision"]> | null;
  hasAddress: boolean;
  mapOpen: boolean;
  onToggleMap: () => void;
}

/**
 * One line under the address saying whether the map can find it, and the button that opens the
 * map to put or move the pin. Green is the door or the owner's own pin, amber a street or only the
 * postal code, red nothing found.
 */
export function LocationStatus({
  lookup,
  precision,
  hasAddress,
  mapOpen,
  onToggleMap,
}: LocationStatusProps): React.ReactElement {
  const t = useTranslations("properties.location");

  let tone: "ok" | "warn" | "bad" | "muted" = "muted";
  let text: string | null = null;
  let Icon = MapPin;
  if (lookup === "looking") {
    text = t("looking");
    Icon = Loader2;
  } else if (precision === "pinned") {
    [tone, text, Icon] = ["ok", t("pinned"), MapPinCheck];
  } else if (precision === "exact") {
    [tone, text, Icon] = ["ok", t("onMap"), MapPinCheck];
  } else if (precision === "street") {
    [tone, text, Icon] = ["warn", t("onMapStreet"), MapPin];
  } else if (precision === "area") {
    [tone, text, Icon] = ["warn", t("approximate"), MapPin];
  } else if (lookup === "notFound") {
    [tone, text, Icon] = ["bad", t("notFound"), MapPinOff];
  } else if (lookup === "unreachable") {
    text = t("unreachable");
    Icon = MapPinOff;
  } else if (hasAddress) {
    text = t("notPlaced");
    Icon = MapPinOff;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <p
        role="status"
        className={cn(
          "flex min-w-0 items-center gap-1.5 text-xs",
          tone === "ok" && "text-[var(--color-success)]",
          tone === "warn" && "text-[var(--color-warning)]",
          tone === "bad" && "text-[var(--color-destructive)]",
          tone === "muted" && "text-[var(--color-muted-foreground)]",
        )}
      >
        {text && (
          <>
            <Icon
              className={cn("size-3.5 shrink-0", lookup === "looking" && "animate-spin")}
              aria-hidden
            />
            <span>{text}</span>
          </>
        )}
      </p>
      <button
        type="button"
        onClick={onToggleMap}
        aria-expanded={mapOpen}
        className="min-h-[32px] px-1 text-xs text-[var(--color-muted-foreground)] underline underline-offset-2 hover:text-[var(--color-foreground)] max-md:min-h-11"
      >
        {mapOpen ? t("hideMap") : precision ? t("moveOnMap") : t("pickOnMap")}
      </button>
    </div>
  );
}
