/**
 * Legislative privatization (spec §13.5): the enactment of a `privatize` bill
 * provision. Passage IS the authorization — no eligibility gate. Carves the
 * selected sectors out of the cited National Corporation via `privatizeAsset`
 * (IPO method in P5a). Guards: source exists, is state-owned, and belongs to the
 * bill's country. Each selection's carve fraction is clamped to the enactment-time
 * anti-monopoly cap (spec §13.1) — the bill editor promises a dominant holding is
 * "capped lower", not voided. Remaining engine errors are logged but swallowed so
 * a bad provision cannot abort the rest of the bill's enactment — mirrors the
 * nationalize handler's resilience.
 */
import type { Db } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { PrivatizeProvision } from "@/lib/db/types/legislation";
import type { CountryId } from "@/lib/constants/countries";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { fetchSectorMarketSharePercent } from "@/lib/corporations/marketShare";
import { isStateOwned } from "./nationalCorporation";
import { maxCarveFractionForMarketShare } from "./constants";
import { privatizeAsset } from "./privatizeAsset";

export async function applyPrivatizeProvision(
  db: Db,
  countryId: CountryId,
  provision: PrivatizeProvision
): Promise<void> {
  const source = await db
    .collection<Corporation>("corporations")
    .findOne({ _id: provision.sourceNationalCorporationId });
  if (!source || !isStateOwned(source) || source.countryOwnerId !== countryId) return;

  const turn = await getCurrentTurn(db);

  // Anti-monopoly clamp (spec §13.1): a spin-out may not exceed the market-control
  // cap of its regional market, so a bill carving 100% of a dominant holding is
  // capped down to the largest legal fraction rather than rejected outright — a
  // passed law must not void silently. Uses the same per-sector share computation
  // `privatizeAsset` validates against so the clamped value always passes.
  const sectors = db.collection<CorporateSector>("corporateSectors");
  const selections: PrivatizeProvision["selections"] = [];
  for (const sel of provision.selections) {
    const sector = await sectors.findOne({ _id: sel.sectorId, corporationId: source._id });
    if (!sector) {
      // Unknown/foreign sector: pass through untouched so privatizeAsset rejects
      // the provision with its own ownership error (logged below).
      selections.push(sel);
      continue;
    }
    const sharePct = await fetchSectorMarketSharePercent(db, sector, source);
    const maxFraction = maxCarveFractionForMarketShare(sharePct);
    selections.push({
      sectorId: sel.sectorId,
      carveFraction: Math.min(sel.carveFraction, maxFraction),
    });
  }

  try {
    await privatizeAsset(db, {
      countryId,
      sourceNationalCorporationId: source._id,
      selections,
      newCorpName: provision.newCorpName,
      goldenSharePercent: provision.goldenSharePercent,
      method: provision.method ?? "ipo",
      reservePrice: provision.reservePrice,
      turn,
    });
  } catch (err) {
    // A failed carve (name taken, cooldown, bad sector) must not abort the rest
    // of the bill's enactment — but it must be visible in error telemetry.
    console.error(
      `[legislativePrivatize] privatize provision failed for ${countryId} ` +
        `(source ${source._id.toHexString()}, "${provision.newCorpName}"):`,
      err
    );
  }
}
