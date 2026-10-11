import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

/**
 * `public/sw.js`, run against a fake worker scope.
 *
 * Nothing exercised it, and it served the manifest cache-first under a version that never changed:
 * a changed manifest (the dark splash colours) reached an installed app late or never, because the
 * worker kept answering with the copy from the day the app was installed.
 */
const source = readFileSync(join(import.meta.dirname, "..", "public/sw.js"), "utf8");
const ORIGIN = "https://situs.example";

type Handler = (event: Record<string, unknown>) => void;

function boot(network: (url: string) => Promise<Response>) {
  const listeners: Record<string, Handler> = {};
  const stores = new Map<string, Map<string, Response>>();
  const fetched: string[] = [];

  const keyOf = (input: string | { url: string }) =>
    typeof input === "string" ? input : input.url;
  const toUrl = (input: string | { url: string }) => {
    const raw = keyOf(input);
    return raw.startsWith("http") ? raw : `${ORIGIN}${raw}`;
  };
  const caches = {
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        async addAll(urls: string[]) {
          for (const url of urls) store.set(toUrl(url), new Response("precached"));
        },
        async put(request: string | { url: string }, response: Response) {
          store.set(toUrl(request), response);
        },
      };
    },
    async match(request: string | { url: string }) {
      for (const store of stores.values()) {
        const hit = store.get(toUrl(request));
        if (hit) return hit.clone();
      }
      return undefined;
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name: string) {
      return stores.delete(name);
    },
  };

  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, handler: Handler) => {
      listeners[type] = handler;
    },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  vm.runInNewContext(source, {
    self,
    caches,
    fetch: (request: { url: string }) => {
      fetched.push(request.url);
      return network(request.url);
    },
    Response,
    URL,
  });

  async function dispatch(type: string, request?: { url: string; method?: string; mode?: string }) {
    let answered: Promise<Response> | undefined;
    let waited: Promise<unknown> | undefined;
    listeners[type]({
      request: request && { method: "GET", mode: "cors", ...request },
      respondWith: (promise: Promise<Response>) => (answered = promise),
      waitUntil: (promise: Promise<unknown>) => (waited = promise),
    });
    await waited;
    return answered ? await answered : undefined;
  }

  return { dispatch, stores, fetched, answered: (response?: Response) => response?.text() };
}

const ok = (body: string) => Promise.resolve(new Response(body));
const offline = () => Promise.reject(new TypeError("offline"));

describe("the service worker", () => {
  let sw: ReturnType<typeof boot>;

  describe("install and activate", () => {
    beforeEach(() => {
      sw = boot(() => ok("live"));
    });

    it("precaches the offline page and the icons, but not the manifest", async () => {
      await sw.dispatch("install");

      const cached = [...[...sw.stores.values()].flatMap((store) => [...store.keys()])];
      expect(cached).toContain(`${ORIGIN}/offline.html`);
      expect(cached).toContain(`${ORIGIN}/icon-512.png`);
      expect(cached.some((url) => url.endsWith("manifest.webmanifest"))).toBe(false);
    });

    it("drops the caches of an older version when it takes over", async () => {
      await sw.dispatch("install");
      sw.stores.set(
        "situs-v1-shell",
        new Map([[`${ORIGIN}/manifest.webmanifest`, new Response("old")]]),
      );
      sw.stores.set("situs-v1-runtime", new Map());

      await sw.dispatch("activate");

      expect([...sw.stores.keys()].sort()).toEqual(["situs-v2-shell"]);
    });
  });

  describe("the manifest", () => {
    it("is answered by the network, and the cached copy is brought up to date", async () => {
      sw = boot(() => ok("new manifest"));
      sw.stores.set(
        "situs-v2-runtime",
        new Map([[`${ORIGIN}/manifest.webmanifest`, new Response("old manifest")]]),
      );

      const response = await sw.dispatch("fetch", { url: `${ORIGIN}/manifest.webmanifest` });

      expect(await response?.text()).toBe("new manifest");
      const cached = sw.stores.get("situs-v2-runtime")!.get(`${ORIGIN}/manifest.webmanifest`);
      expect(await cached?.text()).toBe("new manifest");
    });

    it("falls back to the last copy offline", async () => {
      sw = boot(offline);
      sw.stores.set(
        "situs-v2-runtime",
        new Map([[`${ORIGIN}/manifest.webmanifest`, new Response("last manifest")]]),
      );

      const response = await sw.dispatch("fetch", { url: `${ORIGIN}/manifest.webmanifest` });

      expect(await response?.text()).toBe("last manifest");
    });

    it("does not keep an error page as the manifest", async () => {
      sw = boot(() => Promise.resolve(new Response("boom", { status: 500 })));

      await sw.dispatch("fetch", { url: `${ORIGIN}/manifest.webmanifest` });

      expect(sw.stores.get("situs-v2-runtime")?.size ?? 0).toBe(0);
    });
  });

  describe("everything else", () => {
    it("answers a navigation from the network, and the offline page when there is none", async () => {
      sw = boot(() => ok("live page"));
      const online = await sw.dispatch("fetch", { url: `${ORIGIN}/dashboard`, mode: "navigate" });
      expect(await online?.text()).toBe("live page");

      sw = boot(offline);
      await sw.dispatch("install");
      const gone = await sw.dispatch("fetch", { url: `${ORIGIN}/dashboard`, mode: "navigate" });
      expect(await gone?.text()).toBe("precached");
    });

    it("serves a hashed static file from the cache without asking the network", async () => {
      sw = boot(() => ok("from network"));
      sw.stores.set(
        "situs-v2-runtime",
        new Map([[`${ORIGIN}/_next/static/chunks/a.js`, new Response("cached chunk")]]),
      );

      const response = await sw.dispatch("fetch", { url: `${ORIGIN}/_next/static/chunks/a.js` });

      expect(await response?.text()).toBe("cached chunk");
      expect(sw.fetched).toEqual([]);
    });

    it.each([
      ["an API call", { url: `${ORIGIN}/api/properties` }],
      ["the auth pages", { url: `${ORIGIN}/auth/signin`, mode: "navigate" }],
      ["a write", { url: `${ORIGIN}/dashboard`, method: "POST" }],
      ["another site", { url: "https://elsewhere.example/x.png" }],
    ])("never touches %s", async (_what, request) => {
      sw = boot(() => ok("live"));

      expect(await sw.dispatch("fetch", request)).toBeUndefined();
    });
  });
});
