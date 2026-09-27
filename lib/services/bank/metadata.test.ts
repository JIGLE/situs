import { describe, expect, it } from "vitest";
import { isTestConnection, providerAccountRef, readMetadata, writeMetadata } from "./metadata";

describe("connection metadata", () => {
  it("reads nothing, unreadable text and a non-object alike as empty", () => {
    expect(readMetadata(null)).toEqual({});
    expect(readMetadata("not json")).toEqual({});
    expect(readMetadata("[1,2]")).toEqual({});
    expect(readMetadata('"text"')).toEqual({});
  });

  it("round-trips what it writes", () => {
    const metadata = {
      isTest: true,
      institutionId: "FAKEBANK_PT",
      accountRefs: { "acct-1": "remote-1" },
    };
    expect(readMetadata(writeMetadata(metadata))).toEqual(metadata);
  });

  it("finds the test marker and an account's provider id", () => {
    const raw = writeMetadata({ isTest: true, accountRefs: { "acct-1": "remote-1" } });

    expect(isTestConnection(raw)).toBe(true);
    expect(isTestConnection(writeMetadata({}))).toBe(false);
    expect(providerAccountRef(raw, "acct-1")).toBe("remote-1");
    expect(providerAccountRef(raw, "acct-2")).toBeNull();
    expect(providerAccountRef(null, "acct-1")).toBeNull();
  });
});
