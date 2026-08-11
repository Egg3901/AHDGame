// Guards evaluated before any heal writes. Every one is a HARD refusal, not a
// warning: a heal that runs with a failing guard is exactly the class of event
// this ledger exists to prevent.

import type { Db } from "mongodb";
import type { CodeGateResult, Defect, GuardName, HealPlan } from "./types";

export interface GuardVerdict {
  guard: string;
  ok: boolean;
  detail: string;
}

export interface GuardOutcome {
  ok: boolean;
  verdicts: GuardVerdict[];
  /** Human-readable reason the run was refused. Empty when ok. */
  refusal: string;
}

/** Turn-lock snapshot. */
export interface TurnLockState {
  isProcessing: boolean;
  currentTurn: number | null;
  processingPhase: string | null;
  heartbeatAgeSec: number | null;
  /**
   * True when no gameState document could be found at all. NOT the same as
   * "idle": an unreadable turn lock must refuse, not wave the heal through.
   */
  unknown: boolean;
}

interface GameStateShape {
  currentTurn?: number;
  isProcessing?: boolean;
  processingPhase?: string;
  processingHeartbeatAt?: Date;
}

/**
 * Read the live gameState singleton.
 *
 * `_id: "current"` is what the application itself reads (src/lib/currentTurn.ts).
 * An earlier version of this guard queried `{ isActive: true }`, copied from
 * turndiag — and on the real databases that singleton carries
 * `isActive: false`, so the query matched NOTHING. The turn-lock guard then
 * failed OPEN (no document reads as "no turn in flight") and the confirm token
 * bound to a null turn number, disabling the staleness check. Both are
 * load-bearing, so: canonical id first, legacy shape as a fallback, and
 * `unknown` rather than an invented idle.
 */
export async function readGameState(db: Db): Promise<GameStateShape | null> {
  const projection = {
    currentTurn: 1,
    isProcessing: 1,
    processingPhase: 1,
    processingHeartbeatAt: 1,
  };
  // gameState is keyed by a string sentinel ("current"), not an ObjectId.
  const gameState = db.collection<{ _id: string } & Record<string, unknown>>("gameState");
  return ((await gameState.findOne<GameStateShape>({ _id: "current" }, { projection })) ??
    (await gameState.findOne<GameStateShape>({ isActive: true }, { projection })) ??
    null) as GameStateShape | null;
}

export async function readTurnLock(db: Db, now: Date): Promise<TurnLockState> {
  const gameState = await readGameState(db);
  if (!gameState) {
    return {
      isProcessing: false,
      currentTurn: null,
      processingPhase: null,
      heartbeatAgeSec: null,
      unknown: true,
    };
  }

  const heartbeatAt = gameState.processingHeartbeatAt;
  return {
    isProcessing: gameState.isProcessing === true,
    currentTurn: typeof gameState.currentTurn === "number" ? gameState.currentTurn : null,
    processingPhase: gameState.processingPhase ?? null,
    heartbeatAgeSec: heartbeatAt
      ? Math.round((now.getTime() - new Date(heartbeatAt).getTime()) / 1000)
      : null,
    unknown: false,
  };
}

export function parseMaxAffected(guard: GuardName): number | null {
  const match = /^max-affected:(\d+)$/.exec(guard);
  return match ? Number(match[1]) : null;
}

/**
 * Evaluate every guard the defect declares, plus the two the framework always
 * applies: money conservation, and the code gate.
 */
export function evaluateGuards(args: {
  defect: Defect;
  plan: HealPlan;
  turnLock: TurnLockState;
  codeGate?: CodeGateResult;
}): GuardOutcome {
  const { defect, plan, turnLock, codeGate } = args;
  const verdicts: GuardVerdict[] = [];

  for (const guard of defect.guards) {
    if (guard === "turn-lock-free") {
      verdicts.push({
        guard,
        ok: !turnLock.isProcessing && !turnLock.unknown,
        detail: turnLock.unknown
          ? "no gameState document found, so it is UNKNOWN whether a turn is running. Refusing: an unreadable turn lock is not an idle one."
          : turnLock.isProcessing
            ? `turn in flight (phase ${turnLock.processingPhase ?? "?"}, heartbeat ${turnLock.heartbeatAgeSec ?? "?"}s ago) — wait for it to finish`
            : `no turn in flight (turn ${turnLock.currentTurn ?? "?"})`,
      });
      continue;
    }

    if (guard === "money-conserving") {
      // Declared explicitly here as well as implicitly below; dedupe by skipping.
      continue;
    }

    const cap = parseMaxAffected(guard);
    if (cap != null) {
      verdicts.push({
        guard,
        ok: plan.affected <= cap,
        detail:
          plan.affected <= cap
            ? `${plan.affected} affected, cap ${cap}`
            : `${plan.affected} affected exceeds cap ${cap} — an unbounded heal is how incidents get worse. Raise the cap in the defect deliberately, do not override at the call site.`,
      });
      continue;
    }

    verdicts.push({ guard, ok: false, detail: `unknown guard "${guard}"` });
  }

  // Always applied, whether or not the defect lists it.
  const moneyOk = defect.mintsMoney === true || plan.moneyDelta === 0;
  verdicts.push({
    guard: "money-conserving",
    ok: moneyOk,
    detail: moneyOk
      ? defect.mintsMoney
        ? `money delta ${plan.moneyDelta} permitted (defect declares mintsMoney)`
        : "money delta 0"
      : `heal would change total money by ${plan.moneyDelta} and the defect does not declare mintsMoney`,
  });

  // Always applied: the whole point of the ledger.
  verdicts.push(evaluateCodeGate(defect, codeGate));

  const failed = verdicts.filter((v) => !v.ok);
  return {
    ok: failed.length === 0,
    verdicts,
    refusal: failed.map((v) => `[${v.guard}] ${v.detail}`).join("; "),
  };
}

function evaluateCodeGate(defect: Defect, codeGate?: CodeGateResult): GuardVerdict {
  const required = defect.codeFix?.requiredCommit;

  if (!required) {
    return {
      guard: "code-gate",
      ok: true,
      detail: "defect declares no requiredCommit (no code half, or not yet pinned)",
    };
  }
  if (!codeGate) {
    return {
      guard: "code-gate",
      ok: false,
      detail: `defect requires commit ${required} to be deployed, but no code-gate verdict was supplied. Healing before the fix reaches this env means the engine re-corrupts on the next turn.`,
    };
  }
  if (codeGate.override) {
    return {
      guard: "code-gate",
      ok: true,
      detail: `OVERRIDDEN by ${codeGate.override.operator}: ${codeGate.override.reason} (gate said: ${codeGate.detail})`,
    };
  }
  return { guard: "code-gate", ok: codeGate.ok, detail: codeGate.detail };
}
