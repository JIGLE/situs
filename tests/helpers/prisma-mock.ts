/* Minimal in-memory Prisma-like mock for tests.
   Use setPrismaClientForTests(createPrismaMock()) to inject into test environment.
   This mock intentionally implements a small subset of Prisma client APIs used by the
   test-suite and library code: $connect/$disconnect, $transaction, and a few model
   methods for `user`, `emailLog`, `property`, `tenant`, and `receipt`.

   It's small on purpose — extend it as needed by tests. Keep methods synchronous
   to avoid introducing async timing flakiness; callers that expect promises will still
   work because methods return Promise.resolve(...) where appropriate.
*/

type AnyRecord = Record<string, any>;

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

function matches(where: AnyRecord | undefined, item: AnyRecord): boolean {
  if (!where) return true;
  // Support top-level logical operators
  if ("OR" in where && Array.isArray(where.OR)) {
    return where.OR.some((sub: AnyRecord) => matches(sub, item));
  }
  if ("AND" in where && Array.isArray(where.AND)) {
    return where.AND.every((sub: AnyRecord) => matches(sub, item));
  }

  for (const key of Object.keys(where)) {
    const val = where[key];
    if (val === undefined) continue;
    if (typeof val === "object" && val !== null) {
      // Support { in: [...] }, { equals: x }, { contains: 'x' }, { startsWith: 'x' }
      if ("in" in val) {
        if (!Array.isArray(val.in) || !val.in.includes(item[key])) return false;
        continue;
      }
      if ("equals" in val) {
        if (item[key] !== val.equals) return false;
        continue;
      }
      if ("contains" in val) {
        const it = item[key];
        if (typeof it !== "string" || !it.includes(val.contains)) return false;
        continue;
      }
      if ("startsWith" in val) {
        const it = item[key];
        if (typeof it !== "string" || !it.startsWith(val.startsWith)) return false;
        continue;
      }
    }
    if (item[key] !== val) return false;
  }
  return true;
}

export function createPrismaMock() {
  const state: Record<string, AnyRecord[]> = {
    user: [],
    emailLog: [],
    property: [],
    tenant: [],
    receipt: [],
    account: [],
    session: [],
    verificationToken: [],
    lease: [],
    expense: [],
    owner: [],
    correspondenceTemplate: [],
    correspondence: [],
  };
  let _idSeq = 1;

  function nextId() {
    return (_idSeq++).toString();
  }

  function ensureModel(name: string) {
    if (!state[name]) state[name] = [];
    return state[name];
  }

  function makeModel(name: string) {
    const storage = () => ensureModel(name);
    return {
      findUnique: async ({ where }: { where: AnyRecord }) =>
        clone(storage().find((r) => matches(where, r))) || null,
      findFirst: async ({ where }: { where?: AnyRecord } = {}) =>
        clone(storage().find((r) => matches(where, r))) || null,
      findMany: async ({ where }: { where?: AnyRecord } = {}) => {
        const results = storage().filter((r) => matches(where, r));
        // Basic include handling for common relations
        if (name === "property") {
          return clone(
            results.map((p) => ({
              ...p,
              tenants: ensureModel("tenant").filter((t) => t.propertyId === p.id),
              receipts: ensureModel("receipt").filter((r) => r.propertyId === p.id),
            })),
          );
        }
        if (name === "tenant") {
          return clone(
            results.map((t) => ({
              ...t,
              property: ensureModel("property").find((p) => p.id === t.propertyId) || null,
              receipts: ensureModel("receipt").filter((r) => r.tenantId === t.id),
            })),
          );
        }
        if (name === "receipt") {
          return clone(
            results.map((r) => ({
              ...r,
              tenant: ensureModel("tenant").find((t) => t.id === r.tenantId) || null,
              property: ensureModel("property").find((p) => p.id === r.propertyId) || null,
            })),
          );
        }
        if (name === "correspondence") {
          return clone(
            results.map((c) => ({
              ...c,
              template:
                ensureModel("correspondenceTemplate").find((t) => t.id === c.templateId) || null,
              tenant: ensureModel("tenant").find((t) => t.id === c.tenantId) || null,
            })),
          );
        }
        return clone(results);
      },
      create: async ({ data }: { data: AnyRecord }) => {
        // Basic unique constraint simulation for common models
        if (name === "user" && data.email) {
          const exists = ensureModel("user").some((u) => u.email === data.email);
          if (exists) {
            const err = new Error(`Unique constraint failed on the fields: (email)`);
            // @ts-ignore add code to mimic Prisma error
            err.code = "P2002";
            throw err;
          }
        }
        if (name === "account" && data.provider && data.providerAccountId) {
          const exists = ensureModel("account").some(
            (a) => a.provider === data.provider && a.providerAccountId === data.providerAccountId,
          );
          if (exists) {
            const err = new Error(
              `Unique constraint failed on the fields: (provider, providerAccountId)`,
            );
            // @ts-ignore
            err.code = "P2002";
            throw err;
          }
        }
        const newItem = Object.assign(
          {
            id: nextId(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          data,
        );
        storage().push(newItem);
        return clone(newItem);
      },
      update: async ({ where, data }: { where: AnyRecord; data: AnyRecord }) => {
        const idx = storage().findIndex((r) => matches(where, r));
        if (idx === -1) throw new Error(`${name} not found`);
        storage()[idx] = Object.assign({}, storage()[idx], data, {
          updatedAt: new Date().toISOString(),
        });
        return clone(storage()[idx]);
      },
      delete: async ({ where }: { where: AnyRecord }) => {
        const idx = storage().findIndex((r) => matches(where, r));
        if (idx === -1) throw new Error(`${name} not found`);
        const [removed] = storage().splice(idx, 1);
        return clone(removed);
      },
      count: async ({ where }: { where?: AnyRecord } = {}) =>
        storage().filter((r) => matches(where, r)).length,
      createMany: async ({ data }: { data: AnyRecord[] }) => {
        const created = data.map((d) =>
          Object.assign(
            {
              id: nextId(),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            d,
          ),
        );
        storage().push(...created);
        return { count: created.length };
      },
      deleteMany: async ({ where }: { where?: AnyRecord } = {}) => {
        const toKeep = storage().filter((r) => !matches(where, r));
        const removed = storage().length - toKeep.length;
        state[name] = toKeep;
        return { count: removed };
      },
      groupBy: async ({ by }: { by: string[] }) => {
        if (!Array.isArray(by) || by.length !== 1) return [];
        const key = by[0];
        const map: Record<string, number> = {};
        for (const e of storage()) {
          const val = e[key] == null ? "__null__" : String(e[key]);
          map[val] = (map[val] || 0) + 1;
        }
        return Object.keys(map).map((k) => ({
          [key]: k === "__null__" ? null : k,
          _count: { _all: map[k] },
        }));
      },
    };
  }

  const client: Record<string, any> = {
    $connect: async () => {},
    $disconnect: async () => {},
    $on: (_: any, __: any) => {},
    $transaction: async (cb: any) => {
      if (typeof cb === "function") return await cb();
      const results: any[] = [];
      for (const op of cb) results.push(await op);
      return results;
    },
    __state: state,
    __reset: () => {
      for (const k of Object.keys(state)) state[k].length = 0;
      _idSeq = 1;
    },
  } as any;

  // Expose common models
  const models = Object.keys(state);
  for (const m of models) client[m] = makeModel(m);

  // Convenience helpers to mimic a small subset of PrismaClient API used in tests
  client.findFirst = client.findUnique = async ({
    model,
    where,
  }: {
    model: string;
    where?: AnyRecord;
  }) => {
    const mod = client[model];
    if (!mod) return null;
    return (await mod.findFirst) ? await mod.findFirst({ where }) : await mod.findUnique({ where });
  };

  return client as any;
}

export const prismaMock = createPrismaMock();

export default prismaMock;
