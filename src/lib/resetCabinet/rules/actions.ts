/** Portable reset Cabinet action lifecycle; no clock, database, or global action cap. */
import type { ResetCabinetAction } from "../catalog";

export interface ActiveCabinetAction {
  actionId: string;
  country: ResetCabinetAction["country"];
  seatId: string;
  scope: ResetCabinetAction["scope"];
  target: string;
  strength: number;
  startsTurn: number;
  expiresTurn: number;
}

export interface ActionUseHistory {
  country: ResetCabinetAction["country"];
  seatId: string;
  scope: ResetCabinetAction["scope"];
  target: string;
  expiresTurn: number;
}

export interface ActionEligibilityInput {
  action: ResetCabinetAction;
  turn: number;
  seatActive: boolean;
  legalAuthority: boolean;
  capacityAvailable: boolean;
  charges: number;
  annualNationalGdp: number;
  flexibleOperatingFunds: number;
  active: readonly ActiveCabinetAction[];
  history: readonly ActionUseHistory[];
}

export type ActionBlockReason =
  | "inactive_seat"
  | "no_authority"
  | "no_capacity"
  | "no_charges"
  | "insufficient_funds"
  | "seat_busy"
  | "cooldown";

export interface ActionEligibility {
  allowed: boolean;
  reason?: ActionBlockReason;
  operatingCost: number;
  durationTurns: number;
  expiresTurn: number;
}

const targetIds = (target: string): string[] => target.split("+");

/** The actor owns charges; a UK character holding two offices shares this pool. */
export function rechargeActionCharges(
  charges: number,
  lastRechargeTurn: number,
  turn: number
): { charges: number; lastRechargeTurn: number; nextRechargeTurn: number | null } {
  if (
    !Number.isInteger(charges) ||
    charges < 0 ||
    charges > 4 ||
    !Number.isInteger(lastRechargeTurn) ||
    lastRechargeTurn < 0 ||
    !Number.isInteger(turn) ||
    turn < lastRechargeTurn
  ) {
    throw new Error("invalid action charge state");
  }
  const intervals = Math.floor((turn - lastRechargeTurn) / 24);
  const nextCharges = Math.min(4, charges + intervals);
  const refreshedTurn = lastRechargeTurn + intervals * 24;
  return {
    charges: nextCharges,
    lastRechargeTurn: refreshedTurn,
    nextRechargeTurn: nextCharges === 4 ? null : refreshedTurn + 24,
  };
}

export function actionDuration(action: ResetCabinetAction): number {
  return action.costClass === "Staff" ? 12 : 24;
}

export function actionOperatingCost(action: ResetCabinetAction, annualNationalGdp: number): number {
  if (!Number.isFinite(annualNationalGdp) || annualNationalGdp < 0) {
    throw new Error("annual national GDP must be nonnegative and finite");
  }
  const share = action.costClass === "Surge" ? 0.00003 : action.costClass === "Ops" ? 0.00001 : 0;
  return Math.round(annualNationalGdp * share);
}

export function actionEligibility(input: ActionEligibilityInput): ActionEligibility {
  const { action, turn } = input;
  if (!Number.isInteger(turn) || turn < 0) throw new Error("turn must be a nonnegative integer");
  if (!Number.isFinite(input.flexibleOperatingFunds) || input.flexibleOperatingFunds < 0) {
    throw new Error("flexible operating funds must be nonnegative and finite");
  }
  const operatingCost = actionOperatingCost(action, input.annualNationalGdp);
  const durationTurns = actionDuration(action);
  const base = { operatingCost, durationTurns, expiresTurn: turn + durationTurns };
  if (!input.seatActive) return { ...base, allowed: false, reason: "inactive_seat" };
  if (!input.legalAuthority) return { ...base, allowed: false, reason: "no_authority" };
  if (!input.capacityAvailable) return { ...base, allowed: false, reason: "no_capacity" };
  if (!Number.isInteger(input.charges) || input.charges < 0 || input.charges > 4) {
    throw new Error("action charges must be between zero and four");
  }
  if (input.charges === 0) {
    return { ...base, allowed: false, reason: "no_charges" };
  }
  if (operatingCost > input.flexibleOperatingFunds) {
    return { ...base, allowed: false, reason: "insufficient_funds" };
  }
  if (
    input.active.some(
      (active) =>
        active.country === action.country &&
        active.seatId === action.seatId &&
        active.expiresTurn > turn
    )
  ) {
    return { ...base, allowed: false, reason: "seat_busy" };
  }
  const targets = targetIds(action.target);
  if (
    input.history.some(
      (prior) =>
        prior.country === action.country &&
        prior.seatId === action.seatId &&
        prior.scope === action.scope &&
        prior.expiresTurn + 24 > turn &&
        targetIds(prior.target).some((target) => targets.includes(target))
    )
  ) {
    return { ...base, allowed: false, reason: "cooldown" };
  }
  return { ...base, allowed: true };
}

export function activateAction(action: ResetCabinetAction, turn: number): ActiveCabinetAction {
  if (!Number.isInteger(turn) || turn < 0) throw new Error("turn must be a nonnegative integer");
  if (!Number.isFinite(action.strength) || action.strength < 0 || action.strength > 0.2) {
    throw new Error("action strength must be between zero and 0.2");
  }
  return {
    actionId: action.id,
    country: action.country,
    seatId: action.seatId,
    scope: action.scope,
    target: action.target,
    strength: action.strength,
    startsTurn: turn,
    expiresTurn: turn + actionDuration(action),
  };
}

export interface CabinetActorActionState {
  charges: number;
  lastRechargeTurn: number;
}

export interface CabinetActionUseInput {
  action: ResetCabinetAction;
  turn: number;
  actor: CabinetActorActionState;
  seatActive: boolean;
  legalAuthority: boolean;
  capacityAvailable: boolean;
  annualNationalGdp: number;
  flexibleOperatingFunds: number;
  active: readonly ActiveCabinetAction[];
  history: readonly ActionUseHistory[];
}

export type CabinetActionUseResult =
  | {
      allowed: false;
      reason: ActionBlockReason;
      actor: CabinetActorActionState;
      operatingDebit: 0;
      active: readonly ActiveCabinetAction[];
      history: readonly ActionUseHistory[];
    }
  | {
      allowed: true;
      actor: CabinetActorActionState;
      operatingDebit: number;
      active: readonly ActiveCabinetAction[];
      history: readonly ActionUseHistory[];
    };

/** Resolve one actor's order. The shell must atomically debit funds and persist this result. */
export function useCabinetAction(input: CabinetActionUseInput): CabinetActionUseResult {
  const recharged = rechargeActionCharges(
    input.actor.charges,
    input.actor.lastRechargeTurn,
    input.turn
  );
  const actor = {
    charges: recharged.charges,
    lastRechargeTurn: recharged.lastRechargeTurn,
  };
  const active = input.active.filter((entry) => entry.expiresTurn > input.turn);
  const history = input.history.filter((entry) => entry.expiresTurn + 24 > input.turn);
  const eligibility = actionEligibility({
    ...input,
    charges: actor.charges,
    active,
    history,
  });
  if (!eligibility.allowed) {
    return {
      allowed: false,
      reason: eligibility.reason!,
      actor,
      operatingDebit: 0,
      active,
      history,
    };
  }
  const activated = activateAction(input.action, input.turn);
  return {
    allowed: true,
    actor: { ...actor, charges: actor.charges - 1 },
    operatingDebit: eligibility.operatingCost,
    active: [...active, activated],
    history: [
      ...history,
      {
        country: activated.country,
        seatId: activated.seatId,
        scope: activated.scope,
        target: activated.target,
        expiresTurn: activated.expiresTurn,
      },
    ],
  };
}

export interface TemporaryTargetEffect {
  country: ResetCabinetAction["country"];
  scope: ResetCabinetAction["scope"];
  target: string;
  favorableNormalizedPoints: number;
  contributingActions: string[];
}

export interface ApplicableTemporaryTargetEffect {
  target: string;
  favorableNormalizedPoints: number;
  contributingActions: string[];
}

/** Merge already-filtered national and regional effects that apply to one metric board. */
export function mergeApplicableActionEffects(
  effects: readonly TemporaryTargetEffect[]
): ApplicableTemporaryTargetEffect[] {
  const byTarget = new Map<string, ApplicableTemporaryTargetEffect>();
  for (const effect of effects) {
    if (
      !Number.isFinite(effect.favorableNormalizedPoints) ||
      effect.favorableNormalizedPoints < 0 ||
      effect.favorableNormalizedPoints > 0.2
    ) {
      throw new Error(`invalid temporary effect: ${effect.target}`);
    }
    const existing = byTarget.get(effect.target);
    byTarget.set(effect.target, {
      target: effect.target,
      favorableNormalizedPoints: Math.min(
        0.2,
        (existing?.favorableNormalizedPoints ?? 0) + effect.favorableNormalizedPoints
      ),
      contributingActions: [
        ...new Set([...(existing?.contributingActions ?? []), ...effect.contributingActions]),
      ],
    });
  }
  return [...byTarget.values()];
}

/** Largest active action counts in full; each further office counts at 25%. */
export function combineActiveActionEffects(
  active: readonly ActiveCabinetAction[],
  turn: number
): TemporaryTargetEffect[] {
  if (!Number.isInteger(turn) || turn < 0) throw new Error("turn must be a nonnegative integer");
  const groups = new Map<
    string,
    {
      country: ResetCabinetAction["country"];
      scope: ResetCabinetAction["scope"];
      target: string;
      contributions: Map<string, { actionId: string; strength: number }>;
    }
  >();
  for (const action of active) {
    if (
      !Number.isSafeInteger(action.startsTurn) ||
      action.startsTurn < 0 ||
      !Number.isSafeInteger(action.expiresTurn) ||
      action.expiresTurn <= action.startsTurn
    )
      throw new Error(`invalid active action interval: ${action.actionId}`);
    if (!Number.isFinite(action.strength) || action.strength < 0 || action.strength > 0.2) {
      throw new Error(`invalid active action strength: ${action.actionId}`);
    }
    if (action.startsTurn > turn || action.expiresTurn <= turn) continue;
    const targets = targetIds(action.target);
    targets.forEach((target, index) => {
      const key = `${action.country}:${action.scope}:${target}`;
      const group = groups.get(key) ?? {
        country: action.country,
        scope: action.scope,
        target,
        contributions: new Map<string, { actionId: string; strength: number }>(),
      };
      const contribution = {
        actionId: action.actionId,
        strength: action.strength * (index === 0 ? 1 : 0.5),
      };
      const prior = group.contributions.get(action.seatId);
      if (!prior || contribution.strength > prior.strength) {
        group.contributions.set(action.seatId, contribution);
      }
      groups.set(key, group);
    });
  }
  return [...groups.values()].map((group) => {
    const sorted = [...group.contributions.values()].sort(
      (a, b) => b.strength - a.strength || a.actionId.localeCompare(b.actionId)
    );
    const total = sorted.reduce(
      (sum, contribution, index) => sum + contribution.strength * (index === 0 ? 1 : 0.25),
      0
    );
    return {
      country: group.country,
      scope: group.scope,
      target: group.target,
      favorableNormalizedPoints: Math.min(0.2, total),
      contributingActions: sorted.map((contribution) => contribution.actionId),
    };
  });
}
