// State-bound confirm tokens.
//
// The safety property: an agent cannot apply a heal it did not just dry-run,
// and cannot apply a dry-run that has gone stale.
//
// plan() mints a token bound to a FINGERPRINT of the world it saw — the defect,
// the env, the detector count, a digest of the intended writes, and the current
// turn number. apply() recomputes the fingerprint against live state and
// refuses on any mismatch. If a turn ticked, if another agent healed half of
// it, if the affected set moved at all, the token is dead and you replan.
//
// Tokens live in Mongo rather than being a signed hash, for three reasons:
// plan and apply are usually separate processes (CLI, MCP) so there is no
// shared in-memory secret; the row gives one-time use for free; and the row is
// itself a record of every dry run anyone performed.

import { createHash, randomBytes } from "crypto";
import type { Db } from "mongodb";
import { readGameState } from "./guards";
import type { HealEnv, HealPlan, TouchedDocs } from "./types";

export const HEAL_TOKENS_COLLECTION = "healTokens";
export const TOKEN_TTL_MS = 10 * 60 * 1000;

export interface HealToken {
  _id: string;
  defectId: string;
  env: HealEnv;
  fingerprint: string;
  planDigest: string;
  affected: number;
  turnNumber: number | null;
  issuedAt: Date;
  expiresAt: Date;
  consumedAt?: Date;
  consumedByRunId?: string;
  operator: string;
}

/**
 * Canonical digest of what a plan intends to do. Order-insensitive over
 * touched ids so an unstable query order does not invalidate a good token,
 * but sensitive to every id, the count, and the money delta.
 */
export function planDigest(plan: HealPlan): string {
  const canonical = {
    affected: plan.affected,
    moneyDelta: plan.moneyDelta,
    summary: plan.summary,
    touched: normalizeTouched(plan.touched),
  };
  return sha256(JSON.stringify(canonical));
}

function normalizeTouched(touched: TouchedDocs[]): Array<[string, string[]]> {
  const byCollection = new Map<string, Set<string>>();
  for (const entry of touched) {
    const set = byCollection.get(entry.collection) ?? new Set<string>();
    for (const id of entry.ids) set.add(id);
    byCollection.set(entry.collection, set);
  }
  return [...byCollection.entries()]
    .map(([collection, ids]): [string, string[]] => [collection, [...ids].sort()])
    .sort((a, b) => a[0].localeCompare(b[0]));
}

/**
 * The world-state fingerprint a token is bound to. Turn number is in here
 * deliberately: a turn tick means the engine has rewritten game state, and any
 * plan computed before it must be re-derived rather than trusted.
 */
export function stateFingerprint(input: {
  defectId: string;
  env: HealEnv;
  affected: number;
  planDigest: string;
  turnNumber: number | null;
}): string {
  return sha256(
    [
      input.defectId,
      input.env,
      String(input.affected),
      input.planDigest,
      input.turnNumber == null ? "no-turn" : String(input.turnNumber),
    ].join("|")
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Current live turn number, or null when no gameState document exists.
 *
 * Reads through the same helper the turn-lock guard uses, so the token binds
 * to the turn the application actually believes it is on. Querying the wrong
 * key here silently binds every token to "no-turn", which disables the
 * staleness check without failing anything visibly.
 */
export async function readTurnNumber(db: Db): Promise<number | null> {
  const gameState = await readGameState(db);
  return typeof gameState?.currentTurn === "number" ? gameState.currentTurn : null;
}

export async function ensureTokenIndexes(db: Db): Promise<void> {
  // Mongo reaps consumed and abandoned tokens on its own; nothing reads a
  // token after the run that consumed it, and the healRuns marker keeps the
  // permanent record.
  await db
    .collection<HealToken>(HEAL_TOKENS_COLLECTION)
    .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 3600 });
  await db.collection<HealToken>(HEAL_TOKENS_COLLECTION).createIndex({ defectId: 1, env: 1 });
}

export async function issueToken(
  db: Db,
  args: {
    defectId: string;
    env: HealEnv;
    plan: HealPlan;
    turnNumber: number | null;
    operator: string;
    now: Date;
  }
): Promise<HealToken> {
  const digest = planDigest(args.plan);
  const token: HealToken = {
    _id: `heal_${randomBytes(24).toString("hex")}`,
    defectId: args.defectId,
    env: args.env,
    planDigest: digest,
    affected: args.plan.affected,
    turnNumber: args.turnNumber,
    fingerprint: stateFingerprint({
      defectId: args.defectId,
      env: args.env,
      affected: args.plan.affected,
      planDigest: digest,
      turnNumber: args.turnNumber,
    }),
    issuedAt: args.now,
    expiresAt: new Date(args.now.getTime() + TOKEN_TTL_MS),
    operator: args.operator,
  };
  await db.collection<HealToken>(HEAL_TOKENS_COLLECTION).insertOne(token);
  return token;
}

export type TokenCheck = { ok: true; token: HealToken } | { ok: false; reason: string };

/**
 * Validate a token against FRESH state. `freshPlan` is the plan re-derived at
 * apply time; if it disagrees with what was approved, the token dies.
 */
export async function checkToken(
  db: Db,
  args: {
    tokenId: string;
    defectId: string;
    env: HealEnv;
    freshPlan: HealPlan;
    turnNumber: number | null;
    now: Date;
  }
): Promise<TokenCheck> {
  const token = await db
    .collection<HealToken>(HEAL_TOKENS_COLLECTION)
    .findOne({ _id: args.tokenId });

  if (!token) return { ok: false, reason: "unknown confirm token — run heal_plan first" };
  if (token.consumedAt) {
    return {
      ok: false,
      reason: `token already consumed at ${token.consumedAt.toISOString()} by run ${token.consumedByRunId ?? "?"}`,
    };
  }
  if (token.expiresAt.getTime() <= args.now.getTime()) {
    return { ok: false, reason: "token expired (10 minute TTL) — replan" };
  }
  if (token.defectId !== args.defectId) {
    return { ok: false, reason: `token is for defect ${token.defectId}, not ${args.defectId}` };
  }
  if (token.env !== args.env) {
    return { ok: false, reason: `token is for env ${token.env}, not ${args.env}` };
  }

  const fresh = stateFingerprint({
    defectId: args.defectId,
    env: args.env,
    affected: args.freshPlan.affected,
    planDigest: planDigest(args.freshPlan),
    turnNumber: args.turnNumber,
  });
  if (fresh !== token.fingerprint) {
    return {
      ok: false,
      reason:
        "world state moved since the dry run (turn ticked, or the affected set changed) — " +
        "the approved plan no longer describes reality. Replan and re-read the diff.",
    };
  }

  return { ok: true, token };
}

/** Burn the token. Returns false if someone else burned it first (race). */
export async function consumeToken(
  db: Db,
  tokenId: string,
  runId: string,
  now: Date
): Promise<boolean> {
  const res = await db
    .collection<HealToken>(HEAL_TOKENS_COLLECTION)
    .updateOne(
      { _id: tokenId, consumedAt: { $exists: false } },
      { $set: { consumedAt: now, consumedByRunId: runId } }
    );
  return res.modifiedCount === 1;
}
