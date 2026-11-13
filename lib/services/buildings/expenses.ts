import { getPrismaClient } from "@/lib/services/database/database";
import { ConflictError, ResourceNotFoundError, ValidationError } from "@/lib/utils/error-handling";
import { sanitizeForDatabase } from "@/lib/utils/sanitize";
import type { BuildingExpenseInput } from "@/lib/schemas/building-expense.schema";
import { splitBuildingExpense, type SplitBasis } from "./split";

/**
 * A building's shared expenses. Each is one `BuildingExpense` row and one ordinary `Expense` per
 * unit that shares it, its part (`./split.ts`), so everything that reads a property's expenses
 * (the co-owners' shares, the year's summary per property for Anexo F, deductibility) reads the
 * part with no idea a building exists. A part is changed only through its building expense: every
 * write here deletes the parts and writes them again, in one transaction.
 */

export interface BuildingExpensePart {
  id: string;
  propertyId: string;
  propertyName: string;
  amount: number;
}

export interface BuildingExpenseView {
  id: string;
  buildingId: string;
  amount: number;
  date: string;
  category: string;
  description: string | null;
  isDeductible: boolean;
  vendorName: string | null;
  vendorVat: string | null;
  splitBasis: SplitBasis;
  parts: BuildingExpensePart[];
}

const PARTS = {
  parts: {
    select: { id: true, propertyId: true, amount: true, property: { select: { name: true } } },
    orderBy: { property: { name: "asc" } },
  },
} as const;

type Row = Awaited<ReturnType<typeof findRow>>;

function findRow(userId: string, id: string) {
  return getPrismaClient().buildingExpense.findFirst({
    where: { id, userId },
    include: PARTS,
  });
}

function toView(row: NonNullable<Row>): BuildingExpenseView {
  return {
    id: row.id,
    buildingId: row.buildingId,
    amount: row.amount,
    date: row.date.toISOString(),
    category: row.category,
    description: row.description,
    isDeductible: row.isDeductible,
    vendorName: row.vendorName,
    vendorVat: row.vendorVat,
    splitBasis: row.splitBasis === "permilage" ? "permilage" : "equal",
    parts: row.parts.map((p) => ({
      id: p.id,
      propertyId: p.propertyId,
      propertyName: p.property.name,
      amount: p.amount,
    })),
  };
}

async function assertBuilding(userId: string, buildingId: string) {
  const building = await getPrismaClient().building.findFirst({
    where: { id: buildingId, userId },
    select: { id: true, name: true },
  });
  if (!building) throw new ResourceNotFoundError("Building not found");
  return building;
}

/**
 * The units that share it, with their permilagens, in the order asked. Each must be one of this
 * account's properties in this building: a part filed against another account's property, or a
 * unit outside the building, would be the building's cost charged where it does not belong.
 */
async function unitsFor(userId: string, buildingId: string, propertyIds: string[]) {
  const ids = [...new Set(propertyIds)];
  const units = await getPrismaClient().property.findMany({
    where: { id: { in: ids }, userId, buildingId },
    select: { id: true, permilage: true },
  });
  if (units.length !== ids.length) {
    throw new ValidationError("Every unit must be in this building", "propertyIds");
  }
  const byId = new Map(units.map((u) => [u.id, u]));
  return ids.map((id) => ({ propertyId: id, permilage: byId.get(id)!.permilage }));
}

function expenseFields(input: BuildingExpenseInput) {
  const clean = (value: string | null | undefined) =>
    value?.trim() ? sanitizeForDatabase(value.trim()) : null;
  return {
    amount: input.amount,
    date: new Date(input.date),
    category: input.category,
    description: clean(input.description),
    isDeductible: input.isDeductible,
    vendorName: clean(input.vendorName),
    vendorVat: clean(input.vendorVat),
  };
}

export async function listBuildingExpenses(
  userId: string,
  buildingId: string,
): Promise<BuildingExpenseView[]> {
  await assertBuilding(userId, buildingId);
  const rows = await getPrismaClient().buildingExpense.findMany({
    where: { userId, buildingId },
    include: PARTS,
    orderBy: { date: "desc" },
  });
  return rows.map(toView);
}

export async function createBuildingExpense(
  userId: string,
  buildingId: string,
  input: BuildingExpenseInput,
): Promise<BuildingExpenseView> {
  await assertBuilding(userId, buildingId);
  const units = await unitsFor(userId, buildingId, input.propertyIds);
  const fields = expenseFields(input);
  const { basis, parts } = splitBuildingExpense(fields.amount, units);

  const prisma = getPrismaClient();
  const id = await prisma.$transaction(async (tx) => {
    const created = await tx.buildingExpense.create({
      data: { ...fields, userId, buildingId, splitBasis: basis },
      select: { id: true },
    });
    await tx.expense.createMany({
      data: parts.map((part) => ({
        ...fields,
        amount: part.amount,
        userId,
        propertyId: part.propertyId,
        buildingExpenseId: created.id,
      })),
    });
    return created.id;
  });
  return toView((await findRow(userId, id))!);
}

/**
 * Rewrites the expense and its parts. The units are the ones sent, or the ones that shared it
 * before; each part is split again, so a unit's permilagem corrected since is used.
 */
export async function updateBuildingExpense(
  userId: string,
  buildingId: string,
  id: string,
  input: BuildingExpenseInput,
): Promise<BuildingExpenseView> {
  const existing = await findRow(userId, id);
  if (!existing || existing.buildingId !== buildingId) {
    throw new ResourceNotFoundError("Building expense not found");
  }
  await refuseLinkedParts(existing.parts.map((p) => p.id));
  const units = await unitsFor(userId, buildingId, input.propertyIds);
  const fields = expenseFields(input);
  const { basis, parts } = splitBuildingExpense(fields.amount, units);

  await getPrismaClient().$transaction(async (tx) => {
    await tx.expense.deleteMany({ where: { userId, buildingExpenseId: id } });
    await tx.buildingExpense.update({
      where: { id },
      data: { ...fields, splitBasis: basis },
    });
    await tx.expense.createMany({
      data: parts.map((part) => ({
        ...fields,
        amount: part.amount,
        userId,
        propertyId: part.propertyId,
        buildingExpenseId: id,
      })),
    });
  });
  return toView((await findRow(userId, id))!);
}

export async function deleteBuildingExpense(
  userId: string,
  buildingId: string,
  id: string,
): Promise<void> {
  const existing = await findRow(userId, id);
  if (!existing || existing.buildingId !== buildingId) {
    throw new ResourceNotFoundError("Building expense not found");
  }
  await refuseLinkedParts(existing.parts.map((p) => p.id));
  // The parts go with it (`Expense.buildingExpense` cascades).
  await getPrismaClient().buildingExpense.delete({ where: { id } });
}

/**
 * A part a bank movement paid cannot be rewritten: the movement would be left pointing at a part
 * that no longer exists, or at one of a different amount.
 */
async function refuseLinkedParts(partIds: string[]) {
  if (partIds.length === 0) return;
  const linked = await getPrismaClient().bankTransaction.count({
    where: { expenseId: { in: partIds } },
  });
  if (linked > 0) {
    throw new ConflictError(
      "A bank movement paid part of this building expense",
      "building_expense_linked",
    );
  }
}

/** Refused for a part of a building expense: it is changed through the building. */
export function assertNotBuildingPart(expense: { buildingExpenseId: string | null }): void {
  if (expense.buildingExpenseId) {
    throw new ConflictError(
      "This expense is a unit's part of a building expense; change it in the building",
      "expense_from_building",
    );
  }
}
