import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The AT connection routes: what they accept, and that a refusal reaches the screen with its
 * reason. The service behind them is tested in lib/services/tax/at-connection.test.ts.
 */

const { service, access } = vi.hoisted(() => ({
  service: {
    getAtConnection: vi.fn(),
    saveAtCredentials: vi.fn(),
    removeAtCredentials: vi.fn(),
    setAtMode: vi.fn(),
    runAtCheck: vi.fn(),
    fetchAtReceipt: vi.fn(),
  },
  access: vi.fn(),
}));

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireOwnerAccess: access,
  handleOptions: vi.fn(),
}));
vi.mock("@/lib/services/tax/at-connection", () => service);

import { ConflictError } from "@/lib/utils/error-handling";
import { GET } from "./route";
import { PUT as putCredentials } from "./credentials/route";
import { PUT as putMode } from "./mode/route";
import { POST as postCheck } from "./check/route";
import { POST as postReceipt } from "./receipt/route";

const VIEW = {
  mode: "review",
  username: "555555555/1",
  passwordSet: true,
  credentialsUnreadable: false,
  files: { ready: false, files: {} },
};

const request = (path: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost:3000/api/tax/connectors/at${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  access.mockResolvedValue({ userId: "user-1", scopeUserId: "user-1" });
  service.getAtConnection.mockResolvedValue(VIEW);
});

describe("GET /api/tax/connectors/at", () => {
  it("answers with the connection view, for the caller's own connector", async () => {
    const res = await GET(request("", "GET"));

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual(VIEW);
    expect(service.getAtConnection).toHaveBeenCalledWith("user-1");
  });

  it("reads nothing for a caller the owner check turns away", async () => {
    access.mockResolvedValue(new Response(null, { status: 403 }));

    expect((await GET(request("", "GET"))).status).toBe(403);
    expect(service.getAtConnection).not.toHaveBeenCalled();
  });
});

describe("PUT /api/tax/connectors/at/credentials", () => {
  it("stores a NIF/sub-user login", async () => {
    const res = await putCredentials(
      request("/credentials", "PUT", { username: " 555555555/1 ", password: "x" }),
    );

    expect(res.status).toBe(200);
    expect(service.saveAtCredentials).toHaveBeenCalledWith("user-1", {
      username: "555555555/1",
      password: "x",
    });
  });

  it("refuses a username that is not <NIF>/<sub-user>, as a 400", async () => {
    for (const username of ["555555555", "55555555/1", "555555555/12345", "a/1"]) {
      const res = await putCredentials(request("/credentials", "PUT", { username, password: "x" }));
      expect(res.status).toBe(400);
    }
    expect(service.saveAtCredentials).not.toHaveBeenCalled();
  });

  it("passes the service's refusal on with its reason, so the screen can say why", async () => {
    service.saveAtCredentials.mockRejectedValue(
      new ConflictError("no key", "at_credentials_need_key"),
    );

    const res = await putCredentials(
      request("/credentials", "PUT", { username: "555555555/1", password: "x" }),
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "at_credentials_need_key" });
  });
});

describe("PUT /api/tax/connectors/at/mode", () => {
  it("takes sandbox, review and test", async () => {
    for (const mode of ["sandbox", "review", "test"]) {
      expect((await putMode(request("/mode", "PUT", { mode }))).status).toBe(200);
    }
    expect(service.setAtMode).toHaveBeenCalledTimes(3);
  });

  it("refuses live: going live is a code change, not a choice on this screen", async () => {
    for (const mode of ["live", "production", "Test"]) {
      expect((await putMode(request("/mode", "PUT", { mode }))).status).toBe(400);
    }
    expect(service.setAtMode).not.toHaveBeenCalled();
  });
});

describe("POST /api/tax/connectors/at/check", () => {
  it("answers with AT's answer, a refused password included, as a 200", async () => {
    const answer = { outcome: "answer", code: 99, category: "password", message: "", errors: [] };
    service.runAtCheck.mockResolvedValue(answer);

    const res = await postCheck(request("/check", "POST"));

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual(answer);
  });
});

describe("POST /api/tax/connectors/at/receipt", () => {
  it("returns the PDF as Base64 beside AT's answer", async () => {
    service.fetchAtReceipt.mockResolvedValue({
      call: { outcome: "answer", code: 0, category: "ok", message: "OK", errors: [] },
      pdf: Buffer.from("%PDF-1.4"),
    });

    const res = await postReceipt(
      request("/receipt", "POST", { contractNumber: 123456, receiptNumber: 7 }),
    );

    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(Buffer.from(data.pdf, "base64").toString()).toBe("%PDF-1.4");
    expect(service.fetchAtReceipt).toHaveBeenCalledWith("user-1", 123456, 7);
  });

  it("refuses numbers that are not whole and non-negative", async () => {
    for (const body of [
      { contractNumber: -1, receiptNumber: 1 },
      { contractNumber: 1.5, receiptNumber: 1 },
      { contractNumber: "1", receiptNumber: 1 },
      { contractNumber: 1 },
    ]) {
      expect((await postReceipt(request("/receipt", "POST", body))).status).toBe(400);
    }
    expect(service.fetchAtReceipt).not.toHaveBeenCalled();
  });
});
