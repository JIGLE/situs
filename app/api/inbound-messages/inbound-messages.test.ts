import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { requireAuthMock, prismaMock, logAuditMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  prismaMock: {
    inboundMessage: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    tenant: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  },
  logAuditMock: vi.fn(),
}));

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireAuth: requireAuthMock,
  handleOptions: vi.fn(),
}));
vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));
vi.mock("@/lib/services/audit-log", () => ({ logAudit: logAuditMock }));

import { GET as listGET } from "./route";
import { GET as detailGET, PUT as detailPUT } from "./[id]/route";

const listRequest = (qs = "") => new NextRequest(`http://localhost:3000/api/inbound-messages${qs}`);

const getRequest = () => new NextRequest("http://localhost:3000/api/inbound-messages/msg-1");

const putRequest = (body: unknown) =>
  new NextRequest("http://localhost:3000/api/inbound-messages/msg-1", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

const context = { params: { id: "msg-1" } };

const BASE_MESSAGE = {
  id: "msg-1",
  userId: "user-123",
  fromAddress: "maria@example.com",
  fromName: "Maria Silva",
  toAddress: "reply@example.com",
  subject: "Fuga de água",
  textBody: "Há uma fuga na cozinha.",
  receivedAt: new Date("2026-07-01T10:00:00Z"),
  read: false,
  archived: false,
  spfResult: "pass",
  dkimResult: null,
  suggestedTenantId: null,
  tenantId: null,
  propertyId: null,
  tenant: null,
  property: null,
  attachments: [],
  _count: { attachments: 0 },
};

describe("GET /api/inbound-messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue({ userId: "user-123" });
    prismaMock.inboundMessage.findMany.mockResolvedValue([BASE_MESSAGE]);
    prismaMock.inboundMessage.count.mockResolvedValue(1);
    prismaMock.tenant.findMany.mockResolvedValue([]);
  });

  it("lists the caller's unarchived messages by default", async () => {
    const res = await listGET(listRequest());

    expect(res.status).toBe(200);
    expect(prismaMock.inboundMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "user-123", archived: false }),
      }),
    );
    const body = await res.json();
    expect(body.data.messages).toHaveLength(1);
    expect(body.data.messages[0].snippet).toBe("Há uma fuga na cozinha.");
  });

  it("filters to unread when asked", async () => {
    await listGET(listRequest("?unread=true"));

    expect(prismaMock.inboundMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ read: false }) }),
    );
  });

  it("resolves a suggested tenant's name via a separate lookup, not a Prisma include", async () => {
    prismaMock.inboundMessage.findMany.mockResolvedValue([
      { ...BASE_MESSAGE, suggestedTenantId: "tenant-9" },
    ]);
    prismaMock.tenant.findMany.mockResolvedValue([{ id: "tenant-9", name: "Ana Costa" }]);

    const res = await listGET(listRequest());
    const body = await res.json();

    expect(body.data.messages[0].suggestedTenantName).toBe("Ana Costa");
    expect(prismaMock.tenant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { in: ["tenant-9"] } }) }),
    );
  });
});

describe("GET /api/inbound-messages/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue({ userId: "user-123" });
  });

  it("404s for a message belonging to someone else", async () => {
    prismaMock.inboundMessage.findFirst.mockResolvedValue(null);

    const res = await detailGET(getRequest(), context);

    expect(res.status).toBe(404);
  });

  it("returns the full message with its attachments", async () => {
    prismaMock.inboundMessage.findFirst.mockResolvedValue({
      ...BASE_MESSAGE,
      attachments: [
        {
          id: "att-1",
          filename: "leak.jpg",
          mimeType: "image/jpeg",
          fileSize: 1024,
          documentId: null,
        },
      ],
    });

    const res = await detailGET(getRequest(), context);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.textBody).toBe("Há uma fuga na cozinha.");
    expect(body.data.attachments).toHaveLength(1);
  });
});

describe("PUT /api/inbound-messages/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue({ userId: "user-123" });
    prismaMock.inboundMessage.findFirst.mockResolvedValue({ id: "msg-1", tenantId: null });
    prismaMock.inboundMessage.update.mockResolvedValue({
      id: "msg-1",
      tenantId: "tenant-9",
      propertyId: "prop-1",
      archived: false,
      read: false,
    });
  });

  it("still 404s for a message belonging to someone else", async () => {
    prismaMock.inboundMessage.findFirst.mockResolvedValue(null);

    const res = await detailPUT(putRequest({ archived: true }), context);

    expect(res.status).toBe(404);
    expect(prismaMock.inboundMessage.update).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed body rather than 500", async () => {
    const res = await detailPUT(putRequest({ tenantId: 123 }), context);

    expect(res.status).toBe(400);
    expect(prismaMock.inboundMessage.update).not.toHaveBeenCalled();
  });

  it("404s when confirming a tenant that is not the caller's own", async () => {
    // assertOwnsRelations' own findFirst — no row means "not owned".
    prismaMock.tenant.findFirst.mockResolvedValue(null);

    const res = await detailPUT(putRequest({ tenantId: "someone-elses-tenant" }), context);

    expect(res.status).toBe(404);
    expect(prismaMock.inboundMessage.update).not.toHaveBeenCalled();
  });

  it("confirms a tenant link, carries the property along, and logs the human decision", async () => {
    prismaMock.tenant.findFirst.mockResolvedValue({ id: "tenant-9", propertyId: "prop-1" });

    const res = await detailPUT(putRequest({ tenantId: "tenant-9" }), context);

    expect(res.status).toBe(200);
    expect(prismaMock.inboundMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tenantId: "tenant-9", propertyId: "prop-1" }),
      }),
    );
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-123",
        action: "LINK_INBOUND_MESSAGE",
        resourceId: "msg-1",
      }),
    );
  });

  it("clears both tenantId and propertyId when unlinking", async () => {
    prismaMock.inboundMessage.findFirst.mockResolvedValue({ id: "msg-1", tenantId: "tenant-9" });

    await detailPUT(putRequest({ tenantId: null }), context);

    expect(prismaMock.inboundMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tenantId: null, propertyId: null }),
      }),
    );
  });

  it("archives without touching the tenant link or writing an audit entry", async () => {
    await detailPUT(putRequest({ archived: true }), context);

    expect(prismaMock.inboundMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { archived: true } }),
    );
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});
