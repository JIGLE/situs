import type { Property } from "@/lib/types";

/** One pin on the Portfolio map: the properties at one place, which in a building are several. */
export interface Pin {
  latitude: number;
  longitude: number;
  ids: string[];
  names: string[];
  /** How many of them are occupied; the pin is filled when any is. */
  occupied: number;
}

/**
 * The map's pins. Properties at the same place, to about a metre, share a pin: the fractions of a
 * building all geocode to its door, and pins drawn on top of each other would hide all but one.
 * A property without coordinates has no pin.
 */
export function groupPins(
  properties: Pick<Property, "id" | "name" | "status" | "latitude" | "longitude">[],
): Pin[] {
  const byPlace = new Map<string, Pin>();
  for (const p of properties) {
    if (p.latitude == null || p.longitude == null) continue;
    if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) continue;
    const key = `${p.latitude.toFixed(5)},${p.longitude.toFixed(5)}`;
    let pin = byPlace.get(key);
    if (!pin) {
      pin = { latitude: p.latitude, longitude: p.longitude, ids: [], names: [], occupied: 0 };
      byPlace.set(key, pin);
    }
    pin.ids.push(p.id);
    pin.names.push(p.name);
    if (p.status === "occupied") pin.occupied += 1;
  }
  return [...byPlace.values()];
}
