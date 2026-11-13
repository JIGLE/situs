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

  it("adds no money to a month already paid with no receipt to take the recibo", async () => {
    const w = await world("settled");
    const row = await monthRow(w.lease.id, 3);
    await prisma.rentPeriod.update({
      where: { id: row.id },
      data: { allocatedAmount: RENT, status: "paid" },
    });

    expect((await lib.proposeReceipt(w.user.id, recibo("2026-03"))).outcome).toBe("paid");
    const result = await lib.registerReceipt(w.user.id, {
      leaseId: w.lease.id,
      month: { year: 2026, month: 3 },
      parsed: recibo("2026-03"),
      pdf: PDF,
      fileName: "recibo.pdf",
    });

    expect(result).toEqual({ outcome: "paid", receiptIds: [] });
    expect((await monthRow(w.lease.id, 4)).allocatedAmount).toBe(0);
    expect(await prisma.receipt.count({ where: { leaseId: w.lease.id } })).toBe(0);
  });

  it("moves an active contract's start back to an older recibo's month only when the owner ticks it", async () => {
    const w = await world("before-start");

    const proposal = await lib.proposeReceipt(w.user.id, recibo("2025-10", { rent: 700 }));
    expect(proposal).toMatchObject({
      leaseId: w.lease.id,
      outcome: "extend",
      term: { startDate: "2025-10-01", endDate: null },
      leaseStart: "2026-01-01",
    });

    // Without the owner's tick, nothing about the contract changes.
    await expect(
      lib.registerReceipt(w.user.id, {
        leaseId: w.lease.id,
        month: { year: 2025, month: 10 },
        parsed: recibo("2025-10", { rent: 700, received: 700 }),
        pdf: PDF,
        fileName: "recibo.pdf",
      }),
    ).rejects.toMatchObject({ reason: "receipt_month_untracked" });
    const untouched = await prisma.lease.findUniqueOrThrow({ where: { id: w.lease.id } });
    expect(untouched.startDate.toISOString().slice(0, 10)).toBe("2026-01-01");
    expect(await prisma.receipt.count({ where: { leaseId: w.lease.id } })).toBe(0);

    const result = await lib.registerReceipt(w.user.id, {
      leaseId: w.lease.id,
      month: { year: 2025, month: 10 },
      parsed: recibo("2025-10", { rent: 700, received: 700 }),
      pdf: PDF,
      fileName: "recibo.pdf",
      allowTermChange: true,
    });

    expect(result.outcome).toBe("create");
    const lease = await prisma.lease.findUniqueOrThrow({ where: { id: w.lease.id } });
    expect(lease.startDate.toISOString().slice(0, 10)).toBe("2025-10-01");
    const months = await prisma.rentPeriod.findMany({
      where: { leaseId: w.lease.id, year: 2025 },
      orderBy: { month: "asc" },
    });
    expect(months.map((m) => [m.month, m.status, m.allocatedAmount])).toEqual([
      [10, "paid_late", 700],
      [11, "waived", 0],
      [12, "waived", 0],
    ]);
    // Received on the 4th, so paid late; and the recibo's rent is what that month owed, so it reads
    // as paid, not part-paid.
    expect(months[0].dueAmount).toBe(700);
    expect((await monthRow(w.lease.id, 1)).allocatedAmount).toBe(0);

    // A recibo for a month it waived on the way pays that month, at its own rent.
    await lib.registerReceipt(w.user.id, {
      leaseId: w.lease.id,
      month: { year: 2025, month: 11 },
      parsed: recibo("2025-11", { rent: 700, received: 700 }),
      pdf: PDF,
      fileName: "recibo.pdf",
    });
    const november = await prisma.rentPeriod.findFirstOrThrow({
      where: { leaseId: w.lease.id, year: 2025, month: 11 },
    });
    expect([november.status, november.allocatedAmount, november.dueAmount]).toEqual([
      "paid_late",
      700,
      700,
    ]);
    expect(await prisma.receipt.count({ where: { leaseId: w.lease.id } })).toBe(2);
  });

  it("carries a lapsed term forward a year at a time to take a later recibo", async () => {
    const w = await world("after-end");

    expect((await lib.proposeReceipt(w.user.id, recibo("2027-02"))).term).toEqual({
      startDate: null,
      endDate: "2027-12-31",
    });
    await lib.registerReceipt(w.user.id, {
      leaseId: w.lease.id,
      month: { year: 2027, month: 2 },
      parsed: recibo("2027-02"),
      pdf: PDF,
      fileName: "recibo.pdf",
      allowTermChange: true,
    });

    const lease = await prisma.lease.findUniqueOrThrow({ where: { id: w.lease.id } });
    expect(lease.endDate.toISOString().slice(0, 10)).toBe("2027-12-31");
    const february = await prisma.rentPeriod.findFirstOrThrow({
      where: { leaseId: w.lease.id, year: 2027, month: 2 },
    });
    expect([february.status, february.allocatedAmount]).toEqual(["paid_late", RENT]);
  });

  it("refuses a month a contract that is not active has no rent for", async () => {
    const w = await world("outside");
    await prisma.lease.update({ where: { id: w.lease.id }, data: { status: "terminated" } });

    expect(await lib.proposeReceipt(w.user.id, recibo("2025-12"))).toMatchObject({
      outcome: "no_month",
      inactive: true,
    });
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
