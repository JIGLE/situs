This directory contains small test helpers used by the project's vitest setup.

- `prisma-mock.ts` — an in-memory lightweight mock of Prisma client used when
  `DATABASE_URL` is not set. Import with `import prismaMock from './prisma-mock'`.
- `globals.ts` — polyfills and global shims for node test runs (fetch, TextEncoder, TextDecoder).

To inject a custom Prisma mock in a particular test file:

```ts
import { setPrismaClientForTests } from "@/lib/services/database/database";
import customMock from "./helpers/prisma-mock";

setPrismaClientForTests(customMock as any);
```

Remember to call `resetPrismaClientForTests()` in afterEach to avoid cross-test leakage.
