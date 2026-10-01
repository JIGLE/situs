import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * A tenant's and an owner's email and phone, and a property's rooms, are optional, and an email is
 * unique per account. These are properties of the SQLite schema itself, so they are proved against
 * a real file, as the PII test is.
 *
 * The schema is pushed WITHOUT `--accept-data-loss`: a fresh file needs no such consent, and the
 * flag is the one thing a development environment may refuse to run.
 */
describe("optional contact fields — real Prisma client + real SQLite file", () => {
  let tempDir: string;
  let prisma: Awaited<ReturnType<typeof loadClient>>;

  async function loadClient() {
    const { getPrismaClient, resetPrismaClientForTests } = await import("./database");
    resetPrismaClientForTests();
    return getPrismaClient();
  }

  const newUser = (tag: string) =>
    prisma.user.create({ data: { email: `contacts-${tag}-${Date.now()}@example.com` } });

  const tenantData = (userId: string, name: string, extra: Record<string, unknown> = {}) => ({
    userId,
    name,
    rent: 600,
    leaseStart: new Date("2026-01-01"),
    leaseEnd: new Date("2026-12-31"),
    ...extra,
  });

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "situs-contacts-test-"));
    const dbUrl = `file:${path.join(tempDir, "test.db")}`;

    execSync(`npx prisma db push --url="${dbUrl}"`, {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: "pipe",
    });

    process.env.DATABASE_URL = dbUrl;
    process.env.PII_ENCRYPTION_KEY = "c".repeat(64);
    prisma = await loadClient();
  }, 90_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    const { resetPrismaClientForTests } = await import("./database");
    resetPrismaClientForTests();
    if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  it("lets two tenants of one account have no email and no phone", async () => {
    const user = await newUser("tenants-none");

    const first = await prisma.tenant.create({ data: tenantData(user.id, "Rui Silva") });
    const second = await prisma.tenant.create({ data: tenantData(user.id, "Marie Dupont") });

    // NULL, not "": an empty string is a value, and the second one would have collided.
    expect(first.email).toBeNull();
    expect(first.phone).toBeNull();
    expect(second.email).toBeNull();
    expect(await prisma.tenant.count({ where: { userId: user.id } })).toBe(2);
  });

  it("lets two owners of one account have no email", async () => {
    const user = await newUser("owners-none");

    await prisma.owner.create({ data: { userId: user.id, name: "Ana Costa" } });
    await prisma.owner.create({ data: { userId: user.id, name: "Rui Costa" } });

    expect(await prisma.owner.count({ where: { userId: user.id, email: null } })).toBe(2);
  });

  it("refuses an email an account already has, for a tenant and for an owner", async () => {
    const user = await newUser("duplicate");
    await prisma.tenant.create({ data: tenantData(user.id, "A", { email: "same@example.com" }) });
    await prisma.owner.create({ data: { userId: user.id, name: "O", email: "owner@example.com" } });

    await expect(
      prisma.tenant.create({ data: tenantData(user.id, "B", { email: "same@example.com" }) }),
    ).rejects.toMatchObject({ code: "P2002" });
    await expect(
      prisma.owner.create({ data: { userId: user.id, name: "P", email: "owner@example.com" } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("turns that refusal into a 409 with its own reason", async () => {
    const { refuseDuplicateEmail, EmailInUseError } = await import("./unique-email");
    const user = await newUser("conflict");
    await prisma.tenant.create({ data: tenantData(user.id, "A", { email: "taken@example.com" }) });

    const refused = refuseDuplicateEmail("tenant", () =>
      prisma.tenant.create({ data: tenantData(user.id, "B", { email: "taken@example.com" }) }),
    );

    await expect(refused).rejects.toBeInstanceOf(EmailInUseError);
    await expect(refused).rejects.toMatchObject({ reason: "email_in_use" });
  });

  it("lets two accounts have a tenant with the same email, which one landlord must not be able to tell", async () => {
    const mine = await newUser("mine");
    const theirs = await newUser("theirs");

    await prisma.tenant.create({ data: tenantData(mine.id, "A", { email: "shared@example.com" }) });
    await expect(
      prisma.tenant.create({ data: tenantData(theirs.id, "B", { email: "shared@example.com" }) }),
    ).resolves.toMatchObject({ email: "shared@example.com" });
  });

  it("keeps the phone of a tenant who has none as NULL through the encryption extension", async () => {
    const user = await newUser("phone");

    const without = await prisma.tenant.create({ data: tenantData(user.id, "No Phone") });
    const withPhone = await prisma.tenant.create({
      data: tenantData(user.id, "Has Phone", { phone: "+351 912 345 678" }),
    });

    expect((await prisma.tenant.findUnique({ where: { id: without.id } }))?.phone).toBeNull();
    expect((await prisma.tenant.findUnique({ where: { id: withPhone.id } }))?.phone).toBe(
      "+351 912 345 678",
    );
  });

  it("saves a property with no rooms, and reads them back as unknown, not as none", async () => {
    const user = await newUser("rooms");

    const property = await prisma.property.create({
      data: {
        userId: user.id,
        name: "Rua da Matriz",
        address: "Rua da Matriz 1, Braga",
        type: "apartment",
        rent: 600,
        status: "vacant",
      },
    });

    expect(property.bedrooms).toBeNull();
    expect(property.bathrooms).toBeNull();
    // A studio is 0, and it stays 0.
    const studio = await prisma.property.create({
      data: {
        userId: user.id,
        name: "Estúdio",
        address: "Rua do Estúdio 2, Braga",
        type: "apartment",
        bedrooms: 0,
        bathrooms: 1,
        rent: 450,
        status: "vacant",
      },
    });
    expect(studio.bedrooms).toBe(0);
  });

  it("leaves what Finanças says of a contract and of a receipt unset until it is read", async () => {
    const user = await newUser("at");
    const property = await prisma.property.create({
      data: {
        userId: user.id,
        name: "P",
        address: "A",
        type: "apartment",
        rent: 1,
        status: "occupied",
      },
    });
    const tenant = await prisma.tenant.create({ data: tenantData(user.id, "T") });

    const lease = await prisma.lease.create({
      data: {
        userId: user.id,
        propertyId: property.id,
        tenantId: tenant.id,
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-12-31"),
        monthlyRent: 600,
      },
    });
    const receipt = await prisma.rentReceipt.create({
      data: {
        userId: user.id,
        tenantId: tenant.id,
        propertyId: property.id,
        receiptNumber: `RR/2026/${Date.now()}`,
        landlordNif: "123456789",
        propertyAddress: "A",
        rentAmount: 600,
        netAmount: 600,
        paymentDate: new Date("2026-02-01"),
        receiptDate: new Date("2026-02-02"),
        periodStart: new Date("2026-02-01"),
        periodEnd: new Date("2026-02-28"),
      },
    });

    // Unset is not "inactive": a contract that has not been read must not be refused as ended.
    expect(lease.atActive).toBeNull();
    expect(lease.atReadAt).toBeNull();
    expect(receipt.atReceiptNumber).toBeNull();

    const read = new Date("2026-10-01T09:00:00Z");
    const updated = await prisma.lease.update({
      where: { id: lease.id },
      data: { atActive: false, atReadAt: read },
    });
    expect(updated.atActive).toBe(false);
    expect(updated.atReadAt?.toISOString()).toBe(read.toISOString());
  });
});
