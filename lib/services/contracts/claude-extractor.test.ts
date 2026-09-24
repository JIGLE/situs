// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { sampleExtraction } from "@/tests/fixtures/contract-extraction";
import { createClaudeExtractor } from "./claude-extractor";
import { ContractReadError, type ContractReadFailure } from "./extractor";

/**
 * The Claude call, with the SDK stubbed at `beta.messages.stream`. What is pinned here: the request
 * asks for what the plan says (PDFs as documents, the fallback, adaptive thinking, the schema as a
 * format), and every way the answer can go wrong reaches the caller as a reason it can translate.
 */

const pdf = { kind: "contract" as const, bytes: Buffer.from("%PDF-1.7 a contract") };

type Reply = Partial<Anthropic.Beta.Messages.BetaMessage>;

function extractorAnswering(reply: Reply | Error) {
  const stream = vi.fn(() => ({
    finalMessage: () => (reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply)),
  }));
  const client = { beta: { messages: { stream } } } as unknown as Pick<Anthropic, "beta">;
  return {
    extractor: createClaudeExtractor({ apiKey: "sk-test", model: "claude-opus-5", client }),
    stream,
  };
}

const answer = (text: string, stop_reason: Reply["stop_reason"] = "end_turn"): Reply => ({
  stop_reason,
  content: [{ type: "text", text, citations: null }],
});

async function reasonFor(reply: Reply | Error): Promise<ContractReadFailure> {
  const { extractor } = extractorAnswering(reply);
  const error = await extractor.extract([pdf], "pt").catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ContractReadError);
  return (error as ContractReadError).reason;
}

describe("createClaudeExtractor", () => {
  it("sends the PDFs as documents and returns the reading", async () => {
    const { extractor, stream } = extractorAnswering(answer(JSON.stringify(sampleExtraction)));
    const proof = { kind: "registration" as const, bytes: Buffer.from("%PDF-1.7 a proof") };

    await expect(extractor.extract([pdf, proof], "pt")).resolves.toEqual(sampleExtraction);

    const request = (stream.mock.calls[0] as unknown[])[0] as Record<string, unknown> & {
      messages: Array<{ content: Array<Record<string, unknown>> }>;
      output_config: { effort: string; format: Record<string, unknown> };
    };
    expect(request).toMatchObject({
      model: "claude-opus-5",
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
    });
    expect(request.output_config.effort).toBe("high");
    expect(request.output_config.format.type).toBe("json_schema");
    // The parser stays out of the request, so the stop reason is read before anything parses.
    expect(request.output_config.format).not.toHaveProperty("parse");
    const [contract, registration, prompt] = request.messages[0].content;
    expect(contract).toMatchObject({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: pdf.bytes.toString("base64") },
    });
    expect(registration).toMatchObject({ type: "document", title: "AT proof of registration" });
    expect(prompt).toMatchObject({ type: "text" });
    expect(String(prompt.text)).toContain("European Portuguese");
  });

  it("says the model declined when the answer is a refusal", async () => {
    expect(await reasonFor(answer("", "refusal"))).toBe("refused");
  });

  it("says the reading ran long when it stopped at the token limit, before trying to parse it", async () => {
    expect(await reasonFor(answer('{"landlords": [', "max_tokens"))).toBe("too_long");
  });

  it("refuses an answer that is not JSON, or not the schema", async () => {
    expect(await reasonFor(answer("I could not read the contract."))).toBe("unreadable");
    const wrongKind = {
      ...sampleExtraction,
      clauses: [{ kind: "penalty", summary: "x", quote: "y", page: 1 }],
    };
    expect(await reasonFor(answer(JSON.stringify(wrongKind)))).toBe("unreadable");
  });

  it("names each API failure as a reason the sheet can translate", async () => {
    const headers = new Headers();
    expect(
      await reasonFor(new Anthropic.AuthenticationError(401, {}, "invalid x-api-key", headers)),
    ).toBe("rejected");
    expect(await reasonFor(new Anthropic.NotFoundError(404, {}, "model: no-such", headers))).toBe(
      "rejected",
    );
    expect(await reasonFor(new Anthropic.RateLimitError(429, {}, "rate limited", headers))).toBe(
      "busy",
    );
    expect(await reasonFor(new Anthropic.BadRequestError(400, {}, "PDF too large", headers))).toBe(
      "unreadable",
    );
    expect(await reasonFor(new Anthropic.InternalServerError(529, {}, "overloaded", headers))).toBe(
      "unavailable",
    );
    expect(await reasonFor(new Anthropic.APIConnectionError({ message: "fetch failed" }))).toBe(
      "unavailable",
    );
  });
});
