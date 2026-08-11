import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type {
  PartyPoliticalStrengthLedgerRow,
  PartyStrengthPressure,
  PoliticalParty,
  StatePartyOrg,
} from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import {
  PRESSURE_LADDER_INCREMENT,
  PRESSURE_LADDER_MAX_VALUE,
  effectivePsCost,
} from "@/lib/turn/politicalStrength/strengthConstants";

/**
 * Shared command that debits Political Strength for a party action and
 * escalates the per-geography pressure ladder.
 *
 * Used by every player API route that consumes PS (Build Org,
 * Influence actions, Recruitment, etc.). Centralizing the math
 * here ensures:
 *  - the pressure ladder is applied consistently across actions
 *  - the `partyPoliticalStrengthLedger` audit trail captures every spend
 *  - the per-geography pressure tracking ("Arizona spend doesn't raise
 *    California cost") is enforced
 *
 * Geography rules:
 *  - State-scope spends (`scope: "state"`) MUST set `stateId`. Pressure
 *    is tracked per-(party, state) on the state-party row.
 *  - National-scope spends with a target state (`scope: "national-targeted"`)
 *    set `stateId` AND mutate the national party's PS pool, but escalate
 *    pressure on the per-(national-party, state) ladder. This matches
 *    the locked assumption "national PS pressure is tracked per state".
 *  - Pure national-scope spends (`scope: "national"`) — none defined for
 *    Phase 3, but the slot exists for future. Pressure on a sentinel
 *    "all-national" geography.
 *
 * Atomicity: PS debit uses MongoDB's atomic `findOneAndUpdate` with a
 * conditional `$gte` predicate, so concurrent spend attempts that would
 * overdraw fail cleanly. Pressure is updated via separate upsert; a tight
 * race could double-credit pressure (acceptable — pressure overshooting
 * is bounded by the cost ladder cap).
 *
 * Returns the spend outcome including the effective cost paid (after
 * pressure escalation) so callers can show players what they paid.
 */

export type SpendScope = "state" | "national-targeted" | "national";

export interface SpendPoliticalStrengthInput {
  countryId: CountryId;
  /** Party's `sequentialId`-string identifier. */
  partyId: string;
  scope: SpendScope;
  /** Required for `state` and `national-targeted`. Sentinel `"__national__"` for pure national. */
  stateId: string;
  /** Base PS cost before pressure escalation. */
  baseCost: number;
  /** Action key for ledger (`build-org`, `influence:endorse`, etc.). */
  action: string;
  /** Now timestamp for ledger / pressure update. */
  now: Date;
  /** Current game turn (for ledger). */
  turn: number;
}

export type SpendPoliticalStrengthResult =
  | {
      ok: true;
      effectiveCost: number;
      newPoliticalStrength: number;
      newPressure: number;
    }
  | {
      ok: false;
      reason: "insufficient-ps" | "missing-row" | "invalid-scope";
      effectiveCost: number;
      currentPoliticalStrength: number;
    };

/** Sentinel geography key for pure-national spends (no state in scope). */
export const NATIONAL_GEOGRAPHY_SENTINEL = "__national__" as const;

export async function spendPoliticalStrength(
  input: SpendPoliticalStrengthInput,
  injectedDb?: Db
): Promise<SpendPoliticalStrengthResult> {
  const db = injectedDb ?? (await getDb());

  if ((input.scope === "state" || input.scope === "national-targeted") && !input.stateId) {
    return {
      ok: false,
      reason: "invalid-scope",
      effectiveCost: input.baseCost,
      currentPoliticalStrength: 0,
    };
  }

  // Resolve the pressure-track key. Per-geography for state and
  // national-targeted; sentinel for pure national.
  const pressureStateId = input.scope === "national" ? NATIONAL_GEOGRAPHY_SENTINEL : input.stateId;
  const pressureRowId = `${input.countryId}_${input.partyId}_${pressureStateId}`;

  // Read current pressure (one extra read; tolerable for action paths).
  const pressureCol = db.collection<PartyStrengthPressure>("partyStrengthPressure");
  const existingPressure = await pressureCol.findOne({ _id: pressureRowId });
  const currentPressure = existingPressure?.value ?? 0;
  const cost = effectivePsCost(input.baseCost, currentPressure);

  // Atomic PS debit. State scope writes to statePartyOrg; national /
  // national-targeted scope writes to politicalParties.
  let updatedPS: number | null = null;
  let currentPS = 0;
  if (input.scope === "state") {
    const spoCol = db.collection<StatePartyOrg>("statePartyOrg");
    const spoFilter = {
      countryId: input.countryId,
      partyId: input.partyId,
      stateId: input.stateId,
      politicalStrength: { $gte: cost },
    };
    const updated = await spoCol.findOneAndUpdate(
      spoFilter,
      { $inc: { politicalStrength: -cost }, $set: { updatedAt: input.now } },
      { returnDocument: "after" }
    );
    if (!updated) {
      const existing = await spoCol.findOne({
        countryId: input.countryId,
        partyId: input.partyId,
        stateId: input.stateId,
      });
      if (!existing) {
        return {
          ok: false,
          reason: "missing-row",
          effectiveCost: cost,
          currentPoliticalStrength: 0,
        };
      }
      return {
        ok: false,
        reason: "insufficient-ps",
        effectiveCost: cost,
        currentPoliticalStrength: existing.politicalStrength ?? 0,
      };
    }
    updatedPS = updated.politicalStrength;
    currentPS = updatedPS;
  } else {
    const partyCol = db.collection<PoliticalParty>("politicalParties");
    const partyFilter = {
      countryId: input.countryId,
      sequentialId: Number(input.partyId),
      politicalStrength: { $gte: cost },
    };
    const updated = await partyCol.findOneAndUpdate(
      partyFilter,
      { $inc: { politicalStrength: -cost }, $set: { updatedAt: input.now } },
      { returnDocument: "after" }
    );
    if (!updated) {
      const existing = await partyCol.findOne({
        countryId: input.countryId,
        sequentialId: Number(input.partyId),
      });
      if (!existing) {
        return {
          ok: false,
          reason: "missing-row",
          effectiveCost: cost,
          currentPoliticalStrength: 0,
        };
      }
      return {
        ok: false,
        reason: "insufficient-ps",
        effectiveCost: cost,
        currentPoliticalStrength: existing.politicalStrength ?? 0,
      };
    }
    updatedPS = updated.politicalStrength;
    currentPS = updatedPS;
  }

  // Increment pressure (upsert — first spend in this geography creates the row),
  // clamped to `PRESSURE_LADDER_MAX_VALUE`. Pressure beyond that ceiling has no
  // effect on cost (which already saturates at `PRESSURE_LADDER_MAX_COST`) but,
  // if allowed to accumulate unbounded via a raw `$inc`, keeps the cost pinned
  // at max for dozens of turns after the party stops spending, since decay is
  // only a few PS/turn — the runaway behind ticket #945. We compute the clamped
  // value and `$set` it; the tiny concurrency window (two simultaneous spends
  // each reading the same `currentPressure`) can at worst under-count by one
  // increment, which is harmless given the value is capped anyway.
  const newPressureValue = Math.min(
    currentPressure + PRESSURE_LADDER_INCREMENT,
    PRESSURE_LADDER_MAX_VALUE
  );
  await pressureCol.updateOne(
    { _id: pressureRowId },
    {
      $set: { value: newPressureValue, lastUpdatedTurn: input.turn },
      $setOnInsert: {
        countryId: input.countryId,
        partyId: input.partyId,
        stateId: pressureStateId,
      },
    },
    { upsert: true }
  );

  // Audit ledger row. Geography is the (potentially sentinel) state.
  await db.collection<PartyPoliticalStrengthLedgerRow>("partyPoliticalStrengthLedger").insertOne({
    _id: new ObjectId(),
    countryId: input.countryId,
    partyId: input.partyId,
    stateId: input.scope === "national" ? undefined : input.stateId,
    turn: input.turn,
    source: "spend",
    delta: -cost,
    value: currentPS,
    action: input.action,
    geography: pressureStateId,
    createdAt: input.now,
  } as PartyPoliticalStrengthLedgerRow);

  return {
    ok: true,
    effectiveCost: cost,
    newPoliticalStrength: currentPS,
    newPressure: newPressureValue,
  };
}
