import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CongressionalDistrict } from "@/lib/db/types";
import type { ActiveModifier } from "@/lib/utils/approvalModifiers";
import { getGameState } from "@/lib/gameState";
import { isRedistrictingEnabled } from "./flag";
import { computeEfficiencyGap } from "./legality";
import { computeRedistrictCaps } from "./caps";

const PENALTY_MIN = 2;
const PENALTY_MAX = 5;

/** Mild approval drag while the live map exceeds its fairness ceiling: −2..−5. */
export function fairnessApprovalPenalty(eg: number, ceiling: number): number {
  if (eg <= ceiling) return 0;
  const over = eg - ceiling;
  const points = Math.min(PENALTY_MAX, PENALTY_MIN + Math.floor(over / 0.05));
  return -points;
}

/**
 * Per-state approval modifiers for unfair congressional maps. Empty when the
 * flag is off or the country has no district docs.
 */
export async function getActiveFairnessGapModifiers(
  db: Db,
  countryId: CountryId
): Promise<Map<string, ActiveModifier[]>> {
  const out = new Map<string, ActiveModifier[]>();
  const gs = await getGameState(db);
  if (!isRedistrictingEnabled(gs)) return out;

  const districts = (await db
    .collection<CongressionalDistrict>("congressionalDistricts")
    .find({ countryId } as Partial<CongressionalDistrict>)
    .toArray()) as CongressionalDistrict[];
  if (districts.length === 0) return out;

  const byState = new Map<string, CongressionalDistrict[]>();
  for (const d of districts) {
    const arr = byState.get(d.stateId) ?? [];
    arr.push(d);
    byState.set(d.stateId, arr);
  }

  for (const [stateId, list] of byState) {
    const caps = await computeRedistrictCaps(db, countryId, stateId, list.length);
    const eg = computeEfficiencyGap(list.map((d) => d.squares));
    const penalty = fairnessApprovalPenalty(eg, caps.efficiencyGapCeiling);
    if (penalty !== 0) {
      out.set(stateId, [
        {
          id: `fairness-gap:${stateId}`,
          label: `Unfair congressional map (gap ${(eg * 100).toFixed(0)}%)`,
          effect: penalty,
        },
      ]);
    }
  }
  return out;
}
