"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker } from "leaflet";
import { useTranslations } from "next-intl";
import { useTheme } from "@/lib/contexts/theme-context";
import { PORTUGAL_CENTER, TILE_FILTER, TILE_URL } from "./map-tiles";

export interface LocationPickerProps {
  latitude?: number | null;
  longitude?: number | null;
  /** The owner tapped the map or let go of the pin there. */
  onPick: (latitude: number, longitude: number) => void;
}

/** Close enough to tell one door from the next. */
const PLACED_ZOOM = 18;

/** The pin: the accent, a white ring, the point at the bottom so it marks the spot it covers. */
const PIN_HTML =
  '<span style="display:block;width:22px;height:22px;border-radius:9999px 9999px 9999px 0;' +
  "transform:rotate(-45deg);background:var(--color-ui-accent);" +
  'border:3px solid var(--color-surface-solid);box-shadow:0 1px 4px rgba(0,0,0,.4)"></span>';

/**
 * A small map in the property form, to say where the property is: a tap puts the pin there and
 * the pin can be dragged. The form then asks what address is at that point and offers it.
 *
 * Leaflet is loaded in the browser only (it reads `window` as it is imported), so the form loads
 * this through `next/dynamic`.
 */
export function LocationPicker({
  latitude,
  longitude,
  onPick,
}: LocationPickerProps): React.ReactElement {
  const t = useTranslations("properties.location");
  const { resolvedTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const [ready, setReady] = useState(false);

  const placed = latitude != null && longitude != null;

  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      leafletRef.current = L;
      const map = L.map(containerRef.current, {
        center: PORTUGAL_CENTER,
        zoom: 6,
        attributionControl: false,
        // A page scroll over the map in the form should scroll the form.
        scrollWheelZoom: "center",
      });
      L.tileLayer(TILE_URL, { maxZoom: 19 }).addTo(map);
      map.on("click", (event) => onPickRef.current(event.latlng.lat, event.latlng.lng));
      mapRef.current = map;
      setReady(true);
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  // The form's sheet animates open, and the map is drawn at the size it had then.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => mapRef.current?.invalidateSize({ pan: false }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const pane = mapRef.current?.getPane("tilePane");
    if (pane) pane.style.filter = TILE_FILTER[resolvedTheme === "dark" ? "dark" : "normal"];
  }, [resolvedTheme, ready]);

  // The pin, and the view around it.
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;
    if (!placed) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    const point: [number, number] = [latitude, longitude];
    if (!markerRef.current) {
      const marker = L.marker(point, {
        draggable: true,
        keyboard: true,
        title: t("pinTitle"),
        alt: t("pinTitle"),
        icon: L.divIcon({ html: PIN_HTML, className: "", iconSize: [22, 22], iconAnchor: [3, 27] }),
      });
      marker.on("dragend", () => {
        const at = marker.getLatLng();
        onPickRef.current(at.lat, at.lng);
      });
      marker.addTo(map);
      markerRef.current = marker;
      map.setView(point, Math.max(map.getZoom(), PLACED_ZOOM - 2));
    } else {
      markerRef.current.setLatLng(point);
      if (!map.getBounds().pad(-0.1).contains(point)) {
        map.setView(point, Math.max(map.getZoom(), PLACED_ZOOM - 2));
      }
    }
  }, [latitude, longitude, placed, ready, t]);

  return (
    // `isolate`: Leaflet's panes (z 400–1000) stay inside this box, under the sheet's own layers.
    <div className="relative isolate h-56 w-full overflow-hidden border border-[var(--color-border)] bg-[var(--color-canvas)] md:h-64">
      <div
        ref={containerRef}
        className="h-full w-full"
        role="region"
        aria-label={t("mapLabel")}
        data-audit-map=""
      />
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

export default LocationPicker;
