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

/**
 * How exactly a place found from an address stands for the property: "exact" is a house number or
 * a building, "street" the street it is on, "area" only its postal code or town, a pin that is not
 * the property at all. "pinned" is the owner's own pin on the map, which no lookup writes.
 */
export type LocationPrecision = "exact" | "street" | "area" | "pinned";

export interface Located extends Coordinates {
  precision: Exclude<LocationPrecision, "pinned">;
  /** Nominatim's name for the place it found, for the owner to recognise. */
  displayName: string;
}

/**
 * Nominatim's place_rank as a precision: 30 is a house or building, 26–27 a street; anything below
 * is a postcode, a parish or a town. A query that names no street can only find an area.
 */
export function precisionOf(
  placeRank: unknown,
  query: Record<string, string>,
): Located["precision"] {
  const namesStreet = "street" in query || "q" in query;
  const rank = Number(placeRank);
  if (!namesStreet || !Number.isFinite(rank)) return "area";
  if (rank >= 28) return "exact";
  if (rank >= 26) return "street";
  return "area";
}

const NOMINATIM_SEARCH = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_REVERSE = "https://nominatim.openstreetmap.org/reverse";
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
  const found = await locate(input, deps);
  return found ? { latitude: found.latitude, longitude: found.longitude } : null;
}

/** `geocode`, saying how exactly the place found stands for the property, and what it is called. */
export async function locate(input: GeocodeInput, deps: GeocodeDeps = {}): Promise<Located | null> {
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
    const results = (await response.json()) as Array<{
      lat?: string;
      lon?: string;
      place_rank?: number;
      display_name?: string;
    }>;
    const first = Array.isArray(results) ? results[0] : undefined;
    const latitude = Number(first?.lat);
    const longitude = Number(first?.lon);
    if (first && Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return {
        latitude,
        longitude,
        precision: precisionOf(first.place_rank, query),
        displayName: first.display_name ?? "",
      };
    }
  }
  failed.add(key);
  return null;
}

/** The address at a point, split as the property form keeps it. */
export interface ReverseAddress {
  streetAddress: string;
  zipCode: string;
  city: string;
  displayName: string;
}

interface NominatimAddress {
  house_number?: string;
  road?: string;
  pedestrian?: string;
  postcode?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  county?: string;
}

/**
 * A Nominatim address as the form's fields, in Portuguese order: "Rua de Angola 25", "1170-020",
 * "Lisboa". The town is the city where Nominatim names one, else the concelho.
 */
export function toReverseAddress(address: NominatimAddress, displayName: string): ReverseAddress {
  const road = address.road ?? address.pedestrian ?? "";
  const streetAddress = [road, address.house_number].filter(Boolean).join(" ");
  const digits = (address.postcode ?? "").replace(/\D/g, "");
  const zipCode = digits.length === 7 ? `${digits.slice(0, 4)}-${digits.slice(4)}` : "";
  const city =
    address.city ?? address.town ?? address.municipality ?? address.village ?? address.county ?? "";
  return { streetAddress, zipCode, city, displayName };
}

/** What is at a point the owner picked on the map, or null when Nominatim names nothing there. */
export async function reverseGeocode(
  point: Coordinates,
  deps: GeocodeDeps = {},
): Promise<ReverseAddress | null> {
  const doFetch = deps.fetch ?? fetch;
  const wait = deps.wait ?? sleep;
  const params = new URLSearchParams({
    lat: String(point.latitude),
    lon: String(point.longitude),
    format: "jsonv2",
    addressdetails: "1",
    zoom: "18",
  });
  const response = await throttle(
    () =>
      doFetch(`${NOMINATIM_REVERSE}?${params}`, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      }),
    wait,
  );
  if (!response.ok) throw new Error(`Nominatim answered ${response.status}`);
  const body = (await response.json()) as { address?: NominatimAddress; display_name?: string };
  if (!body?.address) return null;
  return toReverseAddress(body.address, body.display_name ?? "");
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
