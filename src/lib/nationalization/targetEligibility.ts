import type { Db } from "mongodb";
import type { Bond, Corporation, CorporateSector } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { evaluateEligibility, type EligibilityResult } from "./eligibility";
import { getDesignatedSectorTypes, corpHasStrategicSector } from "./strategicSectors";
import { fetchMarketSharePercentForSectors } from "@/lib/corporations/marketShare";

export interface ResolvedCorpEligibility {
  ownerKind: "player" | "npc";
  result: EligibilityResult;
  /**
   * True when executive power may take this corp without legislation: NPC-owned,
   * or a distressed player corp (locked executive-reach rule, spec §8). A solvent
   * player corp that is merely strategic/monopoly is eligible but NOT executively
   * takeable — it needs the legislative path.
   */
  executivelyTakeable: boolean;
  /** Number of sectors the corp operates (fetched once for the batch). */
  sectorCount: number;
}

/**
 * Batched eligibility resolution for a set of corporations, fetching the
 * snapshots the pure `evaluateEligibility` needs with a fixed number of DB
 * round-trips (defaulted bonds, sectors, designated sector types, and one
 * batched market-share pass) instead of O(corps × sectors) queries.
 *
 * This is the single source of truth for eligibility snapshots — the
 * single-corp `resolveCorpEligibility` delegates here so the executive
 * nationalize route and the eligible-targets read route never drift.
 */
export async function resolveCorpEligibilityBatch(
  db: Db,
  countryId: CountryId,
  corps: Corporation[],
  currentTurn: number
): Promise<Map<string, ResolvedCorpEligibility>> {
  const resolved = new Map<string, ResolvedCorpEligibility>();
  if (corps.length === 0) return resolved;

  const corpIds = corps.map((c) => c._id);
  const [defaultedBondCorpIds, allSectors, designatedTypes] = await Promise.all([
    db.collection<Bond>("bonds").distinct("corporationId", {
      corporationId: { $in: corpIds },
      defaulted: true,
      matured: false,
    }),
    db
      .collection<CorporateSector>("corporateSectors")
      .find({ corporationId: { $in: corpIds } })
      .toArray(),
    getDesignatedSectorTypes(db, countryId),
  ]);
  const corpIdsWithDefaultedBond = new Set(defaultedBondCorpIds.map((id) => String(id)));

  const sectorsByCorpId = new Map<string, CorporateSector[]>();
  for (const sector of allSectors) {
    const key = String(sector.corporationId);
    const bucket = sectorsByCorpId.get(key);
    if (bucket) bucket.push(sector);
    else sectorsByCorpId.set(key, [sector]);
  }

  // One set of queries covering every (state, sectorType) bucket the corps
  // span; same canonical share computation as the per-sector helper.
  const shareBySectorId = await fetchMarketSharePercentForSectors(db, allSectors);

  for (const corp of corps) {
    const key = String(corp._id);
    const sectors = sectorsByCorpId.get(key) ?? [];

    const ownerKind: "player" | "npc" = corp.userId != null ? "player" : "npc";
    const hasDefaultedBond = corpIdsWithDefaultedBond.has(key);
    const ceoVacantTurns =
      corp.ceoVacant && corp.ceoVacantSinceTurn != null
        ? Math.max(0, currentTurn - corp.ceoVacantSinceTurn)
        : 0;
    const strategicSectorMatch = corpHasStrategicSector(designatedTypes, countryId, sectors);
    let topMarketSharePercent = 0;
    for (const sector of sectors) {
      const pct = shareBySectorId.get(String(sector._id)) ?? 0;
      if (pct > topMarketSharePercent) topMarketSharePercent = pct;
    }

    const financialDistressTurns =
      corp.financialDistressSinceTurn != null
        ? Math.max(0, currentTurn - corp.financialDistressSinceTurn)
        : 0;

    const result = evaluateEligibility({
      ownerKind,
      liquidCapital: corp.liquidCapital,
      hasDefaultedBond,
      ceoVacantTurns,
      currentTurn,
      strategicSectorMatch,
      topMarketSharePercent,
      supermajorityVotePassed: false,
      financialDistressTurns,
    });

    const executivelyTakeable =
      ownerKind === "npc" || (ownerKind === "player" && result.isDistressed);

    resolved.set(key, { ownerKind, result, executivelyTakeable, sectorCount: sectors.length });
  }

  return resolved;
}

/**
 * Shared eligibility resolution for a single corporation, fetching the snapshot
 * the pure `evaluateEligibility` needs. Used by the executive nationalize route
 * and the eligible-targets read route so the two never drift (both go through
 * `resolveCorpEligibilityBatch`).
 */
export async function resolveCorpEligibility(
  db: Db,
  countryId: CountryId,
  corp: Corporation,
  currentTurn: number
): Promise<ResolvedCorpEligibility> {
  const batch = await resolveCorpEligibilityBatch(db, countryId, [corp], currentTurn);
  // The batch resolver sets an entry for every input corp, so this is total.
  return batch.get(String(corp._id))!;
}
