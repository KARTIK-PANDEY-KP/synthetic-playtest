/** Local copy of the pricing in packages/protocol/contract.ts (no TS build step here). */
export const ASTRA_PRICE = { input: 10, cachedInput: 1, output: 50 };
export const costUsd = (c) =>
  ((c.inputTokens - c.cachedInputTokens) * ASTRA_PRICE.input
    + c.cachedInputTokens * ASTRA_PRICE.cachedInput
    + c.outputTokens * ASTRA_PRICE.output) / 1_000_000;

/** Sum a persona's `usage` session lines into a CostSummary. */
export function costFromSession(session, steps) {
  const c = { steps, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
  for (const e of session) if (e.kind === 'usage') { c.inputTokens += e.input ?? 0; c.cachedInputTokens += e.cached ?? 0; c.outputTokens += e.output ?? 0; }
  return { ...c, usd: +costUsd(c).toFixed(4) };
}
