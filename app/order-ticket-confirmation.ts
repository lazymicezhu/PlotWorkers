import type { OrderState } from "./game-engine.ts";

/** Countdown ticks keep a confirmation valid; replacements must be confirmed again. */
export function isGoldenOrderConfirmationCurrent(expected: OrderState, current: OrderState | undefined): boolean {
  return !!current
    && current.remaining > 0
    && current.id === expected.id
    && current.processed.kind === expected.processed.kind
    && current.processed.amount === expected.processed.amount
    && current.synthesized.kind === expected.synthesized.kind
    && current.synthesized.amount === expected.synthesized.amount
    && current.reward === expected.reward
    && !!current.rerolled === !!expected.rerolled;
}
