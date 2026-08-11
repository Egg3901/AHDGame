import type { EventEffect, OutcomeNewsWire, OutcomeTier } from "@/lib/db/types/events";

/**
 * Optional per-tier National Wire Service posts. Attach only to the genuinely
 * notable tiers (record fines, scandals, viral moments) — most tiers omit this.
 */
export interface TierWires {
  high?: OutcomeNewsWire;
  mid?: OutcomeNewsWire;
  low?: OutcomeNewsWire;
}

export function threeTierTable(
  highLabel: string,
  midLabel: string,
  lowLabel: string,
  high: EventEffect[],
  mid: EventEffect[],
  low: EventEffect[],
  wires?: TierWires
): OutcomeTier[] {
  return [
    {
      minRoll: 80,
      maxRoll: 100,
      label: highLabel,
      effects: high,
      ...(wires?.high ? { newsWire: wires.high } : {}),
    },
    {
      minRoll: 40,
      maxRoll: 79,
      label: midLabel,
      effects: mid,
      ...(wires?.mid ? { newsWire: wires.mid } : {}),
    },
    {
      minRoll: 1,
      maxRoll: 39,
      label: lowLabel,
      effects: low,
      ...(wires?.low ? { newsWire: wires.low } : {}),
    },
  ];
}
