"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import { useTranslations } from "next-intl";
import { MapPinOff, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Property } from "@/lib/types";
import { apiFetch } from "@/lib/utils/api-client";
import { useCsrf } from "@/lib/contexts/csrf-context";
import { useTheme } from "@/lib/contexts/theme-context";
import { groupPins, type Pin } from "./portfolio-map-pins";
import { PORTUGAL_CENTER, TILE_FILTER, TILE_URL } from "./map-tiles";

/**
 * The Portfolio's map: every property with a place, as a pin, behind the workspace on desktop.
 *
 * Tiles are OpenStreetMap's own (no key, no account), drawn in greys so the palette's accent is
 * the only colour on the map; the dark theme inverts them. What leaves the app: the browser asks
 * OpenStreetMap for the tiles of the area on screen, and the server asks Nominatim for the
 * coordinates of an address that has none (`app/api/properties/geocode`). Nothing else.
 *
 * Leaflet is loaded in the browser only: it reads `window` as it is imported.
 */

/** Close enough to read the street names around the selected property. */
const SELECTED_ZOOM = 16;

export interface PortfolioMapProps {
  properties: Property[];
  selectedId: string | null;
  onSelect: (propertyId: string) => void;
  /**
   * Pixels on the right covered by the detail panel: a selected pin is centred in the part of the
   * map left visible, not under the panel.
   */
  coveredRight?: number;
}

/** The pin's diameter: the selected one stands out, a building's carries a number. */
function pinSize(pin: Pin, selected: boolean): number {
  return selected ? 34 : pin.ids.length > 1 ? 28 : 22;
}

function pinHtml(pin: Pin, selected: boolean): string {
  // Occupied pins are filled with the accent, vacant ones hollow: occupancy reads at a glance
  // without a legend. A building with several units carries their count. Styled inline: Leaflet
  // writes this HTML itself, outside React, and the class contract has no rule for it.
  const size = pinSize(pin, selected);
  const filled = pin.occupied > 0;
  const label = pin.ids.length > 1 ? String(pin.ids.length) : "";
  const style = [
    `width:${size}px`,
    `height:${size}px`,
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "border-radius:9999px",
    "border:2px solid var(--color-ui-accent)",
    `background:${filled ? "var(--color-ui-accent)" : "var(--color-surface-solid)"}`,
    `color:${filled ? "var(--color-surface-solid)" : "var(--color-ui-accent)"}`,
    "font:600 12px/1 var(--font-sans, system-ui)",
    selected
      ? "box-shadow:0 0 0 4px var(--color-surface-solid),0 0 0 6px var(--color-ui-accent)"
      : "box-shadow:0 1px 3px rgba(0,0,0,.35)",
  ].join(";");
  return `<span style="${style}">${label}</span>`;
}

export function PortfolioMap({
  properties,
  selectedId,
  onSelect,
  coveredRight = 0,
}: PortfolioMapProps): React.ReactElement {
  const t = useTranslations("portfolio.map");
  const { token: csrfToken } = useCsrf();
  const { resolvedTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const [ready, setReady] = useState(false);
  // Coordinates the server found while this screen was open, laid over the loaded properties.
  const [placed, setPlaced] = useState<Record<string, [number, number]>>({});
  const [placing, setPlacing] = useState(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const located = useMemo(
    () =>
      properties.map((p) => {
        const found = placed[p.id];
        return found ? { ...p, latitude: found[0], longitude: found[1] } : p;
      }),
    [properties, placed],
  );
  const pins = useMemo(() => groupPins(located), [located]);
  const unplaced = located.filter((p) => p.latitude == null || p.longitude == null).length;

  // The map itself, once.
  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      leafletRef.current = L;
      const map = L.map(containerRef.current, {
        center: PORTUGAL_CENTER,
        zoom: 6,
        // Drawn by this component instead, in the app's own buttons and type: Leaflet's are white
        // boxes on every theme.
        zoomControl: false,
        attributionControl: false,
        scrollWheelZoom: true,
      });
      L.tileLayer(TILE_URL, { maxZoom: 19 }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setReady(true);
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // The container changes size as the summary above it comes and goes.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => mapRef.current?.invalidateSize({ pan: false }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Greys for the light themes, inverted greys for the dark.
  useEffect(() => {
    const pane = mapRef.current?.getPane("tilePane");
    if (pane) pane.style.filter = TILE_FILTER[resolvedTheme === "dark" ? "dark" : "normal"];
  }, [resolvedTheme, ready]);

  // The pins.
  useEffect(() => {
    const L = leafletRef.current;
    const layer = layerRef.current;
    if (!ready || !L || !layer) return;
    layer.clearLayers();
    for (const pin of pins) {
      const selected = selectedId !== null && pin.ids.includes(selectedId);
      const marker = L.marker([pin.latitude, pin.longitude], {
        icon: L.divIcon({
          html: pinHtml(pin, selected),
          className: "",
          // Sized and anchored at its centre, so the marker is the pin's own box: what a click,
          // the keyboard's focus ring and a test all see.
          iconSize: [pinSize(pin, selected), pinSize(pin, selected)],
          iconAnchor: [pinSize(pin, selected) / 2, pinSize(pin, selected) / 2],
        }),
        title: pin.names.join(" · "),
        alt: pin.names.join(" · "),
        keyboard: true,
        riseOnHover: true,
        zIndexOffset: selected ? 1000 : 0,
      });
      // A building's pin opens its first unit, or the next one on each click.
      marker.on("click", () => {
        const at = selectedId ? pin.ids.indexOf(selectedId) : -1;
        onSelectRef.current(pin.ids[(at + 1) % pin.ids.length]);
      });
      marker.addTo(layer);
    }
  }, [pins, selectedId, ready]);

  // Where the map looks: the selected property, or every pin.
  const boundsKey = pins.map((p) => `${p.latitude},${p.longitude}`).join(";");
  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!ready || !map || !L) return;
    // After the container settles to its new size, or Leaflet centres on the old one.
    const frame = requestAnimationFrame(() => {
      map.invalidateSize({ pan: false });
      const selected = selectedId ? located.find((p) => p.id === selectedId) : undefined;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (selected?.latitude != null && selected.longitude != null) {
        const zoom = Math.max(map.getZoom(), SELECTED_ZOOM);
        const point = map
          .project([selected.latitude, selected.longitude], zoom)
          .add([coveredRight / 2, 0]);
        const center = map.unproject(point, zoom);
        if (reduce) map.setView(center, zoom);
        else map.flyTo(center, zoom, { duration: 0.8 });
        return;
      }
      if (selectedId) return; // Selected but not placed: leave the map where it is.
      if (pins.length === 0) {
        map.setView(PORTUGAL_CENTER, 6);
      } else if (pins.length === 1) {
        map.setView([pins[0].latitude, pins[0].longitude], 15, { animate: !reduce });
      } else {
        const bounds = L.latLngBounds(pins.map((p) => [p.latitude, p.longitude]));
        map.flyToBounds(bounds, {
          padding: [48, 48],
          maxZoom: 16,
          duration: reduce ? 0 : 0.8,
        });
      }
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the pins' places, not their identity
  }, [selectedId, boundsKey, coveredRight, ready]);

  // Ask the server to place what has an address and no coordinates, a few at a time.
  const missingKey = properties
    .filter((p) => p.latitude == null || p.longitude == null)
    .map((p) => p.id)
    .join(",");
  useEffect(() => {
    if (!missingKey) return;
    let cancelled = false;
    void (async () => {
      setPlacing(true);
      try {
        for (let round = 0; round < 25 && !cancelled; round++) {
          const result = await apiFetch<{
            placed: { id: string; latitude: number; longitude: number }[];
            remaining: number;
          }>("/api/properties/geocode", csrfToken, "POST");
          if (cancelled) return;
          if (result.placed.length > 0) {
            setPlaced((prev) => {
              const next = { ...prev };
              for (const p of result.placed) next[p.id] = [p.latitude, p.longitude];
              return next;
            });
          }
          if (result.remaining === 0) break;
        }
      } catch {
        // The geocoder is out of reach: the map shows what is already placed, and says how many
        // are not (below). Nothing to interrupt the owner with.
      } finally {
        if (!cancelled) setPlacing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [missingKey, csrfToken]);

  return (
    <div className="relative isolate h-full w-full overflow-hidden bg-[var(--color-canvas)]">
      <div
        ref={containerRef}
        className="h-full w-full"
        role="region"
        aria-label={t("label")}
        data-audit-map=""
      />
      <div className="absolute left-3 top-3 z-[500] flex flex-col border border-[var(--color-border)] bg-[var(--color-surface-solid)]">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("zoomIn")}
          onClick={() => mapRef.current?.zoomIn()}
        >
          <Plus className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="border-t border-[var(--color-border)]"
          aria-label={t("zoomOut")}
          onClick={() => mapRef.current?.zoomOut()}
        >
          <Minus className="size-4" />
        </Button>
      </div>
      {unplaced > 0 && (
        <p
          className="absolute left-3 top-[5.5rem] z-[500] flex items-center gap-1.5 border border-[var(--color-border)] bg-[var(--color-surface-solid)] px-2 py-1 text-xs text-[var(--color-muted-foreground)]"
          title={t("unplacedHint")}
        >
          <MapPinOff className="size-3.5 shrink-0" aria-hidden />
          {placing ? t("placing", { count: unplaced }) : t("unplaced", { count: unplaced })}
        </p>
      )}
      {/* OpenStreetMap's licence asks for this line wherever its tiles are shown. */}
      <p className="absolute bottom-0 left-0 z-[500] bg-[var(--color-surface-solid)]/80 px-1.5 text-xs text-[var(--color-muted-foreground)]">
        ©{" "}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-6 items-center underline underline-offset-2"
        >
          OpenStreetMap
        </a>
      </p>
    </div>
  );
}

export default PortfolioMap;
