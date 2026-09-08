/** Mirrors ASTRA_PRICE / costUsd in packages/protocol/contract.ts (kept in JS so no TS loader is needed). */
export const ASTRA_PRICE = { input: 10, cachedInput: 1, output: 50 };

export const costUsd = (c) =>
  ((c.inputTokens - c.cachedInputTokens) * ASTRA_PRICE.input
    + c.cachedInputTokens * ASTRA_PRICE.cachedInput
    + c.outputTokens * ASTRA_PRICE.output) / 1_000_000;

export const emptyCost = () => ({ steps: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, usd: 0 });
