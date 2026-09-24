import { describe, expect, it } from "vitest";

import {
  ARCHIVE_ON_STATES,
  TERMINAL_STATES,
  canTransition,
  evaluateTransition,
  isValidState,
  nextStates,
} from "./lifecycle";

describe("isValidState", () => {
  it("accepts every known lifecycle state", () => {
    for (const s of ["draft", "review", "emitted", "submitted", "accepted", "rejected", "voided"]) {
      expect(isValidState(s)).toBe(true);
    }
  });

  it("rejects unknown strings", () => {
    expect(isValidState("published")).toBe(false);
    expect(isValidState("")).toBe(false);
  });
});

describe("canTransition — the documented state machine", () => {
  it("draft can move to review, emitted, or voided", () => {
    expect(canTransition("draft", "review")).toBe(true);
    expect(canTransition("draft", "emitted")).toBe(true);
    expect(canTransition("draft", "voided")).toBe(true);
    expect(canTransition("draft", "submitted")).toBe(false);
    expect(canTransition("draft", "accepted")).toBe(false);
  });

  it("review can move to draft, emitted, or voided", () => {
    expect(canTransition("review", "emitted")).toBe(true);
    expect(canTransition("review", "draft")).toBe(true);
    expect(canTransition("review", "voided")).toBe(true);
  });

  it("emitted can move to submitted or voided", () => {
    expect(canTransition("emitted", "submitted")).toBe(true);
    expect(canTransition("emitted", "voided")).toBe(true);
    expect(canTransition("emitted", "accepted")).toBe(false);
  });

  it("submitted can only resolve to accepted or rejected", () => {
    expect(canTransition("submitted", "accepted")).toBe(true);
    expect(canTransition("submitted", "rejected")).toBe(true);
    expect(canTransition("submitted", "voided")).toBe(false);
    expect(canTransition("submitted", "emitted")).toBe(false);
  });

  it("rejected can only return to review (fix and resubmit)", () => {
    expect(canTransition("rejected", "review")).toBe(true);
    expect(canTransition("rejected", "emitted")).toBe(false);
    expect(canTransition("rejected", "voided")).toBe(false);
  });

  it("accepted and voided are terminal — no outbound transitions", () => {
    expect(nextStates("accepted")).toEqual([]);
    expect(nextStates("voided")).toEqual([]);
  });
});

describe("evaluateTransition", () => {
  it("flags archive as triggered entering emitted or accepted", () => {
    expect(evaluateTransition("review", "emitted")).toEqual({
      allowed: true,
      archiveTriggered: true,
    });
    expect(evaluateTransition("submitted", "accepted")).toEqual({
      allowed: true,
      archiveTriggered: true,
    });
  });

  it("does not trigger archive for non-archive states", () => {
    expect(evaluateTransition("draft", "review").archiveTriggered).toBe(false);
    expect(evaluateTransition("submitted", "rejected").archiveTriggered).toBe(false);
  });

  it("rejects an unknown current state with a reason", () => {
    const result = evaluateTransition("bogus", "review");
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/Unknown current state/);
  });

  it("rejects a disallowed transition with a reason", () => {
    const result = evaluateTransition("draft", "accepted");
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/Cannot move/);
  });
});

describe("ARCHIVE_ON_STATES / TERMINAL_STATES", () => {
  it("archive triggers exactly on emitted and accepted", () => {
    expect([...ARCHIVE_ON_STATES].sort()).toEqual(["accepted", "emitted"]);
  });

  it("terminal states are exactly accepted and voided", () => {
    expect([...TERMINAL_STATES].sort()).toEqual(["accepted", "voided"]);
  });
});
