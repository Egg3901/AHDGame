import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { CentralBank, Corporation, CorporateSector } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import { loadFxRatesByCurrency } from "@/lib/currency/corporationCapital";
import { writeGovBudgetLocal } from "@/lib/currency/govBudgetFields";
import { buildPrimeRateMap, computeSectorNpvSum } from "@/lib/bonds/corporateBondDefault";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { getGameState } from "@/lib/gameState";
import { sectorBookValueAnchor } from "@/lib/corporations/sectorProfitBasis";
import { carveSectorPlantFields } from "@/lib/corporations/sectorTransferCapex";
import { seedPlantLedger, splitWholePlantCount } from "@/lib/corporations/plantLedger";
import { NATIONALIZATION_BOOK_PREMIUM } from "./constants";
import { getNextSequentialId } from "@/lib/db/sequentialId";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";
import { isStateOwned, ensurePrimaryNationalCorporation } from "./nationalCorporation";
import { computeSpunOutShareStructure } from "./privatizationShares";
import { creditTreasuryProceeds } from "./treasury";
import { applyPrivatizationConsequences } from "./consequences/apply";
import { recordNationalizationLedger } from "./ledger";
import { notifyCountryResidents } from "./privatizationNotifications";
import { logWireEvent, wireHeadlineCorpPrivatized } from "@/lib/wireEvent";
import type { NationalizationAuction } from "@/lib/db/types";
import {
  AUCTION_WINDOW_TURNS,
  CARVE_FRACTION_MIN,
  PRIVATIZE_MARKET_CONTROL_CAP,
  maxCarveFractionForMarketShare,
  REPRIVATIZE_COOLDOWN_TURNS,
} from "./constants";
import { fetchSectorMarketSharePercent } from "@/lib/corporations/marketShare";
import { pickOrCreateNppCeoForNewCorp } from "@/lib/corporations/subsidiaries/nppCeoSelection";
import { getDefaultLegalStructureId } from "@/lib/corporations/legalStructure";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";

export interface CarveSelection {
  sectorId: ObjectId;
  /** Fraction of the sector's revenue/workers carved out: CARVE_FRACTION_MIN ≤ f ≤ 1. */
  carveFraction: number;
}

export interface PrivatizeAssetParams {
  countryId: CountryId;
  /** The National Corporation the sectors are carved out of. */
  sourceNationalCorporationId: ObjectId;
  selections: CarveSelection[];
  newCorpName: string;
  /** State-retained golden-share fraction (clamped to GOLDEN_SHARE_MAX downstream). */
  goldenSharePercent: number;
  /** "ipo" floats immediately + credits the treasury; "auction" opens a NationalizationAuction. */
  method: "ipo" | "auction";
  /** Auction reserve in country currency; defaults to the carve valuation. Auction only. */
  reservePrice?: number;
  /**
   * IPO headquarters region (a region of `countryId`). Defaults to the first
   * carved sector's region; validated against the country's regions. Auction
   * shells are relocated to the winner's region on sale, so this is IPO-only.
   */
  headquartersState?: string;
  turn: number;
}

export interface PrivatizeAssetResult {
  newCorporationId: ObjectId;
  sectorsCarved: number;
  totalShares: number;
  goldenShares: number;
  /** IPO: float proceeds credited to the treasury. Auction: 0 (proceeds arrive at sale). */
  proceedsLocal: number;
  /** Set when method === "auction". */
  auctionId?: ObjectId;
}

/**
 * Carve a new private corporation out of a National Corporation (spec §13.1–§13.3),
 * the inverse of `nationalizeWholeCorp`. Values the carve with the canonical sector
 * NPV, issues a standard share structure (golden share held by the primary NatCorp),
 * and clones each selected sector slice (≤30% anti-monopoly cap) onto the new corp
 * while shrinking the source row. Two distribution methods:
 *   - "ipo": shares float immediately; the divestiture proceeds credit the treasury.
 *   - "auction": a suspended, 100%-state-held shell is created and a
 *     NationalizationAuction is opened; ownership + proceeds settle at sale.
 * The spun-out corp is private from birth and earns from the carved sector
 * (liquidCapital starts at 0 — the proceeds are the government's, not the corp's).
 */
export async function privatizeAsset(
  db: Db,
  params: PrivatizeAssetParams
): Promise<PrivatizeAssetResult> {
  const now = new Date();
  const corps = db.collection<Corporation>("corporations");
  const sectors = db.collection<CorporateSector>("corporateSectors");

  if (params.selections.length === 0) throw new Error("No sectors selected to privatize");
  // Reject duplicate sector selections — otherwise a repeated id double-counts the
  // valuation and carves the same row twice.
  const seenSectorIds = new Set(params.selections.map((s) => s.sectorId.toString()));
  if (seenSectorIds.size !== params.selections.length) {
    throw new Error("Duplicate sector selected to privatize");
  }

  // ── 1. Source must be a state-owned National Corporation of this country. ──
  const source = await corps.findOne({ _id: params.sourceNationalCorporationId });
  if (!source || !isStateOwned(source) || source.countryOwnerId !== params.countryId) {
    throw new Error("Source National Corporation not found for this country");
  }

  // ── 2. Load + validate the selected sectors (fraction, ownership, cooldown). ──
  const selected: { sector: CorporateSector; fraction: number }[] = [];
  for (const sel of params.selections) {
    const fraction = sel.carveFraction;
    const sector = await sectors.findOne({ _id: sel.sectorId });
    if (!sector || !sector.corporationId.equals(source._id)) {
      throw new Error("Sector is not owned by the source National Corporation");
    }
    if (
      sector.absorbedAtTurn != null &&
      params.turn - sector.absorbedAtTurn < REPRIVATIZE_COOLDOWN_TURNS
    ) {
      throw new Error("Sector is within the re-privatization cooldown");
    }
    // Anti-monopoly cap (spec §13.1): the carved corp may not end up controlling
    // more than PRIVATIZE_MARKET_CONTROL_CAP of the whole (state, sectorType)
    // market. Its resulting share = fraction × the NatCorp's current share, so a
    // small holding can be spun out in full; a dominant one is limited.
    const sharePct = await fetchSectorMarketSharePercent(db, sector, source);
    const maxFraction = maxCarveFractionForMarketShare(sharePct);
    if (!(fraction >= CARVE_FRACTION_MIN && fraction <= maxFraction + 1e-6)) {
      throw new Error(
        `Carve fraction for ${sector.sectorType} (${sector.stateId}) must be ${Math.round(
          CARVE_FRACTION_MIN * 100
        )}%–${Math.round(maxFraction * 100)}% — a spin-out may not exceed ${Math.round(
          PRIVATIZE_MARKET_CONTROL_CAP * 100
        )}% of the regional market.`
      );
    }
    selected.push({ sector, fraction });
  }

  // ── 3. Name uniqueness (case-insensitive), matching the founding route. ──
  const name = params.newCorpName.trim();
  if (name.length < 2) throw new Error("New corporation name is too short");
  const nameTaken = await corps.findOne({
    name: { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
  });
  if (nameTaken) throw new Error("That corporation name is already taken");

  // ── 4. Value the carve: per-sector full value × fraction (₳), summed → local. ──
  const [centralBanks, fxByCurrency, marketMode, gameState] = await Promise.all([
    db.collection<CentralBank>("centralBanks").find({}).toArray(),
    loadFxRatesByCurrency(db),
    getMarketSystemModeForDb(db),
    getGameState(db),
  ]);
  const primeMap = buildPrimeRateMap(centralBanks);
  // D11 SYMMETRY — the state must SELL on the same basis it BUYS on.
  //
  // Under plants a taking pays NATIONALIZATION_BOOK_PREMIUM × replacement-cost
  // book (see `sectorCompensationValuationAnchor` / `applyTier`). Leaving the
  // sale side on going-concern NPV opened a directional arbitrage that runs in
  // whichever direction the two bases happen to disagree: nationalize a sector
  // at 1.5× book, re-privatize it at NPV, pocket the spread — and for a
  // profitable sector NPV is comfortably above 1.5× book, so the loop is a
  // money printer the state can run on itself, at will, forever. Pricing the
  // sale at the identical premium × book makes a nationalize→privatize
  // round-trip cash-neutral by construction, which is the only property that
  // closes the loop for every sector rather than for the ones we sampled.
  //
  // Below plants this is untouched: NPV on both sides, as before.
  const plantsEnabled = marketAtLeast(marketMode, "plants");
  const privatizeUnitScale = plantsEnabled ? await loadWorldEraUnitScale(db) : 1;
  let valuationAnchor = 0;
  for (const { sector, fraction } of selected) {
    const fullValueAnchor = plantsEnabled
      ? sectorBookValueAnchor(sector, gameState?.currentYear, privatizeUnitScale) *
        NATIONALIZATION_BOOK_PREMIUM
      : computeSectorNpvSum([sector], primeMap, source, fxByCurrency);
    valuationAnchor += fullValueAnchor * fraction;
  }
  const currency = (source.liquidCurrencyCode ??
    COUNTRY_CURRENCY_MAP[params.countryId] ??
    "USD") as CurrencyCode;
  const rate = fxByCurrency.get(currency) ?? 1;
  const valuationLocal = writeGovBudgetLocal(valuationAnchor, currency, rate);

  // ── 5. Cap table. ──
  const structure = computeSpunOutShareStructure({
    valuationLocal,
    goldenSharePercent: params.goldenSharePercent,
    preset: await getGameStatePresetOrDefault(db),
  });

  // Golden share is held by the country's PRIMARY NatCorp (dividends → treasury,
  // votes = reserved state block). Resolve it (source may itself be the primary).
  const primary = await ensurePrimaryNationalCorporation(db, params.countryId);

  // ── 6. Create the spun-out corp. IPO ⇒ private + floated from birth. Auction ⇒
  //       a suspended, hidden, 100%-state-held shell that transfers to the winner
  //       at sale (privatizedAtTurn is stamped then, not now). ──
  const isAuction = params.method === "auction";
  const firstSector = selected[0].sector;
  // HQ region for the spun-out corp: the caller may pick any region of the
  // country (IPO); defaults to the first carved sector's region. A provided
  // region must belong to the country. (Auction shells are relocated to the
  // winner's region on sale, so the selector is IPO-only in the UI.)
  let headquartersState = firstSector.stateId;
  if (params.headquartersState) {
    const region = await db
      .collection<{ _id: string; countryId: string }>("states")
      .findOne({ _id: params.headquartersState, countryId: params.countryId });
    if (!region) throw new Error("Invalid headquarters region for this country");
    headquartersState = params.headquartersState;
  }
  // An IPO spin-out is a live, listed company from turn one — assign an NPP
  // caretaker to run it (mirrors the subsidiary spinOff path) so it is NOT
  // treated as an abandoned vacant-CEO corp and bled 10%/turn back to the nat
  // corp by the vacant-CEO sector shed (the nat corp is exempt from that shed).
  // Auction shells stay vacant + suspended and fill the CEO seat on sale.
  const SYSTEM_USER = new ObjectId("000000000000000000000000");
  let ceoId = new ObjectId(); // auction shell: placeholder until the sale seats a CEO
  let ceoUserId = new ObjectId();
  let ceoVacant = true;
  let ceoType: "npp" | undefined;
  if (!isAuction) {
    ceoId = await pickOrCreateNppCeoForNewCorp(db, params.countryId, headquartersState);
    ceoUserId = SYSTEM_USER;
    ceoVacant = false;
    ceoType = "npp";
  }

  const sequentialId = await getNextSequentialId(db, "corporation");
  const newCorpId = new ObjectId();
  const newCorp: Omit<Corporation, "_id"> = {
    name,
    type: firstSector.sectorType,
    ceoId,
    ceoVacant,
    ...(ceoType ? { ceoType } : {}),
    userId: ceoUserId,
    countryId: params.countryId,
    headquartersState,
    liquidCapital: 0,
    liquidCurrencyCode: currency,
    marketingBudget: 0,
    marketingStrength: 10,
    logisticsBudget: 0,
    logisticsStrength: 0,
    totalShares: structure.totalShares,
    sharePrice: structure.sharePrice,
    shareholders: isAuction
      ? [{ corporationId: primary._id, shares: structure.totalShares }] // state holds 100% until sold
      : structure.goldenShares > 0
        ? [{ corporationId: primary._id, shares: structure.goldenShares }]
        : [],
    publicFloat: isAuction ? 0 : structure.floatShares,
    isPrivate: isAuction ? true : false,
    legalStructure: getDefaultLegalStructureId(params.countryId, {
      isPrivate: isAuction,
    }),
    ownershipState: "private",
    hiddenFromExchange: isAuction,
    ...(isAuction ? { suspended: true } : {}),
    ...(structure.goldenShares > 0
      ? { goldenSharePercent: structure.goldenShares / structure.totalShares }
      : {}),
    ...(isAuction ? {} : { privatizedAtTurn: params.turn, lastIpoTurn: params.turn }),
    foundedAtTurn: params.turn,
    sequentialId,
    createdAt: now,
    updatedAt: now,
  };
  await corps.insertOne({ ...(newCorp as Corporation), _id: newCorpId });

  // ── 7. Carve the sectors. Clone a fractional row onto the new corp and shrink
  //       the source row by the same fraction (the NatCorp keeps the remainder).
  //       A full carve (fraction 1.0, allowed when the holding is a small share
  //       of the market) leaves nothing behind, so the emptied source row is
  //       removed rather than kept at 0 revenue. A partial source row keeps its
  //       `absorbedAtTurn` so the re-privatization cooldown still applies. ──
  let sectorsCarved = 0;
  for (const { sector, fraction } of selected) {
    const keep = 1 - fraction;
    const keptRevenue = Math.round(sector.revenue * keep);
    // PLANTS-GATED: the two `revenue` writes below (the carved insert's
    // `revenue: Math.round(sector.revenue * fraction)` and the source row's
    // `revenue: keptRevenue`) are the LEGACY nameplate only. Under plants
    // `sectorTurn` restates both from `capitalStock × mix price` on the next
    // tick, so the quantity that actually moves is the plant state split
    // alongside them by `carveSectorPlantFields` at the identical fraction.
    // Writing revenue in lockstep keeps the two views agreeing for the turn
    // before the restatement, and keeps non-plants readers correct.
    //
    // Plant state splits by the same fraction as revenue/workers. Without this
    // the buyer paid a BOOK price (above) for capacity that stayed behind on
    // the NatCorp row: the carved sector would own zero plants, produce nothing
    // under plants, and value at zero the instant it changed hands — while the
    // seller kept 100% of the capacity it had just been paid for. `costPaidAnchor`
    // is ₳ and is split, never FX-rescaled (see sectorTransferCapex). The D13
    // `legacyRevenueShadow` restore point rides along in the same fold and is
    // split by the same fraction — without it the carved corp would land in the
    // rollback script's "no restore point, needs a human decision" bucket.
    const openingPlantCount = Number.isInteger(sector.plantCount)
      ? (sector.plantCount as number)
      : seedPlantLedger(sector.sectorType, sector.capitalStock).plantCount;
    const plantCountSplit = splitWholePlantCount(openingPlantCount, fraction);
    const carvedPlant = carveSectorPlantFields(sector, fraction, plantCountSplit.carved);
    const keptPlant = carveSectorPlantFields(sector, keep, plantCountSplit.kept);
    await sectors.insertOne({
      _id: new ObjectId(),
      corporationId: newCorpId,
      countryId: sector.countryId,
      stateId: sector.stateId,
      sectorType: sector.sectorType,
      targetGrowthRate: sector.targetGrowthRate,
      currentGrowthRate: sector.currentGrowthRate,
      currentGrowthCost: Math.round(sector.currentGrowthCost * fraction),
      revenue: Math.round(sector.revenue * fraction),
      profitMargin: sector.profitMargin,
      workers: Math.round(sector.workers * fraction),
      ...(sector.strategyId ? { strategyId: sector.strategyId } : {}),
      ...(plantsEnabled ? carvedPlant : {}),
      createdAt: now,
      updatedAt: now,
    } as CorporateSector);
    // "Did the carve leave anything behind?" — capacity-aware under plants.
    //
    // This was `if (keptRevenue <= 0)`, which is the same defect as the
    // nationalization sweep's donor guard: under plants `revenue` is DERIVED
    // from `capitalStock`, so a MOTHBALLED source row reports revenue 0 while
    // still holding its whole capital stock. A PARTIAL carve of such a row
    // (fraction 0.4, say) computed `keptRevenue = 0` and DELETED the source —
    // destroying the 60% of capacity, CIP and queued build orders that
    // `keptPlant` had just been computed to preserve. The buyer got 40%, the
    // seller got nothing, and 60% of the world's plant left the balance sheet.
    //
    // The condition wanted is "the remainder is empty". Below plants revenue is
    // the only quantity carried, so `keptRevenue <= 0` says that exactly and
    // this stays byte-identical. Under plants the remainder is empty only when
    // no capacity, no CIP and no queued orders survive the split.
    const keptPlantIsEmpty =
      !plantsEnabled ||
      (!(keptPlant.capitalStock > 0) &&
        !(keptPlant.constructionInProgressAnchor > 0) &&
        keptPlant.buildQueue.length === 0);
    if (keptRevenue <= 0 && keptPlantIsEmpty) {
      await sectors.deleteOne({ _id: sector._id });
    } else {
      await sectors.updateOne(
        { _id: sector._id },
        {
          $set: {
            revenue: keptRevenue,
            workers: Math.round(sector.workers * keep),
            currentGrowthCost: Math.round(sector.currentGrowthCost * keep),
            ...(plantsEnabled ? keptPlant : {}),
            updatedAt: now,
          },
        }
      );
    }
    sectorsCarved++;
  }

  // ── 8. Distribute. IPO: book the float proceeds to the treasury now. Auction:
  //       open the bid window (proceeds arrive at sale via the resolver). ──
  let proceedsLocal = 0;
  let auctionId: ObjectId | undefined;
  if (isAuction) {
    auctionId = new ObjectId();
    const reservePrice = Math.round(params.reservePrice ?? valuationLocal);
    await db.collection<NationalizationAuction>("nationalizationAuctions").insertOne({
      _id: auctionId,
      corporationId: newCorpId,
      countryId: params.countryId,
      primaryNationalCorporationId: primary._id,
      openedAtTurn: params.turn,
      closesAtTurn: params.turn + AUCTION_WINDOW_TURNS,
      reservePrice,
      reserveCurrency: currency,
      goldenSharePercent: structure.goldenShares / structure.totalShares,
      status: "open",
      bids: [],
      createdAt: now,
      updatedAt: now,
    });
    // Alert the country's residents (the only eligible bidders) that a state
    // spin-out is up for auction so the market competes for it.
    await notifyCountryResidents(db, params.countryId, {
      type: "corp_privatization_offered",
      title: "State spin-out up for auction",
      message: `${name} is up for auction — bids close in ${AUCTION_WINDOW_TURNS} turns.`,
      metadata: { href: `/country/${params.countryId.toLowerCase()}/nationalization` },
    });
  } else {
    await creditTreasuryProceeds(db, params.countryId, structure.proceedsLocal, now);
    proceedsLocal = structure.proceedsLocal;
    // Privatization politics (spec §12.1) — an IPO completes immediately. Auction
    // consequences fire at sale (the resolver), not here at open.
    const consequence = await applyPrivatizationConsequences(db, {
      countryId: params.countryId,
      turn: params.turn,
    });
    // Completion wire fires here for IPO (covers both the executive route and the
    // legislative provision); the auction wire fires at sale in the resolver.
    logWireEvent("corporation_privatized", wireHeadlineCorpPrivatized(name), {
      href: `/corporation/${newCorpId.toString()}`,
    });
    // Public State Ownership Register row (best-effort — never abort the spin-out).
    try {
      await recordNationalizationLedger(db, {
        countryId: params.countryId,
        nationalCorporationId: primary._id,
        kind: "privatize_ipo",
        triggers: [],
        valuationAnchor,
        compensationAnchor: 0,
        sectorTypes: [...new Set(selected.map((s) => s.sector.sectorType))],
        newCorpName: name,
        foreignOwnerCountryId: null,
        confidenceBefore: consequence?.confidenceBefore,
        confidenceAfter: consequence?.confidenceAfter,
        legitimacyDelta: consequence?.legitimacyDelta,
        turn: params.turn,
      });
    } catch (err) {
      console.error("[nationalizationLedger] IPO privatization ledger write failed:", err);
    }
    // Alert the country's residents that fresh shares are on the market.
    await notifyCountryResidents(db, params.countryId, {
      type: "corp_privatization_offered",
      title: "State spin-out now trading",
      message: `${name} has been privatized and its shares are now available.`,
      metadata: { href: `/corporation/${newCorpId.toString()}` },
    });
  }

  await corps.updateOne({ _id: source._id }, { $set: { updatedAt: now } });

  return {
    newCorporationId: newCorpId,
    sectorsCarved,
    totalShares: structure.totalShares,
    goldenShares: structure.goldenShares,
    proceedsLocal,
    ...(auctionId ? { auctionId } : {}),
  };
}
