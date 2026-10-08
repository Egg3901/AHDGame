/**
 * Loads everything the studio and its write routes need in one place, so the
 * routes stay thin and agree on flags, eligibility and revenue figures.
 */
import { ObjectId, type Db } from "mongodb";
import { getGameState } from "@/lib/gameState";
import { getCurrentTurn } from "@/lib/currentTurn";
import { loadFxRatesByCurrency } from "@/lib/currency/corporationCapital";
import { getMarketSystemMode, marketAtLeast } from "@/lib/market/featureFlag";
import type { Corporation, CorporateSector, GameConfig } from "@/lib/db/types";
import { PRODUCT_VENTURES } from "./store";
import type { ProductVenture, VentureDomain } from "./types";

export async function ventureDomainsEnabled(db: Db): Promise<Record<VentureDomain, boolean>> {
  const config = await db
    .collection<GameConfig>("gameConfig")
    .findOne(
      { _id: "default" },
      {
        projection: { marketSystemMode: 1, productLinesV2Enabled: 1, mediaProductSlatesEnabled: 1 },
      }
    );
  const mode = await getMarketSystemMode(config);
  return {
    media: config?.mediaProductSlatesEnabled === true,
    manufacturing: config?.productLinesV2Enabled === true && marketAtLeast(mode, "plants"),
  };
}

export async function loadVentureContext(db: Db, corporation: Corporation) {
  const [sectors, ventures, fxByCurrency, turn, gameState, enabled] = await Promise.all([
    db
      .collection<CorporateSector>("corporateSectors")
      .find({ corporationId: corporation._id })
      .toArray(),
    db
      .collection<ProductVenture>(PRODUCT_VENTURES)
      .find({ corporationId: corporation._id.toString() })
      .sort({ startedTurn: -1 })
      .limit(40)
      .toArray(),
    loadFxRatesByCurrency(db),
    getCurrentTurn(db),
    getGameState(db),
    ventureDomainsEnabled(db),
  ]);
  const eligibility = {
    currentYear: gameState?.currentYear,
    techTreesEnabled: gameState?.sectorTechTreesEnabled === true,
    unlockedTechNodeIds: corporation.unlockedTechNodeIds,
    techDecadeLane: corporation.techDecadeLane,
  };
  return {
    sectors,
    ventures,
    fxByCurrency,
    turn,
    currentYear: gameState?.currentYear,
    eligibility,
    enabled,
  };
}

export function newVentureId(): string {
  return new ObjectId().toString();
}
