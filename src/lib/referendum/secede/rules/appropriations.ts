import type { FederalBudget } from "@/lib/db/types/budget";
/** Free account cash is divisible; contracts and their earmarked money stay with the UK. */
export function splitConversionAppropriations(
  source: Pick<FederalBudget, "defenseAppropriation" | "intelligenceAppropriation">,
  weight: number,
  turn: number
) {
  if (!(weight > 0 && weight < 1) || !Number.isSafeInteger(turn) || turn < 0)
    throw new Error("Invalid appropriation conversion");
  const defense = source.defenseAppropriation;
  const defenseMoved = defense
    ? Math.max(0, defense.balance - (defense.encumbered ?? 0)) * weight
    : 0;
  const intelligence = source.intelligenceAppropriation;
  const intelligenceMoved = intelligence ? Math.max(0, intelligence.balance) * weight : 0;
  return {
    moved: {
      defenseAppropriation: {
        balance: defenseMoved,
        encumbered: 0,
        arrearsRatio: 0,
        accruedThroughTurn: defense?.accruedThroughTurn ?? turn,
      },
      intelligenceAppropriation: {
        balance: intelligenceMoved,
        accruedThroughTurn: intelligence?.accruedThroughTurn ?? turn,
      },
    },
    kept: {
      ...(defense
        ? { defenseAppropriation: { ...defense, balance: defense.balance - defenseMoved } }
        : {}),
      ...(intelligence
        ? {
            intelligenceAppropriation: {
              ...intelligence,
              balance: intelligence.balance - intelligenceMoved,
            },
          }
        : {}),
    },
  };
}
