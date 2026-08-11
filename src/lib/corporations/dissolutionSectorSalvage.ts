import type { Db } from "mongodb";
import type { CorporateSector, Corporation } from "@/lib/db/types";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { sumCorporateSectorNpv } from "@/lib/bonds/corporateCredit";
import { buildPrimeRateByCountry } from "@/lib/centralBank/helpers";
import { DISSOLUTION_SECTOR_SALVAGE_FRACTION } from "@/lib/constants/corporations";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { getGameState } from "@/lib/gameState";
import { sumSectorBookValueAnchor } from "@/lib/corporations/sectorProfitBasis";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";

/**
 * Salvage value (in ₳) a dissolving corp recovers from its operating sectors.
 *
 * On dissolution the sectors are abandoned to the unowned market — there is no
 * going-concern buyer — so only {@link DISSOLUTION_SECTOR_SALVAGE_FRACTION} of
 * their value is realized as cash for the payout pool. Paying the full value
 * would mint the corp's enterprise value (the money-laundering exploit the
 * salvage haircut exists to prevent).
 *
 * The valued quantity depends on the market tier (D11):
 *   - below "plants": capitalized going-concern NPV, as it always was;
 *   - at/above "plants": replacement-cost BOOK of the sector's built capacity
 *     plus any construction still in progress. Under plants a sector IS its
 *     plant, and settling exits at book is what makes build-then-dissolve a
 *     guaranteed loss rather than a mint.
 *
 * This mirrors the bond-default dissolution settlement
 * ({@link previewDissolveSettlement}); the voluntary CEO dissolve route and its
 * preview share this helper so the quoted and executed payouts match exactly.
 *
 * Returns 0 for a corp with no positive-NPV (or no built) sectors.
 */
export async function computeDissolutionSectorSalvageAnchor(
  db: Db,
  corporation: Corporation,
  fxByCurrency: ReadonlyMap<CurrencyCode, number>
): Promise<number> {
  const [sectors, centralBanks, marketMode] = await Promise.all([
    db
      .collection<CorporateSector>("corporateSectors")
      .find({ corporationId: corporation._id })
      .toArray(),
    db.collection<CentralBank>("centralBanks").find({}).toArray(),
    getMarketSystemModeForDb(db),
  ]);
  const plantsEnabled = marketAtLeast(marketMode, "plants");

  if (plantsEnabled) {
    // Year read only on the book path — the legacy NPV path keeps its old query set.
    const gameState = await getGameState(db);
    const bookAnchor = sumSectorBookValueAnchor(
      sectors,
      gameState?.currentYear,
      await loadWorldEraUnitScale(db)
    );
    return DISSOLUTION_SECTOR_SALVAGE_FRACTION * Math.max(0, bookAnchor);
  }

  // Member-aware: shared-bank members (IE → ECB) must resolve the shared doc.
  const primeRateByCountry = buildPrimeRateByCountry(centralBanks);
  const sectorNpvAnchor = sumCorporateSectorNpv(
    sectors,
    corporation._id,
    primeRateByCountry,
    corporation,
    fxByCurrency
  );
  return DISSOLUTION_SECTOR_SALVAGE_FRACTION * Math.max(0, sectorNpvAnchor);
}
