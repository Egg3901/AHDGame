import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { CentralBank, Corporation, CorporateSector, State } from "@/lib/db/types";
import type { UnownedSector } from "@/lib/db/types/unownedSector";
import type { CountryId } from "@/lib/constants/countries";
import type { CorporationType } from "@/lib/constants/corporations";
import {
  anchorToCorpLiquidCapital,
  loadFxRatesByCurrency,
  resolveSectorHostCurrencyCode,
  fxRateForSectorHostFromMap,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor, writeCorpEconomicLocal } from "@/lib/currency/corpEconomyFields";
import { gdpDerivedMarketAnchor } from "@/lib/corporations/marketShare";
import { loadWorldPreset } from "@/lib/currency/gdpAnchorRate";
import { applyBrandFacilityLoss } from "@/lib/corporations/brandFacilityLoss";
import { buildPrimeRateMap, computeSectorNpvSum } from "@/lib/bonds/corporateBondDefault";
import { isStateOwned, resolveNationalCorporationForSector } from "./nationalCorporation";
import { readStateOwnershipConcentration, sociMultiplier } from "./concentration";
import { isWithinRenationalizeCooldown } from "./privatizationShares";
import { applyTier, sectorCompensationValuationAnchor } from "./compensation";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import {
  carveSectorPlantFields,
  identitySectorPlantFields,
  mergeSectorPlantFields,
  readSectorPlantFields,
  type SectorPlantFieldsUpdate,
} from "@/lib/corporations/sectorTransferCapex";
import { computeSectorImpliedUnits } from "@/lib/market/unownedHeadroom";
import { CAPACITY_ANCHOR_YEAR, capacityPricePerUnit } from "@/lib/constants/capacityEconomy";
import { getGameState } from "@/lib/gameState";
import { debitTreasuryCompensation } from "./treasury";
import { applyNationalizationConsequences } from "./consequences/apply";
import { recordNationalizationLedger } from "./ledger";
import type { CompensationTier } from "./constants";
import { NATIONALIZATION_REVENUE_HAIRCUT } from "./constants";
import type { TransitionConsequenceInput } from "./ownershipTransition";

// Re-export the client-safe scope definitions so existing consumers that import
// `SectorScope` / `SECTOR_SCOPE_LABELS` from this engine module keep working,
// while client components import directly from `./sectorScope` (no mongodb).
import { SECTOR_SCOPE_LABELS, type SectorScope } from "./sectorScope";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";
import { seedPlantLedger, splitWholePlantCount } from "@/lib/corporations/plantLedger";
export { SECTOR_SCOPE_LABELS, type SectorScope };

export interface NationalizeSectorWideParams {
  countryId: CountryId;
  sectorType: CorporationType;
  /** Fraction carved from each in-scope holder, 0 < f ≤ 1. */
  carveFraction: number;
  scope: SectorScope;
  tier: CompensationTier;
  consequence: TransitionConsequenceInput;
}

export interface NationalizeSectorWideResult {
  affectedCorps: number;
  sectorsCarved: number;
  unownedCarved: number;
  /** Total compensation paid out (₳). */
  totalCompensationAnchor: number;
}

/** Defaults for a fresh NatCorp sector grown from the unowned market (no donor). */
const UNOWNED_DEFAULT_MARGIN = 20;

/**
 * Industry-wide sector nationalization (spec — sector-wide design): carve
 * `carveFraction` of every in-scope `sectorType` holding in the country into the
 * country's National Corporation. Two pools, gated by `scope`:
 *   - corp-held (non-state-owned, player + NPC): the donor is compensated
 *     `applyTier(fraction × sectorNPV)` and its row is shrunk (or removed at 100%);
 *   - unowned market: capacity is moved with NO compensation (no owner).
 * Carves merge into the NatCorp's existing (type, region) sector or create one.
 * Politics + ledger fire once for the aggregate taking. The passed bill is the
 * authority — there is no per-corp eligibility gate.
 */
export async function nationalizeSectorWide(
  db: Db,
  params: NationalizeSectorWideParams
): Promise<NationalizeSectorWideResult> {
  const now = new Date();
  const f = Math.min(1, Math.max(0, params.carveFraction));
  if (f <= 0) {
    return { affectedCorps: 0, sectorsCarved: 0, unownedCarved: 0, totalCompensationAnchor: 0 };
  }

  const sectors = db.collection<CorporateSector>("corporateSectors");
  const corps = db.collection<Corporation>("corporations");
  const dest = await resolveNationalCorporationForSector(db, params.countryId, params.sectorType);
  // Snapshot the SOCI escalation multiplier at taking time so the transition
  // shock is fixed to today's concentration, not retroactively deepened later.
  const transitionMultiplier = sociMultiplier(
    await readStateOwnershipConcentration(db, params.countryId)
  );

  const [centralBanks, fxByCurrency, marketMode, sweepGameState] = await Promise.all([
    db.collection<CentralBank>("centralBanks").find({}).toArray(),
    loadFxRatesByCurrency(db),
    getMarketSystemModeForDb(db),
    getGameState(db),
  ]);
  const primeMap = buildPrimeRateMap(centralBanks);
  // PLANTS-GATED: under plants the taking moves CAPACITY — the donor's plant state
  // is sliced by the carve fraction, the NatCorp receives it less the transition
  // haircut, and the donor keeps the complement, so capacity is conserved across
  // the taking with the haircut as the single deliberate sink.
  const plantsEnabled = marketAtLeast(marketMode, "plants");
  const sweepCurrentYear = sweepGameState?.currentYear;
  const sweepEraUnitScale = await loadWorldEraUnitScale(db);

  // NatCorp home currency: carved slices arrive as ₳ anchors and are denominated
  // into this currency below, so a cross-currency taking converts correctly
  // instead of copying the raw donor-currency number across.
  const destCurrency = dest.liquidCurrencyCode ?? "USD";
  const destRate = fxByCurrency.get(destCurrency) ?? 1;

  // An all-zero plant fold, for a taking whose donor carries no capital state
  // (the unowned pool, or a legacy corp row that predates the plants migration).
  // `capitalStock` is filled in by the caller of this helper.
  //
  // `survivor` is the NatCorp row this synthetic donor is about to be folded
  // into, or null when the taking is creating a fresh row. It exists for ONE
  // field: `mothballed`. `mergeSectorPlantFields` ANDs the flag, so a hardcoded
  // `false` here is not neutral — folding an absent donor into a MOTHBALLED
  // NatCorp row would flip it back to running, and the state would find itself
  // producing and paying full upkeep on a plant it had deliberately idled, with
  // no player action behind it. Seeding the flag from the survivor makes the
  // empty donor a true merge identity on every field (it is exactly
  // `identitySectorPlantFields(survivor)` plus the derived capacity), which is
  // the same trap that helper was written for on the rollback paths.
  //
  // On the create branch there is no survivor and `false` is correct: a fresh
  // row grown from unowned headroom starts running.
  const emptyPlant = (survivor: CorporateSector | null): SectorPlantFieldsUpdate => ({
    capitalStock: 0,
    plantCount: 0,
    plantUnitRemainder: 0,
    capacityBookAnchor: 0,
    buildQueue: [],
    constructionInProgressAnchor: 0,
    mothballed: survivor ? identitySectorPlantFields(survivor).mothballed : false,
    plantsStartTurn: null,
    legacyRevenueShadow: null,
  });

  // Merge a carved slice into the NatCorp's (type, region) sector, or create one.
  // `revenueAnchor` / `growthCostAnchor` are ₳ anchors (currency-neutral); they
  // are re-denominated into the NatCorp's home currency here.
  //
  // `incomingPlant` is the donor's plant state ALREADY sliced to the carved
  // fraction (see the corp-held loop). Pass `null` when there is no donor doc to
  // slice — the capacity leg is then derived from the same ₳ quantity the
  // revenue leg uses, exactly as `seedToNatCorp` does it.
  async function addToNatCorp(
    stateId: string,
    revenueAnchor: number,
    workers: number,
    growthCostAnchor: number,
    profitMargin: number,
    targetGrowthRate: number,
    currentGrowthRate: number,
    incomingPlant: SectorPlantFieldsUpdate | null
  ): Promise<void> {
    // NOTHING-TO-TRANSFER GUARD — capacity-aware under plants.
    //
    // This used to be a bare `if (revenueAnchor <= 0) return;`, and it sat ABOVE
    // every capacity write below. Under plants that is a capacity INCINERATOR
    // that the treasury pays for. A sector's `revenue` is DERIVED from
    // `capitalStock`, and a MOTHBALLED sector reports revenue 0 while holding
    // its full capital stock (and possibly outstanding CIP / build orders). For
    // such a donor: compensation upstream is priced on replacement-cost BOOK, so
    // the treasury pays in full for the plant; this guard then returned before
    // the NatCorp received anything; and the caller's `deleteOne` (f >= 1) or
    // complement-shrink (f < 1) removed the capacity from the donor anyway. Net
    // effect: the state buys a factory at book and the factory ceases to exist.
    //
    // The guard's real intent is "there is nothing here to move". Below plants
    // revenue IS the only quantity that moves, so `revenueAnchor <= 0` still
    // expresses that exactly and the behaviour is byte-identical. Under plants
    // the transferable substance is the plant state, so admit any donor carrying
    // capacity, construction in progress, or queued build orders even at zero
    // revenue. `mothballed` / `plantsStartTurn` alone are deliberately NOT
    // enough — they are history flags, not substance, and admitting on them
    // would create empty NatCorp rows.
    const plantHasSubstance =
      plantsEnabled &&
      incomingPlant != null &&
      (incomingPlant.capitalStock > 0 ||
        incomingPlant.constructionInProgressAnchor > 0 ||
        incomingPlant.buildQueue.length > 0);
    if (revenueAnchor <= 0 && !plantHasSubstance) return;
    // Transition revenue haircut: the state acquires a disrupted slice worth 15%
    // less than the carved value (compensation above is paid on the full value).
    // Denominate the ₳ anchor into the NatCorp's home currency so a cross-currency
    // taking (e.g. an NGN donor into a GBP NatCorp) stores the correct local
    // amount rather than the raw donor-currency figure.
    const transferRevenue = Math.round(
      writeCorpEconomicLocal(
        revenueAnchor * (1 - NATIONALIZATION_REVENUE_HAIRCUT),
        destCurrency,
        destRate
      )
    );
    const transferGrowthCost = Math.round(
      writeCorpEconomicLocal(growthCostAnchor, destCurrency, destRate)
    );
    // PLANTS LOCKSTEP. Under `marketSystemMode >= "plants"` a corporate sector's
    // `revenue` is DERIVED — `sectorTurn` restates it from `capitalStock × mix
    // price` every turn — so the `$inc: { revenue }` below, on its own, is erased
    // on the very next tick and a sector-wide taking hands the NatCorp NOTHING
    // while the donor's row (shrunk or deleted) has really lost the capacity.
    // The quantity therefore has to land on `capitalStock`.
    //
    // Two sources, in priority order:
    //   1. the donor's own carved plant state — units LEAD, because the donor is
    //      losing exactly these units and the taking must conserve them;
    //   2. failing that (unowned pool, or a legacy row with no `capitalStock`
    //      yet), `computeSectorImpliedUnits` off the SAME post-haircut ₳ figure
    //      the revenue leg is written from. That is the engine's own ₳ → units
    //      conversion, so the units are commensurable with `capitalStock`. It
    //      takes ₳, NOT the local-currency number: `capitalStock` is currency
    //      free, and feeding it `transferRevenue` would restate the quantity by
    //      the NatCorp's FX rate.
    //
    // Revenue is still written, in lockstep and off the same quantity, so the two
    // views cannot diverge before `sectorTurn` next restates them.
    //
    // Below plants `plantIn` is null and every write here is byte identical to
    // the pre-P3b behaviour.
    const haircutAnchor = revenueAnchor * (1 - NATIONALIZATION_REVENUE_HAIRCUT);
    // The survivor is read BEFORE the fold is built: `emptyPlant` needs it to
    // seed `mothballed` (see the note there), so the lookup cannot wait until
    // the branch below.
    const existing = await sectors.findOne({
      corporationId: dest._id,
      sectorType: params.sectorType,
      stateId,
    });
    let plantIn: SectorPlantFieldsUpdate | null = null;
    if (plantsEnabled) {
      plantIn = incomingPlant ?? emptyPlant(existing);
      if (!(plantIn.capitalStock > 0)) {
        plantIn = {
          ...plantIn,
          capitalStock: computeSectorImpliedUnits(
            params.sectorType,
            haircutAnchor,
            null,
            sweepEraUnitScale
          ),
          // Capacity derived from an ₳ nameplate rather than transferred with a
          // recorded basis (the unowned pool, or a legacy row). Priced at LIST,
          // which is what that capacity cost under the legacy growth stack
          // (identity B) and exactly what the fallback would have returned.
          capacityBookAnchor:
            computeSectorImpliedUnits(params.sectorType, haircutAnchor, null, sweepEraUnitScale) *
            capacityPricePerUnit(
              params.sectorType,
              sweepCurrentYear ?? CAPACITY_ANCHOR_YEAR,
              sweepEraUnitScale
            ),
        };
      }
    }

    const scopeStamp = {
      sectorNationalizationScope: params.scope,
      sectorNationalizationCarveFraction: f,
    };
    if (existing) {
      await sectors.updateOne(
        { _id: existing._id },
        {
          $inc: { revenue: transferRevenue, workers, currentGrowthCost: transferGrowthCost },
          $set: {
            // MERGE shape: the slice is folded into a row the NatCorp already
            // operates. `mergeSectorPlantFields` sums capacity and CIP,
            // concatenates the build queues in landing order, ANDs `mothballed`
            // and keeps the EARLIER ramp anchor — without it the survivor's own
            // plant state would be untouched and the seized units lost.
            ...(plantIn ? mergeSectorPlantFields(readSectorPlantFields(existing), plantIn) : {}),
            absorbedAtTurn: params.consequence.turn,
            nationalizedAtTurn: params.consequence.turn,
            nationalizationTransitionMultiplier: transitionMultiplier,
            ...scopeStamp,
            updatedAt: now,
          },
        }
      );
    } else {
      await sectors.insertOne({
        _id: new ObjectId(),
        corporationId: dest._id,
        countryId: params.countryId,
        stateId,
        sectorType: params.sectorType,
        revenue: transferRevenue,
        // CREATE shape: the carved plant state IS the new row's plant state.
        // `plantsStartTurn` rides across from the donor rather than being reset —
        // this is capacity that has already ramped, not a greenfield build, so
        // re-anchoring the launch governor would re-clamp production the donor
        // had long since ramped past.
        ...(plantIn ?? {}),
        workers,
        profitMargin,
        targetGrowthRate,
        currentGrowthRate,
        currentGrowthCost: transferGrowthCost,
        absorbedAtTurn: params.consequence.turn,
        nationalizedAtTurn: params.consequence.turn,
        nationalizationTransitionMultiplier: transitionMultiplier,
        ...scopeStamp,
        createdAt: now,
        updatedAt: now,
      } as CorporateSector);
    }
  }

  let totalPayoutAnchor = 0;
  let sectorsCarved = 0;
  let unownedCarved = 0;
  const affectedCorpIds = new Set<string>();

  // ── 1. Corp-held pool (scope: all | corporations) ──
  if (params.scope !== "unowned") {
    const corpSectors = await sectors
      .find({ countryId: params.countryId, sectorType: params.sectorType })
      .toArray();
    // Cache donor corps so each is loaded once.
    const donorById = new Map<string, Corporation | null>();
    for (const sec of corpSectors) {
      const donorKey = String(sec.corporationId);
      if (donorKey === String(dest._id)) continue; // never carve from the NatCorp itself
      let donor = donorById.get(donorKey);
      if (donor === undefined) {
        donor = await corps.findOne({ _id: sec.corporationId });
        donorById.set(donorKey, donor);
      }
      if (!donor || isStateOwned(donor)) continue; // skip state-owned / vanished
      // #89 npp_unowned scope: carve only NPP-run corps, leaving player-run
      // (ceoType "character") corporations untouched in the sector.
      if (params.scope === "npp_unowned" && donor.ceoType !== "npp") continue;
      // Respect the re-nationalization cooldown (spec §13.4) the whole-corp path
      // honors — a just-privatized corp's holdings can't be swept straight back.
      if (isWithinRenationalizeCooldown(donor, params.consequence.turn)) continue;
      const donorCurrency = donor.liquidCurrencyCode ?? "USD";
      const donorRate = fxByCurrency.get(donorCurrency) ?? 1;

      // Value the carved slice = full sector NPV × fraction.
      // Steady-state valuation (revenue − maintenance, no growth cost) for the
      // nationalization payout — see ownershipTransition.nationalizeSector.
      // D11: under plants the base is replacement-cost book, with the matching
      // premium applied inside applyTier.
      const valuationAnchor = sectorCompensationValuationAnchor(
        sec,
        computeSectorNpvSum([sec], primeMap, donor, fxByCurrency, {
          excludeGrowthCost: true,
          plantsEnabled,
        }),
        {
          plantsEnabled,
          currentYear: sweepCurrentYear,
          fraction: f,
          eraUnitScale: sweepEraUnitScale,
        }
      );
      const payoutAnchor = applyTier(valuationAnchor, params.tier, { plantsEnabled });
      await debitTreasuryCompensation(db, params.countryId, payoutAnchor, fxByCurrency, now);
      if (payoutAnchor > 0) {
        const compLocal = Math.round(anchorToCorpLiquidCapital(payoutAnchor, donor, donorRate));
        await corps.updateOne(
          { _id: donor._id },
          { $inc: { liquidCapital: compLocal }, $set: { updatedAt: now } }
        );
      }

      // Carve the slice into the NatCorp; shrink/remove the donor row. The donor
      // sector's revenue / growth-cost are stored in the sector's HOST-state
      // currency (the country being nationalized), so convert to ₳ at the host
      // rate; addToNatCorp then re-denominates into the NatCorp's home currency.
      const carvedRevAnchor = readCorpEconomicAnchor(
        Math.round((sec.revenue ?? 0) * f),
        resolveSectorHostCurrencyCode(sec, donor),
        fxRateForSectorHostFromMap(sec, donor, fxByCurrency)
      );
      // Brand facility-loss (Boeing rule): the donor survives this partial carve
      // but loses the carved slice to the state, so dent its brand proportional to
      // the lost slice's share of its revenue. Called before the donor row is
      // shrunk/removed (the aggregate still includes it). No-op with no loyalty.
      await applyBrandFacilityLoss(db, donor._id, Math.round((sec.revenue ?? 0) * f));

      const carvedWorkers = Math.round((sec.workers ?? 0) * f);
      const carvedGrowthAnchor = readCorpEconomicAnchor(
        Math.round((sec.currentGrowthCost ?? 0) * f),
        resolveSectorHostCurrencyCode(sec, donor),
        fxRateForSectorHostFromMap(sec, donor, fxByCurrency)
      );
      const openingPlantCount = Number.isInteger(sec.plantCount)
        ? (sec.plantCount as number)
        : seedPlantLedger(sec.sectorType, sec.capitalStock).plantCount;
      const plantCountSplit = splitWholePlantCount(openingPlantCount, f);
      // PLANTS — the capacity leg of the carve. Below plants this is null and
      // both writes below are byte identical to the pre-P3b behaviour.
      //
      // `carveSectorPlantFields(sec, f)` is the same slicer the privatization
      // spin-out uses: capacity, CIP and each build order scale by `f`, while
      // `mothballed` / `plantsStartTurn` are copied (they describe the plant's
      // history, which both halves inherit).
      //
      // The 15% NATIONALIZATION_REVENUE_HAIRCUT is then applied to `capitalStock`
      // and to `capitalStock` ONLY, for two reasons. It has to be applied to the
      // capacity leg at all, because under plants revenue is derived FROM
      // capacity: haircutting only the revenue write would be undone on the next
      // tick and the deliberate transition loss would silently evaporate, so the
      // two views would diverge. And it must NOT touch `constructionInProgress
      // Anchor` or the queue's `costPaidAnchor`, because those are real ₳ already
      // charged to a corp — shaving 15% off them destroys money rather than
      // capacity, and breaks the invariant that a sector's CIP equals Σ of its
      // own queue.
      //
      // BUILDINGS IN FLIGHT therefore TRANSFER, at the carve fraction and at full
      // value. The state seizes the industry as a going concern; a half-built
      // plant the donor has already paid for is part of the taking, and it is
      // priced into the compensation above (D11 values replacement-cost book,
      // which includes CIP). Leaving in-flight orders behind would strand them on
      // a donor row that is DELETED at f = 1, burning the ₳ outright.
      const carvedPlant: SectorPlantFieldsUpdate | null = plantsEnabled
        ? (() => {
            const sliced = carveSectorPlantFields(
              readSectorPlantFields(sec),
              f,
              plantCountSplit.carved
            );
            return {
              ...sliced,
              capitalStock: sliced.capitalStock * (1 - NATIONALIZATION_REVENUE_HAIRCUT),
              // P5: the paid basis takes the SAME haircut as the capacity it
              // prices, so the per-unit basis is invariant across the taking.
              capacityBookAnchor: sliced.capacityBookAnchor * (1 - NATIONALIZATION_REVENUE_HAIRCUT),
            };
          })()
        : null;

      await addToNatCorp(
        sec.stateId,
        carvedRevAnchor,
        carvedWorkers,
        carvedGrowthAnchor,
        sec.profitMargin ?? UNOWNED_DEFAULT_MARGIN,
        sec.targetGrowthRate ?? 1,
        sec.currentGrowthRate ?? 1,
        carvedPlant
      );
      if (f >= 1) {
        await sectors.deleteOne({ _id: sec._id });
      } else {
        await sectors.updateOne(
          { _id: sec._id },
          {
            $set: {
              // The donor keeps the COMPLEMENT of what was carved — `1 − f` of
              // capacity, CIP and every build order — so total capacity is
              // conserved across the taking up to the single deliberate haircut
              // sink applied above. Without this the donor's `capitalStock` would
              // be untouched and the next tick would restate its revenue back to
              // the full pre-taking figure: the state would have minted units.
              ...(plantsEnabled
                ? carveSectorPlantFields(readSectorPlantFields(sec), 1 - f, plantCountSplit.kept)
                : {}),
              revenue: Math.round((sec.revenue ?? 0) * (1 - f)),
              workers: Math.round((sec.workers ?? 0) * (1 - f)),
              currentGrowthCost: Math.round((sec.currentGrowthCost ?? 0) * (1 - f)),
              updatedAt: now,
            },
          }
        );
      }
      totalPayoutAnchor += payoutAnchor;
      sectorsCarved += 1;
      affectedCorpIds.add(donorKey);
    }
  }

  // ── 2. Unowned market pool (scope: all | unowned) — free, no owner. ──
  if (params.scope !== "corporations") {
    const unowned = await db
      .collection<UnownedSector>("unownedSectors")
      .find({ countryId: params.countryId, sectorType: params.sectorType })
      .toArray();
    for (const u of unowned) {
      // unownedSectors.revenue is ₳-native (Task 9) — already an anchor, so pass
      // it straight through; addToNatCorp denominates into the NatCorp's currency.
      const carvedRevAnchor = Math.round((u.revenue ?? 0) * f);
      if (carvedRevAnchor <= 0) continue;
      // No donor plant doc to slice — an unowned pool row carries `revenue` and a
      // derived `headroomUnits`, not `capitalStock`. `addToNatCorp` therefore
      // derives the capacity leg from this same ₳ figure.
      await addToNatCorp(u.stateId, carvedRevAnchor, 0, 0, UNOWNED_DEFAULT_MARGIN, 1, 1, null);
      if (f >= 1) {
        await db.collection<UnownedSector>("unownedSectors").deleteOne({ _id: u._id });
      } else {
        await db.collection<UnownedSector>("unownedSectors").updateOne(
          { _id: u._id },
          {
            $set: {
              revenue: Math.round((u.revenue ?? 0) * (1 - f)),
              // The pool's own capacity view. `headroomUnits` is the units form
              // of `revenue`, so a drawdown that scaled one and not the other
              // would leave the pool claiming headroom the state has taken.
              // Gated: below plants the field is unused and must not appear.
              ...(plantsEnabled && typeof u.headroomUnits === "number"
                ? { headroomUnits: u.headroomUnits * (1 - f) }
                : {}),
              updatedAt: now,
            },
          }
        );
      }
      unownedCarved += 1;
    }
  }

  // ── 2b. Fill the GDP-derived market headroom (scope: all | unowned). ──
  // Parity with the split/capture mechanic: a maxed-out split builds production
  // up to the GDP-derived market ceiling — the capture base in the economy/attack
  // route falls back to `ceiling − owned` when no unowned doc remains, so a corp
  // can grow into the otherwise-empty headroom and reach 100%. A 100% taking must
  // reach the same 100%, so after seizing the corp-held + persisted-unowned pools
  // we top up each nationalized region's NatCorp production to `f × ceiling`. The
  // built headroom takes NO compensation and NO revenue haircut (it is fresh
  // capacity, not a disrupted transfer) — mirroring a split, which builds raw
  // captured revenue. Without this, a take below the ceiling leaves a permanent
  // "unowned" gap the state alone could never close.
  if (params.scope !== "corporations") {
    const natSectors = await sectors
      .find({ corporationId: dest._id, sectorType: params.sectorType })
      .toArray();
    if (natSectors.length > 0) {
      const stateIds = [...new Set(natSectors.map((s) => s.stateId))];
      const [stateDocs, remainingUnowned, preset] = await Promise.all([
        db
          .collection<State>("states")
          .find({ _id: { $in: stateIds } }, { projection: { _id: 1, gdp: 1, countryId: 1 } })
          .toArray(),
        db
          .collection<UnownedSector>("unownedSectors")
          .find({
            countryId: params.countryId,
            sectorType: params.sectorType,
            stateId: { $in: stateIds },
          })
          .toArray(),
        loadWorldPreset(db),
      ]);
      const gdpById = new Map(stateDocs.map((s) => [String(s._id), s.gdp ?? 0]));
      // Guard against a sector mis-tagged into a foreign state (data anomaly, e.g.
      // a state-id collision): the GDP ceiling must use the state's own economy, so
      // skip any region whose country doesn't match this taking's country.
      const stateCountryById = new Map(stateDocs.map((s) => [String(s._id), s.countryId]));
      // unownedSectors.revenue is ₳-native (Task 9).
      const poolByState = new Map(remainingUnowned.map((u) => [String(u.stateId), u.revenue ?? 0]));
      const destCurrency = dest.liquidCurrencyCode ?? "USD";
      const destRate = fxByCurrency.get(destCurrency) ?? 1;
      for (const ns of natSectors) {
        if (stateCountryById.get(String(ns.stateId)) !== params.countryId) continue;
        const ceilingAnchor = gdpDerivedMarketAnchor(
          gdpById.get(String(ns.stateId)) ?? 0,
          params.countryId,
          preset
        );
        const ownedAnchor = readCorpEconomicAnchor(ns.revenue ?? 0, destCurrency, destRate);
        const poolAnchor = poolByState.get(String(ns.stateId)) ?? 0;
        const headroomAnchor = Math.max(0, ceilingAnchor - ownedAnchor - poolAnchor);
        const captureAnchor = Math.round(headroomAnchor * f);
        if (captureAnchor <= 0) continue;
        const captureLocal = Math.round(
          writeCorpEconomicLocal(captureAnchor, destCurrency, destRate)
        );
        if (captureLocal <= 0) continue;
        // PLANTS LOCKSTEP. This is the second un-gated revenue writer: under
        // plants a bare `$inc: { revenue }` is restated away on the next tick and
        // the whole headroom capture evaporates, leaving a 100% taking stuck
        // permanently below the GDP-derived ceiling. The capture has to land on
        // capacity, derived from the SAME ₳ figure (`captureAnchor`, not the
        // FX-denominated `captureLocal` — `capitalStock` is currency free).
        //
        // NO haircut here, matching the revenue leg: built headroom is fresh
        // capacity mirroring a split's build-out, not a disrupted transfer, so
        // there is no donor and nothing to lose in transition.
        const captureUnits = plantsEnabled
          ? computeSectorImpliedUnits(
              params.sectorType,
              captureAnchor,
              ns.strategyId,
              sweepEraUnitScale
            )
          : 0;
        await sectors.updateOne(
          { _id: ns._id },
          {
            $inc: {
              revenue: captureLocal,
              ...(captureUnits > 0 ? { capitalStock: captureUnits } : {}),
            },
            $set: {
              nationalizedAtTurn: params.consequence.turn,
              nationalizationTransitionMultiplier: transitionMultiplier,
              sectorNationalizationScope: params.scope,
              sectorNationalizationCarveFraction: f,
              updatedAt: now,
            },
          }
        );
      }
    }
  }

  // ── Politics + investor confidence, once for the aggregate taking. ──
  const consequenceResult = await applyNationalizationConsequences(db, {
    countryId: params.countryId,
    method: params.consequence.method,
    tier: params.tier,
    triggers: params.consequence.triggers,
    sectorTypes: [params.sectorType],
    valuationAnchor: totalPayoutAnchor,
    compensationAnchor: totalPayoutAnchor,
    foreignOwnerCountryId: null,
    governingPartyId: params.consequence.governingPartyId ?? null,
    turn: params.consequence.turn,
    actorCharacterId: params.consequence.actorCharacterId,
  });

  try {
    await recordNationalizationLedger(db, {
      countryId: params.countryId,
      nationalCorporationId: dest._id,
      kind: "nationalize_sector",
      method: params.consequence.method,
      triggers: params.consequence.triggers,
      tier: params.tier,
      valuationAnchor: totalPayoutAnchor,
      compensationAnchor: totalPayoutAnchor,
      sectorTypes: [params.sectorType],
      formerCorpName: `${params.sectorType} industry — ${SECTOR_SCOPE_LABELS[params.scope]} (${Math.round(f * 100)}%)`,
      foreignOwnerCountryId: null,
      confidenceBefore: consequenceResult.confidenceBefore,
      confidenceAfter: consequenceResult.confidenceAfter,
      legitimacyDelta: consequenceResult.legitimacyDelta,
      turn: params.consequence.turn,
    });
  } catch (err) {
    console.error("[nationalizationLedger] sector-wide ledger write failed:", err);
  }

  return {
    affectedCorps: affectedCorpIds.size,
    sectorsCarved,
    unownedCarved,
    totalCompensationAnchor: totalPayoutAnchor,
  };
}
