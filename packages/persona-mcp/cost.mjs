/**
 * gpt-6-astra pricing. A JS port of `ASTRA_PRICE` / `costUsd` in
 * packages/protocol/contract.ts — kept here so the runner needs no TS build
 * step. If the contract changes, change this too.
 */
export const ASTRA_PRICE = { input: 10, cachedInput: 1, output: 50 }; // per million tokens

export const costUsd = (c) =>
  ((c.inputTokens - c.cachedInputTokens) * ASTRA_PRICE.input
    + c.cachedInputTokens * ASTRA_PRICE.cachedInput
    + c.outputTokens * ASTRA_PRICE.output) / 1_000_000;
