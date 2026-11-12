import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The lifecycle's own PDF writer (puppeteer, optional) is never reached: an uploaded recibo is the
// archive, found before any is generated.
vi.mock("@/lib/services/pdf-generator", () => ({
  pdfGenerator: {
    generateFromHTML: vi.fn(async () => {
      throw new Error("a generated PDF was not expected");
    }),
  },
}));

import type { ParsedRentReceipt } from "@/lib/services/financas-import/rent-receipt";

/**
 * Uploading a recibo de renda puts the month it names on the ledger, whatever else is open, takes
 * its number onto a payment already there instead of adding money, and does nothing twice. These
 * are questions about rows (periods, allocations, receipts, archives), so they are asked of a real
 * SQLite file.
 */
describe("recibos de renda uploaded — real Prisma client + real SQLite file", () => {
  let tempDir: string;
  let prisma: Awaited<ReturnType<typeof loadClient>>;
  let lib: typeof import("./financas-receipts");
  let allocation: typeof import("@/lib/services/allocation/service");
  let findExistingArchive: typeof import("./service").findExistingArchive;

  async function loadClient() {
    const { getPrismaClient, resetPrismaClientForTests } =
      await import("@/lib/services/database/database");
    resetPrismaClientForTests();
    return getPrismaClient();
  }

  const RENT = 750;
  const TENANT_NIF = "234567899";
  let counter = 0;
  const PDF = Buffer.from("%PDF-1.4 recibo");

  async function world(tag: string) {
    const stamp = `${tag}-${Date.now()}-${counter++}`;
    const user = await prisma.user.create({ data: { email: `recibo-${stamp}@example.com` } });
    const property = await prisma.property.create({
      data: {
        userId: user.id,
        name: `Rua ${stamp}`,
        address: `Rua ${stamp}, Lisboa`,
        type: "apartment",
        rent: RENT,
        status: "occupied",
        cadasterReference: "1234",
        fraction: "C",
      },
    });
    const tenant = await prisma.tenant.create({
      data: {
        userId: user.id,
        name: `Ana ${stamp}`,
        rent: RENT,
        taxId: TENANT_NIF,
        leaseStart: new Date("2026-01-01"),
        leaseEnd: new Date("2026-12-31"),
      },
    });
    const lease = await prisma.lease.create({
      data: {
        userId: user.id,
        propertyId: property.id,
        tenantId: tenant.id,
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-12-31"),
        monthlyRent: RENT,
      },
    });
    await allocation.generateRentPeriods(lease.id);
    return { user, property, tenant, lease };
  }

  const recibo = (
    month: string,
    overrides: Partial<ParsedRentReceipt> = {},
  ): ParsedRentReceipt => ({
    recognised: true,
    number: `n-${month}`,
    issuedOn: `${month}-05`,
    receivedOn: `${month}-04`,
    periodStart: `${month}-01`,
    periodEnd: `${month}-28`,
    rent: RENT,
    withheld: null,
    received: RENT,
    taxIds: ["123456789", TENANT_NIF],
    article: "1234",
    fraction: "C",
    ...overrides,
  });

  const monthRow = (leaseId: string, month: number) =>
    prisma.rentPeriod.findFirstOrThrow({ where: { leaseId, year: 2026, month } });

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "situs-recibo-test-"));
    const dbUrl = `file:${path.join(tempDir, "test.db")}`;
    execSync(`npx prisma db push --url="${dbUrl}"`, {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: "pipe",
    });
    process.env.DATABASE_URL = dbUrl;
    process.env.PII_ENCRYPTION_KEY = "d".repeat(64);
    process.env.DOCUMENT_STORAGE_PATH = path.join(tempDir, "documents");
    prisma = await loadClient();
    lib = await import("./financas-receipts");
    allocation = await import("@/lib/services/allocation/service");
    ({ findExistingArchive } = await import("./service"));
  }, 90_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    const { resetPrismaClientForTests } = await import("@/lib/services/database/database");
    resetPrismaClientForTests();
    if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  it("finds the contract by the tenant's NIF and proposes the month the recibo names", async () => {
    const w = await world("propose");

    const proposal = await lib.proposeReceipt(w.user.id, recibo("2026-03"));

    expect(proposal).toMatchObject({
      leaseId: w.lease.id,
      month: { year: 2026, month: 3 },
      outcome: "create",
      dueAmount: null,
    });
  });

  it("pays the month it names, not the oldest one open, and files the recibo as its archive", async () => {
    const w = await world("create");

    const result = await lib.registerReceipt(w.user.id, {
      leaseId: w.lease.id,
      month: { year: 2026, month: 3 },
      parsed: recibo("2026-03"),
      pdf: PDF,
      fileName: "recibo.pdf",
    });

    expect(result.outcome).toBe("create");
    expect((await monthRow(w.lease.id, 3)).allocatedAmount).toBe(RENT);
    expect((await monthRow(w.lease.id, 1)).allocatedAmount).toBe(0);
    const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: result.receiptIds[0] } });
    expect(receipt).toMatchObject({
      lifecycle: "emitted",
      status: "paid",
      financasNumber: "n-2026-03",
      referenceMonth: "2026-03",
    });
    expect(await findExistingArchive(w.user.id, receipt.id)).not.toBeNull();
  });

  it("does nothing the second time the same recibo is uploaded", async () => {
    const w = await world("duplicate");
    const input = {
      leaseId: w.lease.id,
      month: { year: 2026, month: 2 },
      parsed: recibo("2026-02"),
      pdf: PDF,
      fileName: "recibo.pdf",
    };
    await lib.registerReceipt(w.user.id, input);

    expect((await lib.registerReceipt(w.user.id, input)).outcome).toBe("duplicate");
    expect((await monthRow(w.lease.id, 2)).allocatedAmount).toBe(RENT);
    expect(await prisma.receipt.count({ where: { leaseId: w.lease.id } })).toBe(1);
  });

  it("gives a payment already on the month the recibo's number instead of adding money", async () => {
    const w = await world("attach");
    const fromBank = await prisma.receipt.create({
      data: {
        userId: w.user.id,
        tenantId: w.tenant.id,
        propertyId: w.property.id,
        leaseId: w.lease.id,
        amount: RENT,
        date: new Date("2026-01-03"),
        type: "rent",
        status: "paid",
        lifecycle: "draft",
        source: "automation",
      },
    });
    await allocation.allocateReceipt(fromBank.id);

    const proposal = await lib.proposeReceipt(w.user.id, recibo("2026-01"));
    expect(proposal.outcome).toBe("attach");

    const result = await lib.registerReceipt(w.user.id, {
      leaseId: w.lease.id,
      month: { year: 2026, month: 1 },
      parsed: recibo("2026-01"),
      pdf: PDF,
      fileName: "recibo.pdf",
    });

    expect(result).toEqual({ outcome: "attach", receiptIds: [fromBank.id] });
    expect((await monthRow(w.lease.id, 1)).allocatedAmount).toBe(RENT);
    expect(await prisma.receipt.findUniqueOrThrow({ where: { id: fromBank.id } })).toMatchObject({
      financasNumber: "n-2026-01",
      lifecycle: "emitted",
    });
  });

  it("brings back a month waived when tracking began", async () => {
    const w = await world("waived");
    const row = await monthRow(w.lease.id, 1);
    await prisma.rentPeriod.update({ where: { id: row.id }, data: { status: "waived" } });

    await lib.registerReceipt(w.user.id, {
      leaseId: w.lease.id,
      month: { year: 2026, month: 1 },
      parsed: recibo("2026-01"),
      pdf: PDF,
      fileName: "recibo.pdf",
    });

    const after = await monthRow(w.lease.id, 1);
    expect(after.allocatedAmount).toBe(RENT);
    expect(after.status).not.toBe("waived");
    expect((await monthRow(w.lease.id, 2)).allocatedAmount).toBe(0);
  });

  it("refuses a month the contract has no rent for", async () => {
    const w = await world("outside");

    await expect(
      lib.registerReceipt(w.user.id, {
        leaseId: w.lease.id,
        month: { year: 2025, month: 12 },
        parsed: recibo("2025-12"),
        pdf: PDF,
        fileName: "recibo.pdf",
      }),
    ).rejects.toMatchObject({ reason: "receipt_month_untracked" });
  });

  it("refuses another owner's contract as one that does not exist", async () => {
    const w = await world("mine");
    const other = await world("theirs");

    await expect(
      lib.registerReceipt(other.user.id, {
        leaseId: w.lease.id,
        month: { year: 2026, month: 1 },
        parsed: recibo("2026-01"),
        pdf: PDF,
        fileName: "recibo.pdf",
      }),
    ).rejects.toThrow(/not found/i);
    expect(await lib.proposeReceipt(other.user.id, recibo("2026-01"))).toMatchObject({
      leaseId: other.lease.id,
    });
  });
});
