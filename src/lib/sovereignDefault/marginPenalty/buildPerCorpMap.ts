/**
 * Aggregate per-corp sector margin modifier from all recovering countries.
 *
 * For each corp × recovering country pair, sum local (same-country) and global
 * contagion (foreign) contributions. Returns Map<corpId-string, total mod>.
 *
 * Skips:
 *   - budgets with lastDefaultTurn === null
 *   - budgets with crisisChoice === "monetize" (inflation pipeline handles)
 *   - corps with countryId not set
 */

import type { ObjectId } from "mongodb";
import type { CorporationType } from "@/lib/constants/corporations";
import type { FederalBudget } from "@/lib/db/types/budget";
import { computeLocalSectorMarginPenalty } from "./localPenalty";
import { computeGlobalContagionSectorMarginPenalty } from "./globalContagion";

export interface PerCorpMapInputs {
  recoveringBudgets: Pick<
    FederalBudget,
    "_id" | "countryId" | "gdp" | "lastDefaultTurn" | "crisisChoice"
  >[];
  corps: { _id: ObjectId; countryId?: string; type: CorporationType }[];
  currentTurn: number;
  globalGdp: number;
}

export function buildSovereignDefaultMarginByCorpId(inputs: PerCorpMapInputs): Map<string, number> {
  const out = new Map<string, number>();
  if (inputs.recoveringBudgets.length === 0) return out;

  for (const corp of inputs.corps) {
    if (!corp.countryId) continue;
    let total = 0;
    for (const budget of inputs.recoveringBudgets) {
      if (budget.lastDefaultTurn === null || budget.lastDefaultTurn === undefined) continue;
      if (!budget.crisisChoice) continue;
      // Monetize uses the inflation pipeline; skip explicitly so upstream
      // refactors don't accidentally double-count.
      if (budget.crisisChoice === "monetize") continue;
      if (!budget.countryId) continue;

      total += computeLocalSectorMarginPenalty({
        corpCountryId: corp.countryId,
        defaultingCountryCode: budget.countryId,
        resolutionType: budget.crisisChoice,
        corpType: corp.type,
        currentTurn: inputs.currentTurn,
        lastDefaultTurn: budget.lastDefaultTurn,
      });

      total += computeGlobalContagionSectorMarginPenalty({
        corpCountryId: corp.countryId,
        defaultingCountryCode: budget.countryId,
        defaultingCountryGdp: budget.gdp ?? 0,
        globalGdp: inputs.globalGdp,
        resolutionType: budget.crisisChoice,
        corpType: corp.type,
        currentTurn: inputs.currentTurn,
        lastDefaultTurn: budget.lastDefaultTurn,
      });
    }
    if (total !== 0) {
      out.set(corp._id.toString(), total);
    }
  }
  return out;
}
