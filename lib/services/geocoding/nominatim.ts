/**
 * Where a property is on the map, from its address, through Nominatim (OpenStreetMap's own
 * geocoder: free, no key). The property form already asks it from the browser while the owner
 * types; this is the server-side half, for properties that arrived with an address and no
 * coordinates (an import from Finanças, an address typed by hand).
 *
 * Nominatim's usage policy (https://operations.osmfoundation.org/policies/nominatim/) asks for at
 * most one request a second, an identifying User-Agent, and no repeated queries. So every request
 * here waits its turn behind the last one (`throttle`), a property is tried with a short ladder of
 * queries and stops at the first answer, and an address that found nothing is not asked again
 * until the server restarts or the address changes (`failed`).
 */

export interface GeocodeInput {
  streetAddress?: string | null;
  address: string;
  city?: string | null;
  zipCode?: string | null;
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

const NOMINATIM_SEARCH = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "Situs Property Management/1.0 (self-hosted)";
/** A little over the policy's one a second. */
const MIN_INTERVAL_MS = 1100;
/** Portugal, mainland and the islands: min_lon,max_lat,max_lon,min_lat as Nominatim's viewbox. */
const PORTUGAL_VIEWBOX = "-31.5,42.2,-6.1,32.4";

/** A Portuguese postal code, "1170-020"; the four-digit area alone also places a pin. */
const POSTAL_CODE = /\b(\d{4})-?(\d{3})\b/;

/**
 * The street with what Nominatim cannot place taken off: the floor and side ("2º ESQ", "R/C",
 * "1.º Dto"), which an import writes after the first comma.
 */
function streetOnly(input: GeocodeInput): string {
  const raw = (input.streetAddress ?? "").trim() || input.address.split(",")[0]?.trim() || "";
  return raw.replace(/\s+/g, " ");
}

function postalCodeOf(input: GeocodeInput): string {
  const fromField = (input.zipCode ?? "").match(POSTAL_CODE);
  const match = fromField ?? input.address.match(POSTAL_CODE);
  return match ? `${match[1]}-${match[2]}` : "";
}

/**
 * The queries to try, most precise first. Each is the parameters of one Nominatim search; the
 * first that answers places the pin. A ladder rather than one free-text query because an
 * imported address carries the floor ("Rua de Angola 25, 2º ESQ, 1170-020 Lisboa"), which makes
 * Nominatim find nothing at all.
 */
export function geocodeQueries(input: GeocodeInput): Record<string, string>[] {
  const street = streetOnly(input);
  const postalCode = postalCodeOf(input);
  const city = (input.city ?? "").trim();
  const queries: Record<string, string>[] = [];
  const seen = new Set<string>();
  const add = (q: Record<string, string>) => {
    const key = JSON.stringify(q);
    if (seen.has(key)) return;
    seen.add(key);
    queries.push(q);
  };

  if (street && (city || postalCode)) {
    add({
      street,
      ...(city ? { city } : {}),
      ...(postalCode ? { postalcode: postalCode } : {}),
    });
  }
  if (street && city) add({ q: `${street}, ${city}` });
  if (postalCode) add({ postalcode: postalCode, ...(city ? { city } : {}) });
  if (city) add({ city });
  // Nothing structured to go on: the address as written, which is all a hand-typed one has.
  if (queries.length === 0 && input.address.trim()) add({ q: input.address.trim() });
  return queries;
}

/** What `failed` keys an address by: the fields the queries are made of. */
export function addressKey(input: GeocodeInput): string {
  return [input.streetAddress, input.address, input.city, input.zipCode]
    .map((part) => (part ?? "").trim().toLowerCase())
    .join("|");
}

const failed = new Set<string>();
let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

/** Runs `task` once every earlier one has finished and a second has passed since the last. */
function throttle<T>(task: () => Promise<T>, wait: (ms: number) => Promise<void>): Promise<T> {
  const run = queue.then(async () => {
    const since = Date.now() - lastRequestAt;
    if (since < MIN_INTERVAL_MS) await wait(MIN_INTERVAL_MS - since);
    lastRequestAt = Date.now();
    return task();
  });
  queue = run.catch(() => undefined);
  return run;
}

export interface GeocodeDeps {
  fetch?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The property's coordinates, or null when none of the queries found it (or this address already
 * failed since the server started). A network failure is not remembered as a miss: it says
 * nothing about the address.
 */
export async function geocode(
  input: GeocodeInput,
  deps: GeocodeDeps = {},
): Promise<Coordinates | null> {
  const key = addressKey(input);
  if (failed.has(key)) return null;
  const doFetch = deps.fetch ?? fetch;
  const wait = deps.wait ?? sleep;

  for (const query of geocodeQueries(input)) {
    const params = new URLSearchParams({
      ...query,
      format: "jsonv2",
      limit: "1",
      countrycodes: "pt",
      viewbox: PORTUGAL_VIEWBOX,
    });
    const response = await throttle(
      () =>
        doFetch(`${NOMINATIM_SEARCH}?${params}`, {
          headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
          signal: AbortSignal.timeout(10_000),
        }),
      wait,
    );
    if (!response.ok) throw new Error(`Nominatim answered ${response.status}`);
    const results = (await response.json()) as Array<{ lat?: string; lon?: string }>;
    const first = Array.isArray(results) ? results[0] : undefined;
    const latitude = Number(first?.lat);
    const longitude = Number(first?.lon);
    if (first && Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return { latitude, longitude };
    }
  }
  failed.add(key);
  return null;
}

/** Whether this address already found nothing since the server started. */
export function alreadyFailed(input: GeocodeInput): boolean {
  return failed.has(addressKey(input));
}

/** For tests: forget the misses and the clock. */
export function resetGeocoderForTests(): void {
  failed.clear();
  queue = Promise.resolve();
  lastRequestAt = 0;
}
