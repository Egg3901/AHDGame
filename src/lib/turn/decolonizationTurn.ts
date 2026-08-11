/**
 * Decolonization turn phase.
 *
 * `src/lib/world/transitions/` is a complete, tested sovereignty-transition
 * engine — authored rules, a deterministic pressure+calendar evaluator, an
 * applier that seeds the Tier-2 macro country, and manifest rows carrying sphere
 * relationships. Its only callers were a readiness report and a seed script:
 * **nothing in the turn registry ever ran a transition.** So in a 1953 world the
 * colonial map stayed frozen for the entire run, and Ghana 1957, Somalia and the
 * Congo 1960, Algeria 1962, Guyana 1966 and South Yemen 1967 simply never
 * happened.
 *
 * This is the missing wiring, not new mechanics. It walks the decolonization
 * roster once per in-game year, evaluates each rule against live world pressure,
 * and applies the ones that clear. Rules are idempotent by construction — an
 * applied transition is recorded and skipped thereafter.
 */
import type { Db } from "mongodb";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import { DECOLONIZATION_ROSTER_RULE_IDS, runTransition } from "@/lib/world/transitions";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

/** Collection recording which transitions have already fired, for idempotency. */
const APPLIED_COLLECTION = "appliedWorldTransitions";

export interface DecolonizationTurnResult {
  evaluated: number;
  applied: number;
  ruleIds: string[];
}

const EMPTY: DecolonizationTurnResult = { evaluated: 0, applied: 0, ruleIds: [] };

/**
 * Last in-game year the decolonization roster is meaningful. The authored
 * windows close in the mid-1970s (Angola and Mozambique 1975); beyond this the
 * evaluator's past-window default would fire everything at once.
 */
export const DECOLONIZATION_ERA_LAST_YEAR = 1980;

/**
 * Runs at most once per in-game year. Sovereignty is a calendar-scale event, and
 * the rules are authored against years — re-evaluating every turn would burn 48x
 * the work for the same answer.
 */
export async function processDecolonizationTurn(
  db: Db,
  currentTurn: number,
  currentYear: number | null | undefined
): Promise<DecolonizationTurnResult> {
  if (currentYear == null || !Number.isFinite(currentYear)) return EMPTY;
  // Year boundary only.
  if (currentTurn % TURNS_PER_YEAR !== 0) return EMPTY;

  // Fail-safe gate. `historicalPrior` returns 0.95 — "strong default to
  // resolve" — for any year PAST a rule's window, so an ungated phase in a
  // 1991 or 2019 world would fire every decolonization rule on its first year
  // boundary and re-apply independences that are already historical fact.
  const config = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { worldTransitionsEnabled: 1 } });
  if (config?.worldTransitionsEnabled !== true) return EMPTY;

  // Second belt: even with the flag on, refuse to run past the era these rules
  // describe. The roster's latest window closes in the mid-1970s.
  if (currentYear > DECOLONIZATION_ERA_LAST_YEAR) return EMPTY;

  const applied = await db
    .collection<{ _id: string }>(APPLIED_COLLECTION)
    .find({}, { projection: { _id: 1 } })
    .toArray();
  const alreadyApplied = new Set(applied.map((d) => String(d._id)));

  const pending = DECOLONIZATION_ROSTER_RULE_IDS.filter((id) => !alreadyApplied.has(id));
  if (pending.length === 0) return EMPTY;

  const result: DecolonizationTurnResult = { evaluated: 0, applied: 0, ruleIds: [] };

  for (const ruleId of pending) {
    result.evaluated++;
    try {
      // Pressures are left at their authored defaults for now: the evaluator
      // already carries the historical calendar and priors, which is what makes
      // the dates land near history. Deriving live pressure from sphere
      // alignment and parent capacity is the natural next step, but wiring the
      // engine in at all is the change that matters — a frozen colonial map is
      // a far larger error than imprecise timing.
      const { application } = await runTransition(ruleId, currentYear, currentTurn, {}, { db });
      if (application) {
        await db
          .collection(APPLIED_COLLECTION)
          .updateOne(
            { _id: ruleId as never },
            { $set: { ruleId, turn: currentTurn, year: currentYear, appliedAt: new Date() } },
            { upsert: true }
          );
        result.applied++;
        result.ruleIds.push(ruleId);
      }
    } catch (error) {
      // One rule failing must not stop the rest of the roster — the same
      // per-item isolation the parliamentary country loop needed.
      console.error(
        `[decolonization] rule ${ruleId} failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  return result;
}
