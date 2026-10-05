/** Opening national readiness from the actual seeded force roster. */
export interface ForceReadinessInput {
  basePower: number;
  readiness: number;
  integrity?: number | null;
  supply?: number | null;
  readyAtTurn?: number | null;
}

export function nationalForceReadiness(
  units: readonly ForceReadinessInput[],
  turn: number
): number | null {
  if (!Number.isSafeInteger(turn) || turn < 0) throw new Error("invalid turn");
  let weightedReadiness = 0;
  let totalPower = 0;
  for (const unit of units) {
    if (
      !Number.isFinite(unit.basePower) ||
      unit.basePower <= 0 ||
      !Number.isFinite(unit.readiness) ||
      unit.readiness < 0 ||
      unit.readiness > 100
    ) {
      throw new Error("invalid seeded force unit");
    }
    const integrity = unit.integrity ?? 100;
    const supply = unit.supply ?? 100;
    if (
      !Number.isFinite(integrity) ||
      integrity < 0 ||
      integrity > 100 ||
      !Number.isFinite(supply) ||
      supply < 0 ||
      supply > 100
    ) {
      throw new Error("invalid force condition");
    }
    if (
      unit.readyAtTurn != null &&
      (!Number.isSafeInteger(unit.readyAtTurn) || unit.readyAtTurn < 0)
    ) {
      throw new Error("invalid force readiness date");
    }
    const operational = unit.readyAtTurn == null || unit.readyAtTurn <= turn;
    const effective = operational ? unit.readiness * (integrity / 100) * (supply / 100) : 0;
    weightedReadiness += unit.basePower * effective;
    totalPower += unit.basePower;
  }
  return totalPower > 0 ? weightedReadiness / totalPower : null;
}
