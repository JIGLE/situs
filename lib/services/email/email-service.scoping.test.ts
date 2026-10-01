import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A standing guard, written the way `lib/services/income-distribution.scoping.test.ts` is: the
 * route proves a session exists, never whose, so the service has to scope what it reads.
 *
 * `retryFailedEmail(emailLogId, userId)` looked the log up by its id alone, so any signed-in user
 * who knew another account's log id could have it sent again: the recipient of that account's
 * mail, under its subject, from this account. `getEmailMetrics` and `getEmailStats` took a
 * `userId` and never used it, so every account's delivery counts were added together.
 *
 * The store below answers a `where` the way Prisma does, so these assert what a caller sees and
 * not the shape of one query: a test that read the `where` object back would still pass a query
 * that selects the right rows for the wrong reason.
 */

type Row = {
  id: string;
  userId: string | null;
  to: string;
  from: string;
  subject: string;
  templateId: string | null;
  status: string;
  sentAt: Date;
};

const { db } = vi.hoisted(() => {
  const rows: Row[] = [];

  type Where = { id?: string; userId?: string; sentAt?: { gte?: Date } };
  const matches = (row: Row, where: Where = {}) =>
    (where.id === undefined || row.id === where.id) &&
    (where.userId === undefined || row.userId === where.userId) &&
    (where.sentAt?.gte === undefined || row.sentAt >= where.sentAt.gte);

  return {
    db: {
      rows,
      emailLog: {
        // What the lookup used before: a unique read ignores any other clause it is given here,
        // which a test double has to do too, or it would hide the defect it exists to catch.
        findUnique: vi.fn(async ({ where }: { where: Where }) =>
          rows.find((row) => row.id === where.id),
        ),
        findFirst: vi.fn(
          async ({ where }: { where: Where }) => rows.find((row) => matches(row, where)) ?? null,
        ),
        groupBy: vi.fn(async ({ where }: { where: Where }) => {
          const counts = new Map<string, number>();
          for (const row of rows.filter((r) => matches(r, where))) {
            counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
          }
          return [...counts].map(([status, id]) => ({ status, _count: { id } }));
        }),
        create: vi.fn(async ({ data }: { data: Omit<Row, "id" | "templateId"> }) => {
          rows.push({ id: `log-${rows.length + 1}`, templateId: null, ...data });
        }),
      },
    },
  };
});

vi.mock("@/lib/services/database/database", () => ({
  getPrismaClient: () => ({ emailLog: db.emailLog }),
}));

import type { MailMessage, MailTransport } from "./transport";

const ALICE = "user-alice";
const BOB = "user-bob";
const DAY = 24 * 60 * 60 * 1000;

function row(id: string, userId: string | null, status: string, ageInDays = 1): Row {
  return {
    id,
    userId,
    to: "inquilino@example.pt",
    from: "noreply@situs.test",
    subject: "Lembrete de renda",
    templateId: null,
    status,
    sentAt: new Date(Date.now() - ageInDays * DAY),
  };
}

async function loadService() {
  vi.resetModules();
  const mod = await import("@/lib/services/email/email-service");
  const service = mod.emailService;
  const sent: MailMessage[] = [];
  const transport: MailTransport = {
    send: vi.fn(async (message: MailMessage) => {
      sent.push(message);
      return { messageId: "message-1", accepted: [message.to].flat(), rejected: [] };
    }),
  };
  const internals = service as unknown as Record<string, unknown>;
  internals["transport"] = transport;
  internals["isInitialized"] = true;
  return { service, sent };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.rows.length = 0;
});

describe("retrying a failed email", () => {
  it("sends nothing for another account's log, and says it was not found", async () => {
    db.rows.push(row("log-of-alice", ALICE, "failed"));
    const { service, sent } = await loadService();

    const result = await service.retryFailedEmail("log-of-alice", BOB);

    expect(result).toMatchObject({ success: false, notFound: true });
    expect(sent).toEqual([]);
    expect(db.rows).toHaveLength(1);
  });

  it("answers an id that does not exist exactly as it answers another account's", async () => {
    db.rows.push(row("log-of-alice", ALICE, "failed"));
    const { service } = await loadService();

    const foreign = await service.retryFailedEmail("log-of-alice", BOB);
    const missing = await service.retryFailedEmail("log-nobody-has", BOB);

    expect(foreign).toEqual(missing);
  });

  it("sends the caller's own failed email again, and logs it as theirs", async () => {
    db.rows.push(row("log-of-alice", ALICE, "failed"));
    const { service, sent } = await loadService();

    const result = await service.retryFailedEmail("log-of-alice", ALICE);

    expect(result.success).toBe(true);
    expect(result.notFound).toBeUndefined();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("inquilino@example.pt");
    expect(db.rows.at(-1)).toMatchObject({ userId: ALICE, status: "sent" });
  });

  it("refuses an email that did not fail, without calling it missing", async () => {
    db.rows.push(row("log-of-alice", ALICE, "sent"));
    const { service, sent } = await loadService();

    const result = await service.retryFailedEmail("log-of-alice", ALICE);

    expect(result).toEqual({ success: false, error: "Only failed emails can be retried" });
    expect(sent).toEqual([]);
  });
});

describe("delivery metrics", () => {
  beforeEach(() => {
    db.rows.push(
      row("a-1", ALICE, "sent"),
      row("a-2", ALICE, "sent"),
      row("a-3", ALICE, "failed"),
      row("a-old", ALICE, "sent", 60),
      row("b-1", BOB, "sent"),
      row("b-2", BOB, "sent"),
      row("b-3", BOB, "sent"),
      row("b-4", BOB, "bounced"),
      row("gone", null, "failed"),
    );
  });

  it("counts only the caller's own mail", async () => {
    const { service } = await loadService();

    const metrics = await service.getEmailMetrics(ALICE, 30);

    expect(metrics).toMatchObject({ totalSent: 2, totalFailed: 1, totalBounced: 0 });
    expect(await service.getEmailMetrics(BOB, 30)).toMatchObject({
      totalSent: 3,
      totalFailed: 0,
      totalBounced: 1,
    });
  });

  it("still counts only the days asked for", async () => {
    const { service } = await loadService();

    expect(await service.getEmailMetrics(ALICE, 90)).toMatchObject({ totalSent: 3 });
    expect(await service.getEmailMetrics(ALICE, 30)).toMatchObject({ totalSent: 2 });
  });

  it("gives the simple counts by status for the caller alone", async () => {
    const { service } = await loadService();

    expect(await service.getEmailStats(ALICE, 30)).toEqual({ sent: 2, failed: 1 });
    expect(await service.getEmailStats(BOB, 30)).toEqual({ sent: 3, bounced: 1 });
  });
});
