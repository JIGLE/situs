// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

const { prismaMock, ensureConnectorMock, logSubmissionMock, logAuditMock } = vi.hoisted(() => ({
  prismaMock: { taxAuthorityConnector: { findUnique: vi.fn(), update: vi.fn() } },
  ensureConnectorMock: vi.fn(),
  logSubmissionMock: vi.fn(),
  logAuditMock: vi.fn(),
}));
const { readAtConfigMock, checkCredentialsMock, obterReciboMock } = vi.hoisted(() => ({
  readAtConfigMock: vi.fn(),
  checkCredentialsMock: vi.fn(),
  obterReciboMock: vi.fn(),
}));

vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));
vi.mock("@/lib/services/tax/connector-service", () => ({
  ensureConnector: ensureConnectorMock,
  logSubmission: logSubmissionMock,
}));
vi.mock("@/lib/services/audit-log", () => ({ logAudit: logAuditMock }));
vi.mock("@/lib/tax/at/config", () => ({ readAtConfig: readAtConfigMock }));
vi.mock("@/lib/tax/at/client", () => ({
  checkCredentials: checkCredentialsMock,
  obterRecibo: obterReciboMock,
}));

import { AT_ENDPOINTS } from "@/lib/tax/at/transport";
import { decryptPII, encryptPII } from "@/lib/utils/pii-encryption";
import {
  fetchAtReceipt,
  getAtConnection,
  removeAtCredentials,
  runAtCheck,
  saveAtCredentials,
  setAtMode,
} from "./at-connection";

const USER = "user-1";
const LOGIN = { username: "555555555/1", password: "senha-secreta" };
const MATERIAL = { tls: { cert: "cert", key: "key" }, authKey: {} };
const READY = { status: { ready: true, files: {} }, material: MATERIAL };
const NOT_READY = { status: { ready: false, files: {} } };

let connector: { id: string; mode: string; credentialsRef: string | null };
const originalKey = process.env.PII_ENCRYPTION_KEY;

function storedLogin(login = LOGIN): string {
  return encryptPII(JSON.stringify(login));
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PII_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  connector = { id: "conn-1", mode: "review", credentialsRef: null };
  prismaMock.taxAuthorityConnector.findUnique.mockImplementation(async () => connector);
  prismaMock.taxAuthorityConnector.update.mockResolvedValue(undefined);
  ensureConnectorMock.mockImplementation(async () => connector);
  readAtConfigMock.mockReturnValue(READY);
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.PII_ENCRYPTION_KEY;
  else process.env.PII_ENCRYPTION_KEY = originalKey;
});

const refusal = (reason: string) => expect.objectContaining({ name: "ConflictError", reason });

describe("the stored sub-user", () => {
  it("is stored encrypted with the PII key", async () => {
    await saveAtCredentials(USER, LOGIN);

    const { credentialsRef } = prismaMock.taxAuthorityConnector.update.mock.calls[0][0].data;
    expect(credentialsRef).toMatch(/^enc:/);
    expect(credentialsRef).not.toContain(LOGIN.password);
    expect(JSON.parse(decryptPII(credentialsRef))).toEqual(LOGIN);
  });

  it("is refused, not stored in clear, when the instance has no PII key", async () => {
    delete process.env.PII_ENCRYPTION_KEY;

    await expect(saveAtCredentials(USER, LOGIN)).rejects.toEqual(
      refusal("at_credentials_need_key"),
    );
    expect(prismaMock.taxAuthorityConnector.update).not.toHaveBeenCalled();
  });

  it("keeps the stored password when only the username changes", async () => {
    connector.credentialsRef = storedLogin();

    await saveAtCredentials(USER, { username: "555555555/2" });

    const { credentialsRef } = prismaMock.taxAuthorityConnector.update.mock.calls[0][0].data;
    expect(JSON.parse(decryptPII(credentialsRef))).toEqual({
      username: "555555555/2",
      password: LOGIN.password,
    });
  });

  it("needs a password the first time", async () => {
    await expect(saveAtCredentials(USER, { username: LOGIN.username })).rejects.toEqual(
      refusal("at_password_required"),
    );
  });

  it("is shown by username only: the view never carries the password", async () => {
    connector.credentialsRef = storedLogin();

    const view = await getAtConnection(USER);

    expect(view).toMatchObject({
      username: LOGIN.username,
      passwordSet: true,
      credentialsUnreadable: false,
    });
    expect(JSON.stringify(view)).not.toContain(LOGIN.password);
  });

  it("reads as unreadable once the PII key has changed, and must be entered again", async () => {
    connector.credentialsRef = storedLogin();
    process.env.PII_ENCRYPTION_KEY = randomBytes(32).toString("hex");

    expect(await getAtConnection(USER)).toMatchObject({
      username: null,
      passwordSet: false,
      credentialsUnreadable: true,
    });
  });

  it("is audited without the password or the username", async () => {
    await saveAtCredentials(USER, LOGIN);

    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "SET_TAX_CREDENTIALS",
        details: { passwordChanged: true },
      }),
    );
    expect(JSON.stringify(logAuditMock.mock.calls)).not.toMatch(/senha|555555555/);
  });

  it("when removed, takes a connector out of the test mode it can no longer use", async () => {
    connector = { ...connector, mode: "test", credentialsRef: storedLogin() };

    await removeAtCredentials(USER);

    expect(prismaMock.taxAuthorityConnector.update).toHaveBeenCalledWith({
      where: { id: "conn-1" },
      data: { credentialsRef: null, mode: "review" },
    });
  });
});

describe("the test mode", () => {
  it("is refused until the certificate files read", async () => {
    connector.credentialsRef = storedLogin();
    readAtConfigMock.mockReturnValue(NOT_READY);

    await expect(setAtMode(USER, "test")).rejects.toEqual(refusal("at_files_not_ready"));
    expect(prismaMock.taxAuthorityConnector.update).not.toHaveBeenCalled();
  });

  it("is refused until a sub-user is stored", async () => {
    await expect(setAtMode(USER, "test")).rejects.toEqual(refusal("at_credentials_missing"));
  });

  it("is set, and audited, once both are there", async () => {
    connector.credentialsRef = storedLogin();

    await setAtMode(USER, "test");

    expect(prismaMock.taxAuthorityConnector.update).toHaveBeenCalledWith({
      where: { id: "conn-1" },
      data: { mode: "test" },
    });
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "SET_TAX_CONNECTOR_MODE",
        details: { from: "review", to: "test" },
      }),
    );
  });
});

describe("Check credentials", () => {
  beforeEach(() => {
    connector = { ...connector, mode: "test", credentialsRef: storedLogin() };
  });

  it("calls nothing outside the test mode", async () => {
    connector.mode = "review";

    await expect(runAtCheck(USER)).rejects.toEqual(refusal("at_test_mode_required"));
    expect(checkCredentialsMock).not.toHaveBeenCalled();
  });

  it("calls AT's test service, never production, with the stored sub-user", async () => {
    checkCredentialsMock.mockResolvedValue({
      outcome: "answer",
      operation: "obterReciboResponse",
      code: -1,
      category: "rejected",
      message: "Não foi possível obter o recibo",
      errors: [],
    });

    const view = await runAtCheck(USER);

    expect(checkCredentialsMock).toHaveBeenCalledWith({
      endpoint: AT_ENDPOINTS.test,
      login: LOGIN,
      material: MATERIAL,
    });
    expect(view).toEqual({
      outcome: "answer",
      code: -1,
      category: "rejected",
      message: "Não foi possível obter o recibo",
      errors: [],
    });
    expect(logSubmissionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectType: "connector",
        action: "check",
        mode: "test",
        status: "success",
        responseCode: "-1",
      }),
    );
  });

  it("logs a refused password as an error, and shows AT's code rather than the transport's words", async () => {
    checkCredentialsMock.mockResolvedValue({
      outcome: "answer",
      operation: "obterReciboResponse",
      code: 99,
      category: "password",
      message: "Erro na validação da senha",
      errors: [],
    });

    expect(await runAtCheck(USER)).toMatchObject({ code: 99, category: "password" });
    expect(logSubmissionMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error", responseCode: "99" }),
    );
  });

  it("keeps the transport's English reason in the log, out of the screen's answer", async () => {
    checkCredentialsMock.mockResolvedValue({
      outcome: "not_sent",
      reason: "ECONNREFUSED: connect ECONNREFUSED",
    });

    expect(await runAtCheck(USER)).toEqual({ outcome: "not_sent" });
    expect(logSubmissionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        responseCode: "not_sent",
        responseBody: expect.stringMatching(/ECONNREFUSED/),
      }),
    );
  });
});

describe("Fetch receipt", () => {
  beforeEach(() => {
    connector = { ...connector, mode: "test", credentialsRef: storedLogin() };
  });

  it("returns AT's PDF, and records that the owner read it", async () => {
    const pdf = Buffer.from("%PDF-1.4");
    obterReciboMock.mockResolvedValue({
      outcome: "answer",
      operation: "obterReciboResponse",
      code: 0,
      category: "ok",
      message: "OK",
      pdf,
      errors: [],
    });

    const result = await fetchAtReceipt(USER, 123456, 7);

    expect(obterReciboMock).toHaveBeenCalledWith(expect.anything(), 123456, 7);
    expect(result.pdf).toEqual(pdf);
    expect(logSubmissionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectType: "at_receipt",
        subjectId: "123456/7",
        status: "success",
      }),
    );
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "FETCH_AT_RECEIPT" }),
    );
  });

  it("returns AT's answer without a PDF, and records no read, when AT has no such receipt", async () => {
    obterReciboMock.mockResolvedValue({
      outcome: "answer",
      operation: "obterReciboResponse",
      code: -1,
      category: "rejected",
      message: "Não foi possível obter o recibo",
      errors: [],
    });

    const result = await fetchAtReceipt(USER, 1, 1);

    expect(result).toEqual({ call: expect.objectContaining({ code: -1 }) });
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});
