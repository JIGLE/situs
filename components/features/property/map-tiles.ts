/**
 * What the app's maps share: OpenStreetMap's own tiles (no key, no account), drawn in greys so the
 * palette's accent is the only colour, inverted in the dark theme.
 */
export const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

/** Portugal's mainland, for a map with nothing placed yet. */
export const PORTUGAL_CENTER: [number, number] = [39.6, -8.0];

export const TILE_FILTER = {
  normal: "grayscale(1) contrast(0.92) brightness(1.04)",
  dark: "grayscale(1) invert(1) contrast(0.85) brightness(0.82)",
} as const;
