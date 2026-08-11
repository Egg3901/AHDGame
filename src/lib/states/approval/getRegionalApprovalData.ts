import type { Db } from "mongodb";
import { findMergedRegionMetrics, findMergedRegionMetricsMany } from "@/lib/macroMetrics/merge";
import type { CountryId } from "@/lib/constants/countries";
import type { GameState, StateMetrics } from "@/lib/db/types";
import { resolveGameYear } from "@/lib/era/era";
import { getActiveAddressApprovalModifiers } from "@/lib/governorOffice/address/activeAddressModifiers";
import {
  buildFlatMetrics,
  calculateStateApproval,
  computeNationalAveragesFromMetrics,
  computeStateApprovalBase,
} from "@/lib/utils/governmentApproval";
import { evaluateModifiers, type ActiveModifier } from "@/lib/utils/approvalModifiers";
import { BASE_APPROVAL } from "@/lib/utils/governmentApproval";
import {
  isPoliticalApprovalCountry,
  loadPoliticalApprovalBases,
} from "@/lib/politicalLegislation/politicalApprovalProvider";

export interface RegionalApprovalData {
  approval: number;
  baseApproval: number;
  modifiers: ActiveModifier[];
}

/**
 * Compute regional government approval and active metric/address modifiers.
 * Shared by the region page hero, overview conditions card, and metrics APIs.
 */
export async function getRegionalApprovalData(
  db: Db,
  countryId: CountryId,
  stateId: string
): Promise<RegionalApprovalData | null> {
  // SP5: merged two-store view.
  const metrics = await findMergedRegionMetrics(db, { _id: stateId, countryId });
  if (!metrics) return null;

  const countryStateIds = (
    await db.collection("states").find({ countryId }).project<{ _id: string }>({ _id: 1 }).toArray()
  ).map((s) => s._id);

  if (countryStateIds.length === 0) return null;

  const allMetrics = await findMergedRegionMetricsMany(db, { _id: { $in: countryStateIds } });

  if (allMetrics.length === 0) return null;

  const nationalAverages = computeNationalAveragesFromMetrics(allMetrics);
  const gameState = await db.collection<GameState>("gameState").findOne(
    { _id: "current" },
    {
      projection: {
        currentTurn: 1,
        currentYear: 1,
        preset: 1,
        startingYear: 1,
        eraSystemEnabled: 1,
      },
    }
  );
  const currentTurn = gameState?.currentTurn ?? 0;
  const preset = gameState?.preset ?? null;
  // Live year for era-aware scoring; null while the flag is off (legacy path).
  const year = gameState?.eraSystemEnabled ? resolveGameYear(gameState ?? {}) : null;

  const addressModifiers = await getActiveAddressApprovalModifiers(
    db,
    countryId,
    stateId,
    currentTurn
  );
  const modifiers: ActiveModifier[] = [
    ...evaluateModifiers(buildFlatMetrics(metrics), { preset, countryId, year }),
    ...addressModifiers,
  ];

  // SP4: playable countries score from the hybrid political base; modifiers
  // (metric-named + address) still apply on top via the shared seam.
  let baseOverride: number | undefined;
  if (isPoliticalApprovalCountry(countryId)) {
    const bases = await loadPoliticalApprovalBases(db, countryId);
    baseOverride = bases?.byRegion.get(stateId) ?? BASE_APPROVAL;
  }

  return {
    approval: calculateStateApproval(
      metrics,
      nationalAverages,
      addressModifiers,
      undefined,
      preset,
      year,
      baseOverride
    ),
    baseApproval:
      baseOverride ??
      computeStateApprovalBase(metrics, nationalAverages, undefined, preset ?? undefined),
    modifiers,
  };
}
