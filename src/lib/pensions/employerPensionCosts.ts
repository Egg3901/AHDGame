/**
 * What a pension agreement costs the EMPLOYER, for the employer's own accounts.
 *
 * `pensionTurn.ts` debits a corporation twice every turn (the bargained
 * contribution, then a deficit top-up) and ledgers both as `pension_contribution`.
 * Every reader of that log is an admin route, so before this the CEO saw the
 * cash leave and had nothing to name it. This recomputes the same two figures
 * from the same rules the turn uses, so the income statement can carry a line
 * for each.
 *
 * Projection, not history: it answers "what is this agreement charging me right
 * now", the way every other row on that statement does. An employer too short to
 * pay is still shown what it owes, because the claim accrues either way.
 */

import { ObjectId, type Db } from "mongodb";
import type { CollectiveAgreement } from "@/lib/db/types";
import type { PensionScheme } from "@/lib/db/types/pensionScheme";
import { activeCollectiveAgreementFilter } from "@/lib/unions/bargaining";
import {
  isValidContributionRate,
  pensionContributionForTurn,
  pensionSchemeAssetsAnchor,
  pensionTopUpForTurn,
} from "./rules";
import { PENSION_SCHEMES } from "./schemeAssets";

export interface EmployerPensionCostAnchorPerTurn {
  /** The bargained rate applied to the covered wage bill. */
  contributionAnchorPerTurn: number;
  /** The deficit top-up, on the position before this turn's accrual. */
  topUpAnchorPerTurn: number;
  /** Agreements carrying a contribution rate, whether or not they charge anything. */
  agreements: number;
  /** Of those, the ones whose scheme is short enough to be asking for a top-up. */
  schemesInDeficit: number;
}

export const EMPTY_EMPLOYER_PENSION_COST: EmployerPensionCostAnchorPerTurn = {
  contributionAnchorPerTurn: 0,
  topUpAnchorPerTurn: 0,
  agreements: 0,
  schemesInDeficit: 0,
};

/**
 * `wageBillAnchorPerTurnBySectorId` is the caller's own per-turn, anchor-denominated
 * wage bill per sector. The caller already restates sector fields out of their
 * host currency, so taking the figure from it keeps this away from a second copy
 * of that conversion, and keeps the pension rows on the same basis as the wage
 * row they sit under.
 */
export async function employerPensionCostForTurn(
  db: Db,
  corporationId: ObjectId,
  currentTurn: number,
  wageBillAnchorPerTurnBySectorId: Map<string, number>
): Promise<EmployerPensionCostAnchorPerTurn> {
  const agreements = await db
    .collection<CollectiveAgreement>("collectiveAgreements")
    .find({
      ...activeCollectiveAgreementFilter(currentTurn),
      employerCorporationId: corporationId,
      pensionContributionRate: { $gt: 0 },
    })
    .toArray();
  if (agreements.length === 0) return EMPTY_EMPLOYER_PENSION_COST;

  const unionIds = [...new Set(agreements.map((a) => a.unionId.toString()))].map(
    (id) => new ObjectId(id)
  );
  const schemes = await db
    .collection<PensionScheme>(PENSION_SCHEMES)
    .find({ unionId: { $in: unionIds } })
    .toArray();
  const schemeByUnionId = new Map(schemes.map((s) => [s.unionId.toString(), s]));

  const result: EmployerPensionCostAnchorPerTurn = {
    contributionAnchorPerTurn: 0,
    topUpAnchorPerTurn: 0,
    agreements: 0,
    schemesInDeficit: 0,
  };

  for (const agreement of agreements) {
    const rate = agreement.pensionContributionRate ?? 0;
    if (!isValidContributionRate(rate) || rate <= 0) continue;
    result.agreements += 1;

    let wageBill = 0;
    for (const sectorId of agreement.sectorIds) {
      wageBill += wageBillAnchorPerTurnBySectorId.get(sectorId.toString()) ?? 0;
    }
    if (wageBill <= 0) continue;

    const contribution = pensionContributionForTurn({
      coveredWageBill: wageBill,
      contributionRate: rate,
    });
    result.contributionAnchorPerTurn += contribution;

    // A scheme that does not exist yet is created by the turn with nothing owed,
    // so it cannot be in deficit and asks for nothing.
    const scheme = schemeByUnionId.get(agreement.unionId.toString());
    if (!scheme) continue;

    // Same reading as the turn: total assets including the marked value of the
    // scheme's units, plus what this turn's contribution is about to add.
    const topUp = pensionTopUpForTurn({
      assetsAnchor: pensionSchemeAssetsAnchor(scheme) + contribution,
      liabilitiesAnchor: scheme.liabilitiesAnchor,
    });
    if (topUp > 0) {
      result.topUpAnchorPerTurn += topUp;
      result.schemesInDeficit += 1;
    }
  }

  return result;
}
