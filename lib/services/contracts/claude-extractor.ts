import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { contractExtractionSchema, type ContractExtraction } from "./schema";
import { ContractReadError, type ContractDocument, type ContractExtractor } from "./extractor";

/**
 * Claude reads a lease contract.
 *
 * - Structured output: the answer is held to `contractExtractionSchema` by the API, and checked
 *   against it again here before anything uses it.
 * - Streamed, and read with `finalMessage()`: a long contract read with thinking can outlast a
 *   single unstreamed request.
 * - `fallbacks: "default"`: if the model's safety classifiers decline a document, the API
 *   re-runs it on the recommended fallback model rather than returning the refusal.
 * - The format goes over the wire without its parser, so the answer is parsed only after the
 *   stop reason says there is a whole one: a refusal and a truncated answer are told apart, not
 *   both reported as bad JSON.
 */

/** Room for the thinking and the answer together: max_tokens caps both. */
const MAX_TOKENS = 32_000;

const LANGUAGE_NAMES: Record<string, string> = {
  pt: "European Portuguese",
  en: "English",
  es: "Spanish",
  it: "Italian",
};

const SYSTEM = [
  "You read Portuguese residential lease contracts (contratos de arrendamento) for the landlord",
  "who signed them, so their property records can be filled in. The landlord reviews everything",
  "you return before anything is saved.",
  "",
  "Take every value from the documents. When they do not state something, answer null: an empty",
  "field the landlord fills in is better than a plausible guess they might not notice. For each",
  "value you give, quote the documents' own words and the page they are on.",
].join("\n");

function instructions(documents: ContractDocument[], language: string): string {
  const withProof = documents.some((document) => document.kind === "registration");
  return [
    withProof
      ? "Above are a lease contract and AT's proof of its registration."
      : "Above is a lease contract.",
    "Read out its parties, the property, its terms and its clauses on renewal, rent updates,",
    "termination and notice, and the deposit.",
    `Write each clause summary in ${LANGUAGE_NAMES[language] ?? "English"}.`,
  ].join(" ");
}

function documentBlock(
  document: ContractDocument,
): Anthropic.Beta.Messages.BetaRequestDocumentBlock {
  return {
    type: "document",
    title: document.kind === "contract" ? "Lease contract" : "AT proof of registration",
    source: {
      type: "base64",
      media_type: "application/pdf",
      data: document.bytes.toString("base64"),
    },
  };
}

/** The vendor's errors, as reasons the sheet can say in the owner's language. */
function readError(error: unknown): ContractReadError {
  const detail = error instanceof Error ? error.message : String(error);
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError ||
    error instanceof Anthropic.NotFoundError
  ) {
    return new ContractReadError("rejected", `Anthropic refused the key or model: ${detail}`);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new ContractReadError("busy", `Anthropic rate limit: ${detail}`);
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new ContractReadError("unreadable", `Anthropic could not take the documents: ${detail}`);
  }
  return new ContractReadError("unavailable", `Anthropic request failed: ${detail}`);
}

export function createClaudeExtractor(options: {
  apiKey: string;
  model: string;
  /** For tests: a client with a stubbed `beta.messages.stream`. */
  client?: Pick<Anthropic, "beta">;
}): ContractExtractor {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });
  const { type, schema } = betaZodOutputFormat(contractExtractionSchema);

  return {
    model: options.model,

    async extract(documents, language): Promise<ContractExtraction> {
      let message: Anthropic.Beta.Messages.BetaMessage;
      try {
        message = await client.beta.messages
          .stream({
            model: options.model,
            max_tokens: MAX_TOKENS,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            thinking: { type: "adaptive" },
            output_config: { effort: "high", format: { type, schema } },
            system: SYSTEM,
            messages: [
              {
                role: "user",
                content: [
                  ...documents.map(documentBlock),
                  { type: "text", text: instructions(documents, language) },
                ],
              },
            ],
          })
          .finalMessage();
      } catch (error) {
        throw readError(error);
      }

      if (message.stop_reason === "refusal") {
        throw new ContractReadError(
          "refused",
          "The model and its fallback declined to read the documents",
        );
      }
      if (message.stop_reason === "max_tokens") {
        throw new ContractReadError("too_long", `The reading ran past ${MAX_TOKENS} tokens`);
      }

      const text = message.content.find((block) => block.type === "text")?.text;
      let json: unknown;
      try {
        json = JSON.parse(text ?? "");
      } catch {
        throw new ContractReadError("unreadable", "The reading was not JSON");
      }
      const parsed = contractExtractionSchema.safeParse(json);
      if (!parsed.success) {
        throw new ContractReadError(
          "unreadable",
          `The reading did not match the schema: ${parsed.error.message}`,
        );
      }
      return parsed.data;
    },
  };
}
