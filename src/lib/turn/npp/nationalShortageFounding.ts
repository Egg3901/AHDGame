/**
 * National-shortage founding: a bounded pass that founds one NPP corporation
 * for an allowlisted lane in a country where that lane's output is badly short
 * and no corporation runs the lane at all.
 *
 * The general founding sweep draws from the 300 wealthiest NPPs worldwide and
 * founds inside the founder's own country, so a country whose NPPs are all
 * poorer than that cut never gets a new firm in an empty market (live t199:
 * Russia had no media sector at all while entertainment services cleared at
 * 3.3x base, and none of its NPPs reached the global pool). A founded firm
 * then grows across the country's open pools through ordinary entry.
 */
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CommodityType } from "@/lib/constants/commodities";
import type { OperatingSectorType } from "@/lib/constants/corporations";
import type { CommodityPrice } from "@/lib/db/types/commodityPrice";
import type { CorporateSector } from "@/lib/db/types/corporation";
import type { NPP } from "@/lib/db/types/npp";
import type { UnownedSector } from "@/lib/db/types/unownedSector";
import { foundingStarterUnits } from "@/lib/corporations/foundingPlant";
import { loadPrivateEnterpriseBlockedCountries } from "@/lib/economy/queries/privateEnterpriseGate";
import { nppFoundCorporation } from "@/lib/nppAutonomy/v3/finance/nppFoundCorporation";
import { nppHomeFxRate } from "@/lib/nppAutonomy/v3/finance/nppEconomicAccount";
import { buildNppPriceSignals } from "@/lib/turn/npp/priceSignals";
import { ESSENTIAL_SHORTAGE_SCORE } from "@/lib/turn/npp/marketSignals";

/** Lanes the pass may found, with the commodity whose shortage triggers it. */
export const NATIONAL_SHORTAGE_FOUNDING_LANES: ReadonlyArray<{
  lane: OperatingSectorType;
  sectorType: "media";
  mediaDiscriminator: "entertainment";
  commodity: CommodityType;
}> = [
  {
    lane: "media_entertainment",
    sectorType: "media",
    mediaDiscriminator: "entertainment",
    commodity: "entertainment_services",
  },
];

export interface NationalShortageCandidate {
  countryId: CountryId;
  priceRatio: number | null;
  /** Open pools in the country whose headroom fits at least one starter plant. */
  fittingPools: number;
  /** Sectors in the country already running the lane (any owner). */
  laneSectors: number;
  blocked: boolean;
}

/** Pure gate: should this country get a founding for the lane this sweep? */
export function shouldFoundForNationalShortage(c: NationalShortageCandidate): boolean {
  if (c.blocked) return false;
  if (c.laneSectors > 0) return false;
  if (c.fittingPools <= 0) return false;
  return typeof c.priceRatio === "number" && c.priceRatio >= ESSENTIAL_SHORTAGE_SCORE;
}

/**
 * Run the pass. At most one founding per (country, lane) per sweep; the
 * founder is the country's wealthiest unretired NPP that is not already a CEO
 * and can pay the fee. Returns the countries founded in, for telemetry.
 */
export async function foundNppNationalShortageCorporations(
  db: Db,
  currentTurn: number,
  foundingFeeAnchor: number,
  preset?: string
): Promise<Array<{ countryId: CountryId; lane: OperatingSectorType }>> {
  const founded: Array<{ countryId: CountryId; lane: OperatingSectorType }> = [];
  const blockedSet = await loadPrivateEnterpriseBlockedCountries(db);
  const priceDocs = await db.collection<CommodityPrice>("commodityPrices").find({}).toArray();
  const { priceRatioOf } = buildNppPriceSignals(new Map(priceDocs.map((p) => [p.commodity, p])));

  for (const spec of NATIONAL_SHORTAGE_FOUNDING_LANES) {
    const starter = foundingStarterUnits(spec.sectorType, null, spec.mediaDiscriminator);
    const [pools, laneSectors] = await Promise.all([
      db
        .collection<UnownedSector>("unownedSectors")
        .find(
          { sectorType: spec.sectorType, mediaDiscriminator: spec.mediaDiscriminator },
          { projection: { countryId: 1, headroomUnits: 1 } }
        )
        .toArray(),
      db
        .collection<CorporateSector>("corporateSectors")
        .aggregate<{ _id: string; n: number }>([
          { $match: { sectorType: spec.sectorType, mediaDiscriminator: spec.mediaDiscriminator } },
          { $group: { _id: "$countryId", n: { $sum: 1 } } },
        ])
        .toArray(),
    ]);
    const laneByCountry = new Map(laneSectors.map((r) => [r._id, r.n]));
    const fittingByCountry = new Map<string, number>();
    for (const p of pools) {
      if (typeof p.headroomUnits === "number" && p.headroomUnits >= starter && starter > 0) {
        fittingByCountry.set(p.countryId, (fittingByCountry.get(p.countryId) ?? 0) + 1);
      }
    }
    for (const [countryId, fittingPools] of fittingByCountry) {
      const candidate: NationalShortageCandidate = {
        countryId: countryId as CountryId,
        priceRatio: priceRatioOf(spec.commodity, countryId),
        fittingPools,
        laneSectors: laneByCountry.get(countryId) ?? 0,
        blocked: blockedSet.has(countryId as CountryId),
      };
      if (!shouldFoundForNationalShortage(candidate)) continue;
      const npps = await db
        .collection<NPP>("npps")
        .find(
          {
            retiredAt: null,
            countryId,
            nppInvestmentCashAnchor: { $gte: foundingFeeAnchor },
          },
          {
            projection: {
              countryId: 1,
              party: 1,
              homeState: 1,
              personality: 1,
              nppInvestmentCashAnchor: 1,
            },
          }
        )
        .sort({ nppInvestmentCashAnchor: -1 })
        .limit(5)
        .toArray();
      if (npps.length === 0) continue;
      const homeRate = await nppHomeFxRate(db, countryId, undefined, preset);
      for (const npp of npps) {
        // nppFoundCorporation refuses a sitting CEO and re-checks affordability.
        const outcome = await nppFoundCorporation(
          db,
          npp,
          spec.lane,
          foundingFeeAnchor * homeRate,
          currentTurn,
          homeRate,
          blockedSet,
          preset
        );
        if (outcome.ok) {
          founded.push({ countryId: countryId as CountryId, lane: spec.lane });
          break;
        }
      }
    }
  }
  return founded;
}
