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
import { loadFxRatesByCurrency } from "@/lib/currency/corporationCapital";
import { buildNppPriceSignals } from "@/lib/turn/npp/priceSignals";
import { ESSENTIAL_SHORTAGE_SCORE } from "@/lib/turn/npp/marketSignals";

/** The lane the pass may found, with the commodity whose shortage triggers it. */
export const NATIONAL_SHORTAGE_FOUNDING_LANE = {
  lane: "media_entertainment" as const satisfies OperatingSectorType,
  sectorType: "media" as const,
  mediaDiscriminator: "entertainment" as const,
  commodity: "entertainment_services" as const satisfies CommodityType,
};

/** Founders tried per country, wealthiest first, before giving up for the sweep. */
export const NATIONAL_SHORTAGE_FOUNDER_TRIES = 5;

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
  const spec = NATIONAL_SHORTAGE_FOUNDING_LANE;
  const starter = foundingStarterUnits(spec.sectorType, null, spec.mediaDiscriminator);
  if (!(starter > 0)) return [];
  const [blockedSet, priceDocs, pools, laneSectors, fx] = await Promise.all([
    loadPrivateEnterpriseBlockedCountries(db),
    db.collection<CommodityPrice>("commodityPrices").find({}).toArray(),
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
    loadFxRatesByCurrency(db),
  ]);
  const { priceRatioOf } = buildNppPriceSignals(new Map(priceDocs.map((p) => [p.commodity, p])));
  const laneByCountry = new Map(laneSectors.map((r) => [r._id, r.n]));
  const fittingByCountry = new Map<string, number>();
  for (const p of pools) {
    if (typeof p.headroomUnits === "number" && p.headroomUnits >= starter) {
      fittingByCountry.set(p.countryId, (fittingByCountry.get(p.countryId) ?? 0) + 1);
    }
  }
  const targets = [...fittingByCountry].filter(([countryId, fittingPools]) =>
    shouldFoundForNationalShortage({
      countryId: countryId as CountryId,
      priceRatio: priceRatioOf(spec.commodity, countryId),
      fittingPools,
      laneSectors: laneByCountry.get(countryId) ?? 0,
      blocked: blockedSet.has(countryId as CountryId),
    })
  );
  if (targets.length === 0) return [];

  // One read for every target country's founders, wealthiest first.
  const npps = await db
    .collection<NPP>("npps")
    .find(
      {
        retiredAt: null,
        countryId: { $in: targets.map(([countryId]) => countryId as CountryId) },
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
    .toArray();
  const foundersByCountry = new Map<string, typeof npps>();
  for (const npp of npps) {
    const key = npp.countryId ?? "";
    const list = foundersByCountry.get(key) ?? [];
    if (list.length < NATIONAL_SHORTAGE_FOUNDER_TRIES) list.push(npp);
    foundersByCountry.set(key, list);
  }

  const founded: Array<{ countryId: CountryId; lane: OperatingSectorType }> = [];
  for (const [countryId] of targets) {
    const homeRate = await nppHomeFxRate(db, countryId, fx, preset);
    for (const npp of foundersByCountry.get(countryId) ?? []) {
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
  return founded;
}
