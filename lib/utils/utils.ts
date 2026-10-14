import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The type scale in app/globals.css (`text-label` …) is a set of font sizes. Without saying so,
 * tailwind-merge reads `text-label` as a text colour and drops it whenever a real colour such as
 * `text-[var(--color-muted-foreground)]` follows in the same `cn()`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["label", "badge", "caption", "meta", "reading", "tick"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
