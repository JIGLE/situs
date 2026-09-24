/**
 * Shared Prisma orchestration behind every country tax connector
 * (lib/tax/connectors/*.ts): find-or-create the per-user connector row and
 * append to the append-only TaxSubmissionLog.
 */

import { getPrismaClient } from "@/lib/services/database/database";

export async function ensureConnector(userId: string, country: string, connectorKey: string) {
  const prisma = getPrismaClient();
  const existing = await prisma.taxAuthorityConnector.findUnique({
    where: { userId_connectorKey: { userId, connectorKey } },
  });
  if (existing) return existing;
  return prisma.taxAuthorityConnector.create({
    data: { userId, country, connectorKey, mode: "review", status: "active" },
  });
}

export interface LogSubmissionInput {
  userId: string;
  connectorId: string;
  subjectType: "rent_receipt";
  subjectId: string;
  action: "validate" | "submit" | "poll" | "cancel";
  mode: string;
  status: "success" | "error" | "pending";
  responseCode?: string;
  responseBody?: string;
}

export async function logSubmission(input: LogSubmissionInput): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.taxSubmissionLog.create({ data: input });
  await prisma.taxAuthorityConnector.update({
    where: { id: input.connectorId },
    data: { lastSubmissionAt: new Date() },
  });
}
