/** 240-turn rules-core stress fixture, not a historical or full-world forecast. */
import { getCabinetPositions } from "../../src/lib/constants/cabinetMechanics";
import { isSeatActive } from "../../src/lib/cabinet/rosterEra";
import { resetCabinetActions } from "../../src/lib/resetCabinet/catalog";
import {
  actionEligibility,
  activateAction,
  combineActiveActionEffects,
  rechargeActionCharges,
  type ActiveCabinetAction,
} from "../../src/lib/resetCabinet/rules/actions";

export interface ResetActionStressResult {
  turns: number;
  active1991Seats: number;
  activations: number;
  peakSimultaneousActions: number;
  peakSameTargetEffect: number;
  operatingCostShareOfCombinedAnnualGdp: number;
  blocked: Record<string, number>;
}

export function runResetActionStress(useActions = true): ResetActionStressResult {
  const turns = 240;
  const annualNationalGdp = 1_000_000_000_000;
  const seats = resetCabinetActions
    .map((action) => ({ country: action.country, seatId: action.seatId }))
    .filter(
      (seat, index, all) =>
        all.findIndex(
          (candidate) => candidate.country === seat.country && candidate.seatId === seat.seatId
        ) === index
    )
    .filter((seat) => {
      const rosterSeat = getCabinetPositions(seat.country).find(
        (position) => position.id === seat.seatId
      );
      return rosterSeat !== undefined && isSeatActive(rosterSeat, 1991);
    });
  const charges = new Map(
    seats.map((seat) => [`${seat.country}:${seat.seatId}`, { count: 4, lastTurn: 0 }])
  );
  const active: ActiveCabinetAction[] = [];
  const history: ActiveCabinetAction[] = [];
  const blocked: Record<string, number> = {};
  let activations = 0;
  let peakSimultaneousActions = 0;
  let peakSameTargetEffect = 0;
  let operatingCost = 0;

  for (let turn = 0; turn < turns; turn += 1) {
    for (let index = active.length - 1; index >= 0; index -= 1) {
      if (active[index].expiresTurn <= turn) active.splice(index, 1);
    }
    if (useActions && turn % 24 === 0) {
      for (const seat of seats) {
        const key = `${seat.country}:${seat.seatId}`;
        const pool = charges.get(key)!;
        const refilled = rechargeActionCharges(pool.count, pool.lastTurn, turn);
        pool.count = refilled.charges;
        pool.lastTurn = refilled.lastRechargeTurn;
        const choices = resetCabinetActions.filter(
          (action) => action.country === seat.country && action.seatId === seat.seatId
        );
        const action = choices[(turn / 24) % choices.length];
        const eligibility = actionEligibility({
          action,
          turn,
          seatActive: true,
          legalAuthority: true,
          capacityAvailable: true,
          charges: pool.count,
          annualNationalGdp,
          flexibleOperatingFunds: annualNationalGdp,
          active,
          history,
        });
        if (!eligibility.allowed) {
          const reason = eligibility.reason ?? "unknown";
          blocked[reason] = (blocked[reason] ?? 0) + 1;
          continue;
        }
        const instance = activateAction(action, turn);
        active.push(instance);
        history.push(instance);
        pool.count -= 1;
        activations += 1;
        operatingCost += eligibility.operatingCost;
      }
    }
    peakSimultaneousActions = Math.max(peakSimultaneousActions, active.length);
    for (const effect of combineActiveActionEffects(active, turn)) {
      peakSameTargetEffect = Math.max(peakSameTargetEffect, effect.favorableNormalizedPoints);
    }
  }

  return {
    turns,
    active1991Seats: seats.length,
    activations,
    peakSimultaneousActions,
    peakSameTargetEffect,
    operatingCostShareOfCombinedAnnualGdp: operatingCost / (annualNationalGdp * 3),
    blocked,
  };
}

if (process.argv[1]?.endsWith("resetCabinetActions2026-09-29.ts")) {
  process.stdout.write(
    `${JSON.stringify({ noActions: runResetActionStress(false), aggressiveActions: runResetActionStress(true) }, null, 2)}\n`
  );
}
