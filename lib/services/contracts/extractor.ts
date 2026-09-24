import type { ContractExtraction } from "./schema";

/**
 * Whatever reads a lease contract. One implementation today, Claude (claude-extractor.ts); the
 * routes and the import only know this interface, the way the bank layer only knows its provider
 * contract (lib/services/bank/providers/).
 */

/** A PDF sent to be read: the signed contract, or AT's proof of its registration. */
export interface ContractDocument {
  kind: "contract" | "registration";
  bytes: Buffer;
}

export interface ContractExtractor {
  /** The model that reads, named in the audit row each reading writes. */
  readonly model: string;
  /** `language` is the app's locale: the clause summaries are written in it. */
  extract(documents: ContractDocument[], language: string): Promise<ContractExtraction>;
}

/**
 * Why a reading failed, as a code the review sheet translates. Nothing the vendor wrote in
 * English reaches the screen.
 */
export type ContractReadFailure =
  | "refused" // the model declined, and so did its fallback
  | "too_long" // the answer ran past its token limit
  | "unreadable" // the documents could not be read, or the answer was not a valid reading
  | "rejected" // the API key, or the configured model, was not accepted
  | "busy" // rate limited
  | "unavailable"; // anything else between here and the API

export class ContractReadError extends Error {
  constructor(
    readonly reason: ContractReadFailure,
    message: string,
  ) {
    super(message);
    this.name = "ContractReadError";
  }
}

export const DEFAULT_CONTRACT_MODEL = "claude-opus-5";

/** Configured or not, from the environment alone: an Anthropic API key. */
export function contractReaderConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export function contractReaderModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_CONTRACT_MODEL;
}

/** The configured reader, or null. Loaded lazily, so an instance without a key never loads the SDK. */
export async function getContractExtractor(): Promise<ContractExtractor | null> {
  if (!contractReaderConfigured()) return null;
  const { createClaudeExtractor } = await import("./claude-extractor");
  return createClaudeExtractor({
    apiKey: process.env.ANTHROPIC_API_KEY!.trim(),
    model: contractReaderModel(),
  });
}
