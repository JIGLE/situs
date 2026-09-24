import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * A confirmed contract written through the real client into a real SQLite file.
 *
 * The unit tests stub Prisma; this is where the transaction proves what only a database can: that
 * every row lands linked, that the NIFs and the document number written inside the interactive
 * transaction are ciphertext on disk (the PII extension transforms a transaction's top-level
 * writes too), and that the lease's rent months are seeded. The on-disk check reads the file's
 * raw bytes, as lib/services/database/pii-extension.integration.test.ts does and for its reasons.
 */
describe("importContract — real Prisma client + real SQLite file", () => {
  let tempDir: string;
  let dbPath: string;

  beforeAll(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "situs-import-test-"));
    dbPath = path.join(tempDir, "test.db");
    const dbUrl = `file:${dbPath}`;

    execSync(`npx prisma db push --accept-data-loss --url="${dbUrl}"`, {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: "pipe",
    });

    process.env.DATABASE_URL = dbUrl;
    process.env.PII_ENCRYPTION_KEY = "c".repeat(64);
  }, 60_000);

  afterAll(async () => {
    const { resetPrismaClientForTests } = await import("@/lib/services/database/database");
    resetPrismaClientForTests();
    if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  it("writes every record linked, in one transaction, with no NIF in clear on disk", async () => {
    const { getPrismaClient, resetPrismaClientForTests } =
      await import("@/lib/services/database/database");
    resetPrismaClientForTests();
    const prisma = getPrismaClient();
    const { importContract } = await import("./import");

    const stamp = Date.now();
    const tenantNif = "246813571";
    const landlordNif = "123456789";
    const guarantorDocument = "C01X00T47";

    const user = await prisma.user.create({ data: { email: `import-test-${stamp}@example.com` } });
    const paulo = await prisma.owner.create({
      data: { userId: user.id, name: "Paulo Fernandes", email: `paulo-${stamp}@example.pt` },
    });

    const imported = await importContract(user.id, {
      property: {
        mode: "new",
        name: "Rua Augusta 12",
        address: "Rua Augusta 12, 3.º Esq., 1100-048 Lisboa",
        cadasterReference: "2321",
        fraction: "C",
        type: "apartment",
        bedrooms: 2,
        bathrooms: 1,
      },
      landlords: [
        {
          mode: "new",
          name: "Maria Fernandes",
          email: `maria-${stamp}@example.pt`,
          taxId: landlordNif,
          share: 50,
        },
        { mode: "existing", id: paulo.id, share: 50 },
      ],
      tenant: {
        mode: "new",
        name: "Ana Costa",
        email: `ana-${stamp}@example.pt`,
        phone: "+351 912 345 678",
        taxId: tenantNif,
        taxCountry: "PT",
      },
      parties: [
        {
          role: "guarantor",
          name: "Hans Weber",
          taxId: "DE 4711",
          taxCountry: "DE",
          idDocument: guarantorDocument,
        },
      ],
      lease: {
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        monthlyRent: 950,
        deposit: 1900,
        autoRenew: true,
        renewalNoticeDays: 120,
        atContractNumber: "20240012345",
        atContractVersion: 1,
      },
      clauses: [
        {
          kind: "renewal",
          summary: "Renova-se por um ano, salvo oposição com 120 dias.",
          quote: "O contrato renova-se automaticamente por períodos sucessivos de um ano.",
          page: 2,
        },
      ],
    });

    // 1. Through the client: linked, and read back in clear.
    const lease = await prisma.lease.findUnique({ where: { id: imported.leaseId } });
    expect(lease).toMatchObject({
      propertyId: imported.propertyId,
      tenantId: imported.tenantId,
      atContractNumber: "20240012345",
    });
    expect((await prisma.tenant.findUnique({ where: { id: imported.tenantId } }))?.taxId).toBe(
      tenantNif,
    );
    const maria = await prisma.owner.findFirst({
      where: { userId: user.id, name: "Maria Fernandes" },
    });
    expect(maria?.taxIdentificationNumber).toBe(landlordNif);
    const shares = await prisma.propertyOwner.findMany({
      where: { propertyId: imported.propertyId },
      select: { ownerId: true, ownershipPercentage: true },
    });
    expect(shares).toEqual(
      expect.arrayContaining([
        { ownerId: maria!.id, ownershipPercentage: 50 },
        { ownerId: paulo.id, ownershipPercentage: 50 },
      ]),
    );
    const guarantor = await prisma.leaseParty.findFirst({ where: { leaseId: imported.leaseId } });
    expect(guarantor?.idDocument).toBe(guarantorDocument);
    expect(await prisma.leaseClause.count({ where: { leaseId: imported.leaseId } })).toBe(1);
    expect(await prisma.rentPeriod.count({ where: { leaseId: imported.leaseId } })).toBeGreaterThan(
      0,
    );

    await prisma.$disconnect();

    // 2. On disk: none of the three in clear.
    const raw = Buffer.concat(
      [dbPath, `${dbPath}-wal`, `${dbPath}-journal`].filter(existsSync).map((p) => readFileSync(p)),
    );
    expect(raw.includes(tenantNif, 0, "utf8")).toBe(false);
    expect(raw.includes(landlordNif, 0, "utf8")).toBe(false);
    expect(raw.includes(guarantorDocument, 0, "utf8")).toBe(false);
  });
});
