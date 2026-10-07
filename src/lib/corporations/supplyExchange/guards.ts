import type { Db } from "mongodb";
import type { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api/errors";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isCurtained } from "@/lib/constants/commandEconomy";
import { COUNTRY_ORDER } from "@/lib/constants/countries";
import type { CommodityType } from "@/lib/constants/commodities";
import type { Corporation } from "@/lib/db/types/corporation";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import type { GameState } from "@/lib/db/types/gameState";
import type { TradeEmbargo } from "@/lib/db/types/tradeEmbargo";
import { buildTradeAffinity } from "@/lib/trade/tradeAffinity";
import { RELATED_PARTY_MESSAGE, resolveRelatedParty, type RelatedPartyCorp } from "./relatedParty";

/**
 * Gates shared by every way a supply contract can be opened or changed:
 * propose, counter, amend, accept and take.
 */

/** Feature flag, corporation-actions kill switch and a per-user rate limit. */
export async function requireSupplyExchangeAccess(
  db: Db,
  userId: string
): Promise<NextResponse | null> {
  const config = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { supplyAgreementsEnabled: 1 } });
  if (!config?.supplyAgreementsEnabled) {
    return errorResponse(403, "Supply agreements are not enabled.");
  }
  const paused = await requireCorporationActionsEnabled(db);
  if (paused) return paused;
  const limit = checkRateLimit(`supply-agreements:${userId}`, 30, 60000);
  if (!limit.ok) return rateLimitResponse(limit.retryAfter);
  return null;
}

/**
 * Is the lane between two countries closed for this commodity? An embargo in
 * either direction or the iron curtain closes it. Same-country trade is always
 * open. This reads the clearing engine's own affinity function, so a lane the
 * market treats as shut is never open to a contract.
 */
export async function isSupplyLaneClosed(
  db: Db,
  args: {
    supplierCountry: string | undefined;
    buyerCountry: string | undefined;
    commodity: CommodityType;
  }
): Promise<boolean> {
  const { supplierCountry, buyerCountry, commodity } = args;
  if (!supplierCountry || !buyerCountry || supplierCountry === buyerCountry) return false;
  const [world, config] = await Promise.all([
    db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" }, { projection: { currentTurn: 1, currentYear: 1 } }),
    db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { commandEconomyEnabled: 1 } }),
  ]);
  const turn = world?.currentTurn ?? 0;
  const embargoes = await db
    .collection<TradeEmbargo>("tradeEmbargoes")
    .find({
      $and: [
        { $or: [{ expiresTurn: { $exists: false } }, { expiresTurn: { $gte: turn } }] },
        {
          $or: [
            { sourceCountry: supplierCountry, targetCountry: buyerCountry },
            { sourceCountry: buyerCountry, targetCountry: supplierCountry },
          ],
        },
      ],
    })
    .toArray();
  const curtainedCountries = new Set<string>(
    COUNTRY_ORDER.filter((c) =>
      isCurtained(c, world?.currentYear ?? null, config?.commandEconomyEnabled === true)
    )
  );
  const { affinityFor } = buildTradeAffinity({
    ftaPairs: new Set(),
    blocsByCountry: new Map(),
    tariffs: [],
    embargoes,
    curtainedCountries,
  });
  return affinityFor(commodity, supplierCountry, buyerCountry) <= 0;
}

type GuardedCorp = RelatedPartyCorp & Pick<Corporation, "countryId">;

/** Related-party and embargo-lane checks. Returns a player-facing error, or null when clear. */
export async function checkSupplyContractParties(
  db: Db,
  args: { supplier: GuardedCorp; buyer: GuardedCorp; commodity: CommodityType }
): Promise<string | null> {
  const { supplier, buyer, commodity } = args;
  if (resolveRelatedParty(supplier, buyer)) return RELATED_PARTY_MESSAGE;
  if (
    await isSupplyLaneClosed(db, {
      supplierCountry: supplier.countryId,
      buyerCountry: buyer.countryId,
      commodity,
    })
  ) {
    return `Trade in ${commodity} between ${supplier.countryId} and ${buyer.countryId} is closed by an embargo or the iron curtain, so these corporations cannot contract.`;
  }
  return null;
}
