import type { AttentionWeight } from "@/lib/services/attention/rules";

/**
 * The `completion.weight` entry that says why an item matters, for each weight. A record rather
 * than a template literal, so a weight added to the list has to be given its words here before the
 * screen compiles, and cannot pass for the first one.
 */
export const ATTENTION_WEIGHT_KEY = {
  blocks_receipt: "weight.blocksReceipt",
  reminders: "weight.reminders",
  nice_to_have: "weight.niceToHave",
} as const satisfies Record<AttentionWeight, `weight.${string}`>;
