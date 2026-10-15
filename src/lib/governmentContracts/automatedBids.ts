/**
 * State and NPP suppliers compete through the same defence tenders as players.
 * Their initial quote uses the existing suggested lot price, with no direct-award shortcut.
 */
import type { Db } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import { isNppOwned } from "@/lib/corporations/nppOwned";
import { resolveFillEligibility } from "@/lib/military/defenceFillEligibility";
import { lotPrice } from "@/lib/military/arsenal";
import { militaryPriceAnchor } from "@/lib/military/procurement";
import { lotPriceBand, lotProductionCost } from "@/lib/military/defenceLotEconomics";
import { loadDefencePriceRatios } from "@/lib/military/defencePriceRatios";
import { ensureFederalBudget } from "@/lib/turn/ensureFederalBudget";
import { getGameState } from "@/lib/gameState";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { maxTechTierForPreset } from "@/lib/admin/seed/seedMilitaryUnits";
import { resolveGameYear } from "@/lib/era/era";
import { getStartingYearForPreset, TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import type { GovernmentTender, ContractBid } from "./types";
export async function automatedDefenceBids(
  db: Db,
  t: GovernmentTender
): Promise<Record<string, ContractBid>> {
  if (t.terms.type !== "defence") return {};
  const terms = t.terms;
  const [corps, sectors, state, ratios] = await Promise.all([
    db
      .collection<Corporation>("corporations")
      .find(
        { countryId: t.countryId },
        {
          projection: {
            name: 1,
            countryId: 1,
            liquidCurrencyCode: 1,
            unlockedTechNodeIds: 1,
            techDecadeLane: 1,
            ownershipState: 1,
            countryOwnerId: 1,
            ceoType: 1,
            caretakerCeo: 1,
          },
        }
      )
      .toArray(),
    db
      .collection<CorporateSector>("corporateSectors")
      .find(
        { sectorType: "defense" },
        { projection: { corporationId: 1, strategyId: 1, revenue: 1 } }
      )
      .toArray(),
    getGameState(db),
    loadDefencePriceRatios(db),
  ]);
  const budget = await ensureFederalBudget(db, t.countryId, state?.preset ?? DEFAULT_SEED_PRESET);
  if (!budget) return {};
  const anchor = lotPrice(
    t.countryId,
    militaryPriceAnchor(budget.gdp, budget.militaryPriceBaselineGdp)
  );
  if (anchor == null) return {};
  const bids: Record<string, ContractBid> = {};
  for (const corp of corps.filter((c) => isStateOwned(c) || isNppOwned(c))) {
    for (const sector of sectors.filter((s) => s.corporationId.equals(corp._id))) {
      const fill = resolveFillEligibility({
        corp,
        sector,
        countryId: t.countryId,
        currentYear:
          resolveGameYear(state ?? {}) ??
          getStartingYearForPreset(state?.preset ?? DEFAULT_SEED_PRESET) +
            Math.floor((t.publishedTurn - 1) / TURNS_PER_YEAR),
        component: terms.component,
      });
      const cost = lotProductionCost(sector.strategyId, anchor, ratios);
      const band =
        cost == null
          ? null
          : lotPriceBand({ anchorPrice: anchor, productionCost: cost, grade: terms.grade });
      if (
        !fill.eligible ||
        fill.gradeCeiling < terms.grade ||
        terms.grade > maxTechTierForPreset(state?.preset ?? DEFAULT_SEED_PRESET) ||
        !band ||
        band.floor > terms.maximumPricePerLot
      )
        continue;
      const amount = Math.min(band.suggested, terms.maximumPricePerLot);
      const id = corp._id.toHexString();
      if (!bids[id] || amount < bids[id].amount)
        bids[id] = {
          corporationId: id,
          corporationName: corp.name,
          userId: "system",
          system: true,
          sectorId: sector._id.toHexString(),
          amount,
          submittedTurn: t.publishedTurn,
          revision: 1,
          withdrawn: false,
        };
    }
  }
  return bids;
}
