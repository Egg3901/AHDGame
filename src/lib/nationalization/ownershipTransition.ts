import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { badRequest } from "@/lib/api/errors";
import type {
  Bond,
  CentralBank,
  Character,
  Corporation,
  CorporateSector,
  IndexFund,
  State,
} from "@/lib/db/types";
import type { UnownedSector } from "@/lib/db/types/unownedSector";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import {
  anchorToCorpLiquidCapital,
  corpLiquidCapitalToAnchor,
  getCorpFxRate,
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
  resolveSectorHostCurrencyCode,
  fxRateForSectorHostFromMap,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import type { CorporationType } from "@/lib/constants/corporations";
import {
  unownedHeadroomUnitsPerAnchor,
  unownedPoolCreditBaseExpr,
  unownedPoolLeadingField,
  unownedPoolTrailingSet,
} from "@/lib/market/unownedHeadroom";
import { revenuePerCapacityUnitForStrategy } from "@/lib/constants/capacityEconomy";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { buildPersonalBalanceInc, getHomeCurrency } from "@/lib/currency/characterFunds";
import { sumBondPrincipalAnchor } from "@/lib/bonds/bondPrincipalSum";
import { seedPlantLedger } from "@/lib/corporations/plantLedger";
import {
  allocateShareholderPool,
  buildPrimeRateMap,
  computeSectorNpvSum,
} from "@/lib/bonds/corporateBondDefault";
import { cleanupShareMarketActivityForCorporations } from "@/lib/corporations/cleanupShareMarketActivity";
import { payFundShareholderRows } from "@/lib/corporations/payFundShareholders";
import { applyBrandFacilityLoss } from "@/lib/corporations/brandFacilityLoss";
import { stampSubjectDeleted } from "@/lib/financialTxLog/stampDeleted";
import { emitTxBulk, loadTxThresholds } from "@/lib/financialTxLog/emit";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";
import type { CountryId } from "@/lib/constants/countries";
import {
  ensurePrimaryNationalCorporation,
  resolveNationalCorporationForSector,
} from "./nationalCorporation";
import {
  applyTier,
  computeWholeCorpValuation,
  sectorCompensationValuationAnchor,
  wholeCorpCompensationAnchor,
} from "./compensation";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import {
  mergeSectorPlantFields,
  readSectorPlantFields,
} from "@/lib/corporations/sectorTransferCapex";
import { getGameState } from "@/lib/gameState";
import { sumSectorBookValueAnchor } from "@/lib/corporations/sectorProfitBasis";
import { readStateOwnershipConcentration, sociMultiplier } from "./concentration";
import {
  creditTreasuryProceedsFromAnchor,
  debitTreasuryCompensation,
  settleFundedTreasuryCompensation,
} from "./treasury";
import {
  loadTreasuryCashContext,
  resolveTreasuryCashOptions,
  witnessTreasuryCash,
  type TreasuryCashOptions,
} from "./treasuryLedger";
import { snapshotCorporationCurrency } from "@/lib/ledger/balanceSnapshot";
import { deleteDissolvedCorporation } from "./dissolvedCorporation";
import type { CompensationTier } from "./constants";
import { NATIONALIZATION_REVENUE_HAIRCUT } from "./constants";
import { applyNationalizationConsequences } from "./consequences/apply";
import { recordNationalizationLedger } from "./ledger";
import type { NationalizationMethod, NationalizationTrigger } from "./consequences/types";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";
import { treasuryAnchorValuation } from "@/lib/budget/rules/treasuryAccrual";
import { writeGovBudgetLocal } from "@/lib/currency/govBudgetFields";
import { resumeSettlement, settleTransition } from "@/lib/banking/settlementJournal";
import type { BankingTransition, TransitionLeg } from "@/lib/banking/rules/boundary";
import {
  acquireConstructionPropertyTransition,
  hasProtectedConstructionProperty,
  releaseConstructionPropertyTransition,
  reserveSectorsForTransition,
  unprotectedConstructionPropertyFilter,
} from "@/lib/corporations/securedConstructionProperty";

const UNOWNED_RELEASE_RETRY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Politics inputs the caller supplies; the money fields (valuation, compensation,
 * foreign-owner) are computed by the transition itself and merged in.
 */
export interface TransitionConsequenceInput {
  method: NationalizationMethod;
  triggers: NationalizationTrigger[];
  turn: number;
  governingPartyId?: string | null;
  actorCharacterId?: ObjectId;
}

/**
 * Move one seized `sector` into the National Corporation `destId`, MERGING into
 * the NatCorp's existing holding of the same `(stateId, sectorType)` when one
 * exists — a blind `$set: { corporationId }` would violate the unique
 * `(corporationId, stateId, sectorType)` index and throw E11000 (e.g. a second
 * `tech@Beijing` taking after the NatCorp already holds `tech@Beijing`). On a
 * merge the donor row's capacity is folded into the existing row and the donor
 * row is dropped; otherwise the donor row is simply re-parented. Mirrors
 * `nationalizeSectorWide.addToNatCorp`.
 *
 * PLANTS-GATED: under `marketSystemMode >= "plants"` a corporate sector's
 * `revenue` is DERIVED — `sectorTurn` restates it from `capitalStock × mix
 * price` every turn — so a taking that moved value through `revenue` alone
 * would be erased on the next tick. Both branches therefore move CAPACITY under
 * plants, and both apply the 15% transition haircut to `capitalStock` (the
 * capacity leg), which is the quantity the restatement reads. The revenue write
 * is kept in lockstep off the same haircut so the two views cannot diverge in
 * the turn before `sectorTurn` next restates them. Below plants `plantsEnabled`
 * is false, no plant field is written, and every write here is byte-identical to
 * the pre-fix behaviour — which matters because below plants `capitalStock` is
 * owned and re-derived by capital mode, and spreading a fold would also stamp
 * `buildQueue: []` / `mothballed: false` /
 * `plantsStartTurn: null` onto rows that legitimately carry none of them.
 */
async function absorbSectorIntoNatCorp(
  db: Db,
  sector: CorporateSector,
  destId: ObjectId,
  absorbedAtTurn: number,
  now: Date,
  transitionMultiplier: number,
  plantsEnabled: boolean,
  transitionKey?: string,
  fundedOperationKey?: string
): Promise<ObjectId> {
  const sectors = db.collection<CorporateSector>("corporateSectors");
  // Prior-owner provenance — captured from the donor row BEFORE it is re-parented
  // or folded, so an emergency taking can be reversed (SCOTUS strike-down). On a
  // merge this overwrites the survivor's provenance with the latest taking.
  const provenance = {
    formerCorporationId: sector.corporationId,
    ...(sector.countryId ? { formerCountryId: sector.countryId } : {}),
    formerRevenue: sector.revenue ?? 0,
    ...(typeof sector.capitalStock === "number" && Number.isFinite(sector.capitalStock)
      ? { formerCapitalStock: sector.capitalStock }
      : {}),
    takenAtTurn: absorbedAtTurn,
  };
  // Transition revenue haircut: the state acquires a disrupted asset worth 15%
  // less than what the former owner held (compensation is paid on the full value
  // upstream, before this transfer). nationalizedAtTurn anchors the productivity
  // shock that decays over NATIONALIZATION_TRANSITION_TURNS.
  const keep = 1 - NATIONALIZATION_REVENUE_HAIRCUT;
  const transferRevenue = Math.round((sector.revenue ?? 0) * keep);
  const donorStock =
    typeof sector.capitalStock === "number" && Number.isFinite(sector.capitalStock)
      ? Math.max(0, sector.capitalStock)
      : 0;
  // The haircut lands on `capitalStock` and on `capitalStock` ONLY — the same
  // rule `nationalizeSectorWide` carves by. Each build order's `costPaidAnchor`
  // is real ₳ a corp has ALREADY PAID: shaving 15% off it destroys money rather
  // than capacity. In-flight builds therefore transfer whole; the state seizes
  // a going concern, and compensation already prices the queue into replacement
  // cost book value.
  const haircutStock = Math.round(donorStock * keep * 100) / 100;
  // P5: the paid basis follows the capacity, at the same haircut, so the
  // per-unit basis of the surviving plant is unchanged. Only touched when the
  // donor carries a recorded basis — a row without one keeps the list-price
  // fallback, which already tracks the haircut stock automatically.
  const donorBook =
    typeof sector.capacityBookAnchor === "number" &&
    Number.isFinite(sector.capacityBookAnchor) &&
    sector.capacityBookAnchor >= 0
      ? sector.capacityBookAnchor
      : null;
  const haircutBook = donorBook != null ? donorBook * keep : null;
  const existing = await sectors.findOne({
    corporationId: destId,
    stateId: sector.stateId,
    sectorType: sector.sectorType,
    industryModel: sector.industryModel ?? null,
  });
  if (existing && hasProtectedConstructionProperty(existing)) {
    throw badRequest("Resolve secured construction before merging this nationalized sector");
  }
  if (existing && !existing._id.equals(sector._id)) {
    // MERGE: the donor row is DELETED below, so anything not folded into the
    // survivor here is destroyed outright. `mergeSectorPlantFields` sums
    // capacity and CIP, concatenates the queues in landing order, ANDs
    // `mothballed` and keeps the EARLIER ramp anchor (a re-anchored ramp would
    // re-clamp production the donor had long since ramped past).
    const merged = plantsEnabled
      ? mergeSectorPlantFields(readSectorPlantFields(existing), {
          ...readSectorPlantFields(sector),
          capitalStock: haircutStock,
          ...seedPlantLedger(
            sector.sectorType,
            haircutStock,
            sector.industryModel,
            sector.mediaDiscriminator
          ),
          capacityBookAnchor: haircutBook,
        })
      : null;
    const merge = await sectors.updateOne(
      { _id: existing._id, ...unprotectedConstructionPropertyFilter() },
      {
        $inc: {
          // Revenue merges in EVERY mode, in lockstep with the capacity fold
          // above and off the same post-haircut quantity — the rule
          // `nationalizeSectorWide.addToNatCorp` already carves by.
          //
          // This used to be skipped under plants on the reasoning that the
          // survivor's revenue is restated from the folded `capitalStock` next
          // tick anyway, so adding the donor's revenue would double-count its
          // capacity for one turn. That reasoning is backwards: the donor row is
          // DELETED immediately below, so skipping the write does not avoid a
          // double count, it creates a hole. For the turn between this taking
          // and the next `sectorTurn` restatement the donor's revenue exists
          // nowhere in the world, and both the metric-engine provider and
          // `estimateNationalizedOperatingIncome` read exactly that field. The
          // result was a one-turn UNDERCOUNT of national output, not a saving.
          revenue: transferRevenue,
          workers: sector.workers ?? 0,
          currentGrowthCost: sector.currentGrowthCost ?? 0,
        },
        $set: {
          ...(merged ? { ...merged } : {}),
          absorbedAtTurn,
          nationalizedAtTurn: absorbedAtTurn,
          nationalizationTransitionMultiplier: transitionMultiplier,
          nationalizationProvenance: provenance,
          updatedAt: now,
        },
      }
    );
    if (merge.matchedCount !== 1)
      throw badRequest("The National Corporation holding became secured during the taking");
    const remove = await sectors.deleteOne({
      _id: sector._id,
      ...(fundedOperationKey
        ? { "pendingFundedNationalization.operationKey": fundedOperationKey }
        : {}),
      ...(transitionKey
        ? { "constructionPropertyTransition.key": transitionKey }
        : unprotectedConstructionPropertyFilter()),
    });
    if (remove.deletedCount !== 1)
      throw badRequest("The sector became secured during the nationalization");
    return existing._id;
  } else {
    // RE-PARENT: the doc itself is re-pointed, so the plant state rides along
    // for free — except `capitalStock`, which must take the haircut. Without it
    // the next tick restates `revenue` from the untouched nameplate straight
    // back to the full pre-taking figure and the transition penalty silently
    // evaporates.
    const reparent = await sectors.updateOne(
      {
        _id: sector._id,
        ...(fundedOperationKey
          ? { "pendingFundedNationalization.operationKey": fundedOperationKey }
          : {}),
        ...(transitionKey
          ? { "constructionPropertyTransition.key": transitionKey }
          : unprotectedConstructionPropertyFilter()),
      },
      {
        $set: {
          corporationId: destId,
          revenue: transferRevenue,
          ...(plantsEnabled ? { capitalStock: haircutStock } : {}),
          ...(plantsEnabled
            ? seedPlantLedger(
                sector.sectorType,
                haircutStock,
                sector.industryModel,
                sector.mediaDiscriminator
              )
            : {}),
          ...(plantsEnabled && haircutBook != null ? { capacityBookAnchor: haircutBook } : {}),
          absorbedAtTurn,
          nationalizedAtTurn: absorbedAtTurn,
          nationalizationTransitionMultiplier: transitionMultiplier,
          nationalizationProvenance: provenance,
          updatedAt: now,
        },
        ...(fundedOperationKey
          ? {
              $unset: {
                pendingFundedNationalization: "",
                constructionPropertyTransition: "",
              },
            }
          : {}),
      }
    );
    if (reparent.matchedCount !== 1)
      throw badRequest("The sector became secured during the nationalization");
    return sector._id;
  }
}

/**
 * Release one FOREIGN sector (held outside the nationalizing country) to the open
 * unowned market: a country cannot hold assets under another jurisdiction, so a
 * whole-corp taking divests them rather than absorbing them into the domestic
 * National Corporation. The sector revenue (the donor's local currency) is
 * converted to the ₳-native unowned unit and merged into the `(stateId,
 * sectorType)` unowned pool (upsert + `$inc`); the donor row is then removed.
 * No transition haircut — the asset is released to the market, not operated by
 * the state. Mirrors the shed path's CorporateSector→unowned conversion.
 */
export async function releaseForeignSectorToUnowned(
  db: Db,
  sector: CorporateSector,
  currencyCode: CurrencyCode | string | undefined,
  fxRate: number,
  now: Date,
  plantsEnabled: boolean,
  eraUnitScale: number,
  transitionKey: string
): Promise<void> {
  // PLANTS RETURNS CAPACITY, NOT FILL-DEPENDENT REVENUE.
  //
  // Same rule `restoreSectorsToUnowned` applies on the abandon/dissolution path,
  // and for the same reason twice over. (1) Under plants `revenue` is what the
  // market actually cleared against the plant, so a sector running at 40%
  // utilization would hand the pool 40% of the market it was occupying and the
  // other 60% would simply cease to exist. (2) A MOTHBALLED sector reports
  // revenue 0 with its capital stock fully intact — the old `revenueAnchor > 0`
  // gate skipped the pool write entirely and then fell through to the
  // unconditional `deleteOne` below, so the state paid replacement-cost book
  // compensation for a plant that it then deleted from the world.
  //
  // Under plants the released quantity is therefore the sector's CAPACITY —
  // built stock plus undelivered build orders, priced through the sector's OWN
  // strategy mix into the pool's default-mix units, exactly as
  // `restoreSectorsToUnowned` does it so the two release paths cannot disagree.
  // Both legs are ₳-native, so no FX enters the capacity leg.
  //
  // Below plants `plantsEnabled` is false and every line here is byte-identical
  // to the previous behaviour: the ₳ revenue leg, gated on `revenueAnchor > 0`.
  const stock =
    typeof sector.capitalStock === "number" && Number.isFinite(sector.capitalStock)
      ? Math.max(0, sector.capitalStock)
      : 0;
  const queuedUnits = plantsEnabled
    ? (Array.isArray(sector.buildQueue) ? sector.buildQueue : []).reduce(
        (sum, order) =>
          sum +
          (order != null && Number.isFinite(order.unitsOrdered) && order.unitsOrdered > 0
            ? order.unitsOrdered
            : 0),
        0
      )
    : 0;
  const capacityAnchor = plantsEnabled
    ? Math.max(
        0,
        Math.round(
          (stock + queuedUnits) *
            revenuePerCapacityUnitForStrategy(
              sector.sectorType as CorporationType,
              sector.strategyId,
              eraUnitScale,
              sector.industryModel,
              sector.mediaDiscriminator
            )
        )
      )
    : 0;
  const revenueAnchor = plantsEnabled
    ? capacityAnchor
    : Math.max(0, Math.round(readCorpEconomicAnchor(sector.revenue ?? 0, currencyCode, fxRate)));
  if (revenueAnchor > 0) {
    // Pipeline update (not $inc + $setOnInsert): `headroomUnits` is DERIVED
    // from revenue and must be recomputed from the POST-increment figure in the
    // same write, or the pool's plants-mode denominator keeps describing the
    // revenue it held before this release. $inc on headroomUnits would not do:
    // on a doc predating the backfill the field is absent, so $inc would start
    // it from 0 and understate the pool permanently. Deriving from the new
    // total is self-healing either way. $setOnInsert is unavailable inside a
    // pipeline, hence the $ifNull identity seeding (same shape as
    // restoreSectorsToUnowned).
    // TIER-AWARE LEADING LEG. This used to add `revenueAnchor` to `revenue`
    // unconditionally and then restate `headroomUnits` from the new revenue
    // total — the below-plants direction, run in both tiers. Under plants that
    // was wrong twice: it led with the leg nothing authoritative reads, and the
    // restatement rebuilt the unit pool from a revenue figure that still carried
    // demand already drawn down (drawdowns clamp `headroomUnits` at 0 without
    // pushing the clamp back into `revenue` proportionally), so every foreign
    // release RESURRECTED headroom the market had already consumed.
    //
    // Now it credits whichever leg leads for the tier and lets
    // `unownedPoolTrailingSet` restate the other — identical in shape to
    // `restoreSectorsToUnowned`, which is the whole point: the two release paths
    // cannot disagree because they no longer each spell the write out.
    const unitsPerAnchor = unownedHeadroomUnitsPerAnchor(
      sector.sectorType as CorporationType,
      eraUnitScale,
      sector.industryModel,
      sector.mediaDiscriminator
    );
    const sectorType = sector.sectorType as CorporationType;
    const creditField = unownedPoolLeadingField(plantsEnabled);
    // The delta in the leading leg's own units. `revenueAnchor` is ₳ either way;
    // under plants it converts through the pool's default mix, the same
    // conversion `restoreSectorsToUnowned` applies to its capacity leg.
    const creditAmount = plantsEnabled ? revenueAnchor * unitsPerAnchor : revenueAnchor;
    // The pool row this release creates carries a countryId every reader filters
    // on, so it is the country the STATE is in and never whatever the sector
    // last stored (ticket #1271: the same defect `buildCapacity`, `expandSector`,
    // `restoreSectorsToUnowned` and the shed passes carried). Only read when the
    // row may not exist yet, since `$ifNull` leaves an existing row's country
    // alone either way.
    const releaseState = await db
      .collection<State>("states")
      .findOne({ _id: sector.stateId }, { projection: { countryId: 1 } });
    const releaseCountryId = releaseState?.countryId ?? sector.countryId;
    const restoreToken = sector._id.toHexString();
    const retryWindowStart = new Date(now.getTime() - UNOWNED_RELEASE_RETRY_WINDOW_MS);
    await db.collection<UnownedSector>("unownedSectors").findOneAndUpdate(
      {
        stateId: sector.stateId,
        sectorType: sector.sectorType,
        ...(sector.industryModel != null || sector.sectorType === "manufacturing"
          ? { industryModel: sector.industryModel ?? null }
          : {}),
        mediaDiscriminator: sector.mediaDiscriminator ?? null,
      },
      [
        {
          $set: {
            _id: { $ifNull: ["$_id", new ObjectId()] },
            stateId: { $ifNull: ["$stateId", sector.stateId] },
            countryId: { $ifNull: ["$countryId", releaseCountryId] },
            sectorType: { $ifNull: ["$sectorType", sector.sectorType] },
            ...(sector.industryModel != null || sector.sectorType === "manufacturing"
              ? { industryModel: { $ifNull: ["$industryModel", sector.industryModel ?? null] } }
              : {}),
            mediaDiscriminator: {
              $ifNull: ["$mediaDiscriminator", sector.mediaDiscriminator ?? null],
            },
            createdAt: { $ifNull: ["$createdAt", now] },
            [creditField]: {
              $let: {
                vars: {
                  currentValue: unownedPoolCreditBaseExpr(
                    sectorType,
                    plantsEnabled,
                    eraUnitScale,
                    sector.industryModel
                  ),
                  recentRestores: {
                    $filter: {
                      input: { $ifNull: ["$recentCorporateSectorRestores", []] },
                      as: "restore",
                      cond: {
                        $or: [
                          { $eq: ["$$restore.pendingSourceDelete", true] },
                          { $gte: ["$$restore.restoredAt", retryWindowStart] },
                        ],
                      },
                    },
                  },
                },
                in: {
                  $let: {
                    vars: {
                      recentRestoreIds: {
                        $map: {
                          input: "$$recentRestores",
                          as: "restore",
                          in: "$$restore.sectorId",
                        },
                      },
                    },
                    in: {
                      $cond: [
                        { $in: [restoreToken, "$$recentRestoreIds"] },
                        "$$currentValue",
                        { $add: ["$$currentValue", creditAmount] },
                      ],
                    },
                  },
                },
              },
            },
            recentCorporateSectorRestores: {
              $let: {
                vars: {
                  recentRestores: {
                    $filter: {
                      input: { $ifNull: ["$recentCorporateSectorRestores", []] },
                      as: "restore",
                      cond: {
                        $or: [
                          { $eq: ["$$restore.pendingSourceDelete", true] },
                          { $gte: ["$$restore.restoredAt", retryWindowStart] },
                        ],
                      },
                    },
                  },
                },
                in: {
                  $let: {
                    vars: {
                      recentRestoreIds: {
                        $map: {
                          input: "$$recentRestores",
                          as: "restore",
                          in: "$$restore.sectorId",
                        },
                      },
                    },
                    in: {
                      $cond: [
                        { $in: [restoreToken, "$$recentRestoreIds"] },
                        "$$recentRestores",
                        {
                          $concatArrays: [
                            "$$recentRestores",
                            [
                              {
                                sectorId: restoreToken,
                                restoredAt: now,
                                pendingSourceDelete: true,
                                operationKey: transitionKey,
                              },
                            ],
                          ],
                        },
                      ],
                    },
                  },
                },
              },
            },
            updatedAt: now,
          },
        },
        {
          $set: unownedPoolTrailingSet(
            sectorType,
            plantsEnabled,
            eraUnitScale,
            sector.industryModel,
            sector.mediaDiscriminator
          ),
        },
      ],
      { upsert: true, returnDocument: "before" }
    );
    // The returned preimage acknowledges the atomic pool update. The stable
    // source-sector receipt makes a retry a no-op if a crash lands before the
    // guarded source deletion below.
  }
  const removed = await db.collection<CorporateSector>("corporateSectors").deleteOne({
    _id: sector._id,
    "constructionPropertyTransition.key": transitionKey,
  });
  if (removed.deletedCount !== 1)
    throw badRequest("The sector transition reservation was lost during release");
  if (revenueAnchor > 0) {
    const acknowledged = await db.collection<UnownedSector>("unownedSectors").findOneAndUpdate(
      {
        stateId: sector.stateId,
        sectorType: sector.sectorType,
        ...(sector.industryModel != null || sector.sectorType === "manufacturing"
          ? { industryModel: sector.industryModel ?? null }
          : {}),
        recentCorporateSectorRestores: {
          $elemMatch: {
            sectorId: sector._id.toHexString(),
            operationKey: transitionKey,
            pendingSourceDelete: true,
          },
        },
      },
      [
        {
          $set: {
            recentCorporateSectorRestores: {
              $map: {
                input: { $ifNull: ["$recentCorporateSectorRestores", []] },
                as: "restore",
                in: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ["$$restore.sectorId", sector._id.toHexString()] },
                        { $eq: ["$$restore.operationKey", transitionKey] },
                        { $eq: ["$$restore.pendingSourceDelete", true] },
                      ],
                    },
                    { $mergeObjects: ["$$restore", { pendingSourceDelete: false }] },
                    "$$restore",
                  ],
                },
              },
            },
            updatedAt: now,
          },
        },
      ],
      { returnDocument: "before" }
    );
    if (!acknowledged)
      throw new Error("The unowned pool did not acknowledge the completed sector release");
  }
}

// ── Single-sector absorption ──────────────────────────────────────────────────

export interface NationalizeSectorParams {
  countryId: CountryId;
  sectorId: ObjectId;
  tier: CompensationTier;
  consequence: TransitionConsequenceInput;
}

export interface NationalizeSectorResult {
  nationalCorporationId: ObjectId;
  /** Compensation credited to the donor's liquid capital, in the donor's currency. */
  compensationPaid: number;
  /**
   * The surviving NatCorp sector row after the taking — the re-parented donor row,
   * or the merge survivor when folded into an existing (NatCorp, state, type)
   * holding. Carries `nationalizationProvenance`, so this is the handle a reversal
   * (e.g. a SCOTUS strike-down) uses to return the sector to its prior owner.
   */
  resultingSectorId: ObjectId;
}

/**
 * Single-sector nationalization: move one (stateId, sectorType) sector into the
 * country's National Corporation; the donor corp survives and is paid
 * `sectorNPV × tier` into its liquid capital.
 *
 * Valuation reuses the canonical `computeSectorNpvSum` (the same going-concern
 * NPV used by corporate-bond-default dissolution + issuance), so the sector is
 * valued identically everywhere. That helper returns ₳ (anchor); the payout is
 * converted back to the donor's currency at the persistence boundary.
 */
export async function nationalizeSector(
  db: Db,
  params: NationalizeSectorParams
): Promise<NationalizeSectorResult> {
  const now = new Date();
  const sectors = db.collection<CorporateSector>("corporateSectors");
  const corps = db.collection<Corporation>("corporations");

  const sector = await sectors.findOne({ _id: params.sectorId });
  if (!sector) throw new Error("Sector not found");

  const donor = await corps.findOne({ _id: sector.corporationId });
  if (!donor) throw new Error("Donor corporation not found");

  // Route to the NatCorp that owns this sector type (split-off if one claims it,
  // else the primary). Future takings of a split-off type land in the right corp.
  const nationalCorp =
    sector.industryModel || sector.mediaDiscriminator
      ? await resolveNationalCorporationForSector(
          db,
          params.countryId,
          sector.sectorType,
          sector.industryModel,
          sector.mediaDiscriminator
        )
      : await resolveNationalCorporationForSector(db, params.countryId, sector.sectorType);

  // Valuation in ₳ via the canonical sector NPV (going-concern, growth-cost-net).
  const [centralBanks, fxByCurrency, donorFxRate, marketMode, gameState] = await Promise.all([
    db.collection<CentralBank>("centralBanks").find({}).toArray(),
    loadFxRatesByCurrency(db),
    getCorpFxRate(db, donor),
    getMarketSystemModeForDb(db),
    getGameState(db),
  ]);
  const plantsEnabled = marketAtLeast(marketMode, "plants");
  const primeMap = buildPrimeRateMap(centralBanks);
  // Nationalization pays on steady-state earning power (revenue − maintenance),
  // not the growth-cost-net going-concern NPV — a sector the owner is actively
  // growing must not value to €0 just because its discretionary growth spending
  // consumes its current profit (Bug #0775 follow-up).
  //
  // D11: under plants the base switches to replacement-cost book (and the
  // premium inside applyTier switches with it).
  const valuationAnchor = sectorCompensationValuationAnchor(
    sector,
    computeSectorNpvSum([sector], primeMap, donor, fxByCurrency, {
      excludeGrowthCost: true,
      plantsEnabled,
    }),
    {
      plantsEnabled,
      currentYear: gameState?.currentYear,
      currentTurn: gameState?.currentTurn,
      eraUnitScale: await loadWorldEraUnitScale(db),
    }
  );
  const payoutAnchor = applyTier(valuationAnchor, params.tier, { plantsEnabled });

  // Debit the treasury BEFORE any mutation. The debit is unconditional — an
  // unaffordable payout pushes the treasury into the hole rather than blocking
  // the taking. Seizure (0 payout) moves nothing.
  const compensationKey = `nationalize-sector:${params.countryId}:${sector._id.toString()}:${gameState?.currentTurn ?? 0}`;
  const compensationLedger = await resolveTreasuryCashOptions(db);
  const ownsFundedReservation =
    sector.constructionPropertyTransition?.key === compensationKey &&
    sector.constructionPropertyTransition.kind === "nationalization";
  if (
    hasProtectedConstructionProperty(sector) &&
    !sector.pendingFundedNationalization &&
    !ownsFundedReservation
  ) {
    throw badRequest("Resolve secured construction before nationalizing this sector");
  }
  if (
    sector.pendingFundedNationalization &&
    (sector.pendingFundedNationalization.operationKey !== compensationKey ||
      !compensationLedger?.context?.treasuryCashLedgerEnabled)
  ) {
    throw new Error("Funded nationalization retry requires its original Treasury cash mode");
  }
  if (ownsFundedReservation && !compensationLedger?.context?.treasuryCashLedgerEnabled) {
    throw new Error("Funded nationalization retry requires its original Treasury cash mode");
  }
  if (compensationLedger?.context?.treasuryCashLedgerEnabled) {
    if (
      !(await acquireConstructionPropertyTransition(
        db,
        sector,
        compensationKey,
        "nationalization",
        false,
        true
      ))
    ) {
      throw badRequest("Resolve secured construction before nationalizing this sector");
    }
    const reservation = await sectors.updateOne(
      {
        _id: sector._id,
        corporationId: donor._id,
        $or: [
          { pendingFundedNationalization: { $exists: false } },
          { pendingFundedNationalization: { operationKey: compensationKey } },
        ],
      },
      { $set: { pendingFundedNationalization: { operationKey: compensationKey } } }
    );
    if ((reservation?.matchedCount ?? 0) !== 1)
      throw new Error("Could not reserve the funded nationalization mode");
  }
  let fundedCompensationLocal: number | undefined;
  let fundedCompensationNewlySettled = false;
  let fundedTreasuryAmountLocal = 0;
  let fundedPayoutAnchor: number | undefined;
  if (compensationLedger?.context?.treasuryCashLedgerEnabled) {
    const settled = await settleFundedTreasuryCompensation(db, {
      countryId: params.countryId,
      donor,
      payoutAnchor,
      fxByCurrency,
      now,
      key: compensationKey,
      ledger: compensationLedger!,
    });
    fundedCompensationLocal = settled.donorAmountLocal;
    fundedCompensationNewlySettled = settled.newlySettled;
    fundedTreasuryAmountLocal = settled.treasuryAmountLocal;
    fundedPayoutAnchor = settled.payoutAnchor;
  } else {
    await debitTreasuryCompensation(db, params.countryId, payoutAnchor, fxByCurrency, now, {
      flow: "nationalization_compensation",
      key: compensationKey,
      ledger: compensationLedger,
    });
  }
  const effectivePayoutAnchor = fundedPayoutAnchor ?? payoutAnchor;

  // Snapshot the SOCI escalation multiplier at taking time so the transition
  // shock is fixed to today's concentration, not retroactively deepened later.
  const transitionMultiplier = sociMultiplier(
    await readStateOwnershipConcentration(db, params.countryId)
  );

  // Move the sector into the National Corporation, merging into an existing
  // (NatCorp, state, type) holding when present. Stamp the absorption turn so the
  // re-privatization cooldown (spec §13.4) can protect just-absorbed assets.
  // Brand facility-loss (Boeing rule): the donor survives a single-sector taking
  // but loses this plant to the state, so dent its brand proportional to the
  // sector's share of its revenue. Called before the sector is re-parented (the
  // aggregate still includes it). No-op when the donor has no loyalty.
  await applyBrandFacilityLoss(db, donor._id, sector.revenue);

  const resultingSectorId = await absorbSectorIntoNatCorp(
    db,
    sector,
    nationalCorp._id,
    params.consequence.turn,
    now,
    transitionMultiplier,
    plantsEnabled,
    compensationLedger?.context?.treasuryCashLedgerEnabled ? compensationKey : undefined,
    compensationLedger?.context?.treasuryCashLedgerEnabled ? compensationKey : undefined
  );

  // Credit the donor in its own currency (counterparty of the treasury debit).
  let compensationPaid = 0;
  if (payoutAnchor > 0 || (fundedCompensationLocal ?? 0) > 0) {
    compensationPaid =
      fundedCompensationLocal ??
      Math.round(anchorToCorpLiquidCapital(payoutAnchor, donor, donorFxRate));
    if (fundedCompensationLocal === undefined) {
      const credited = await corps.updateOne(
        { _id: donor._id },
        { $inc: { liquidCapital: compensationPaid }, $set: { updatedAt: now } }
      );
      if ((credited?.matchedCount ?? 0) > 0) {
        await witnessTreasuryCash(db, compensationLedger, {
          flow: "nationalization_compensation",
          account: {
            kind: "corporation",
            corpId: donor._id.toString(),
            currency: snapshotCorporationCurrency(donor),
          },
          amount: compensationPaid,
          now,
          site: "ownershipTransition:compensation",
        });
      }
    } else if (fundedCompensationNewlySettled) {
      await witnessTreasuryCash(db, compensationLedger, {
        flow: "nationalization_compensation",
        account: { kind: "government", countryId: params.countryId },
        amount: -fundedTreasuryAmountLocal,
        now,
        site: "ownershipTransition:compensation",
      });
      await witnessTreasuryCash(db, compensationLedger, {
        flow: "nationalization_compensation",
        account: {
          kind: "corporation",
          corpId: donor._id.toString(),
          currency: snapshotCorporationCurrency(donor),
        },
        amount: compensationPaid,
        now,
        site: "ownershipTransition:compensation",
      });
    }
  }

  // Politics + investor-confidence (spec §12). Compensation here is in ₳ already.
  const consequenceResult = await applyNationalizationConsequences(db, {
    countryId: params.countryId,
    method: params.consequence.method,
    tier: params.tier,
    triggers: params.consequence.triggers,
    sectorTypes: [sector.sectorType],
    valuationAnchor,
    compensationAnchor: effectivePayoutAnchor,
    foreignOwnerCountryId: donor.countryId !== params.countryId ? donor.countryId : null,
    governingPartyId: params.consequence.governingPartyId ?? null,
    turn: params.consequence.turn,
    actorCharacterId: params.consequence.actorCharacterId,
  });

  // Acquisition ledger (Register tab). Best-effort — a failed write never aborts.
  try {
    await recordNationalizationLedger(db, {
      countryId: params.countryId,
      nationalCorporationId: nationalCorp._id,
      kind: "nationalize_sector",
      method: params.consequence.method,
      triggers: params.consequence.triggers,
      tier: params.tier,
      valuationAnchor,
      compensationAnchor: effectivePayoutAnchor,
      sectorTypes: [sector.sectorType],
      formerCorpName: donor.name,
      foreignOwnerCountryId: donor.countryId !== params.countryId ? donor.countryId : null,
      confidenceBefore: consequenceResult.confidenceBefore,
      confidenceAfter: consequenceResult.confidenceAfter,
      legitimacyDelta: consequenceResult.legitimacyDelta,
      turn: params.consequence.turn,
    });
  } catch (err) {
    console.error("[nationalizationLedger] sector ledger write failed:", err);
  }

  return { nationalCorporationId: nationalCorp._id, compensationPaid, resultingSectorId };
}

// ── Whole-corp absorption ─────────────────────────────────────────────────────

export interface NationalizeWholeCorpParams {
  countryId: CountryId;
  corporationId: ObjectId;
  tier: CompensationTier;
  consequence: TransitionConsequenceInput;
}

export interface NationalizeWholeCorpResult {
  nationalCorporationId: ObjectId;
  sectorsAbsorbed: number;
  bondsAssumed: number;
  /** Total shareholder compensation paid out, in ₳. */
  shareholderPayoutAnchor: number;
}

/**
 * Whole-corp absorption (central model): pay shareholders pro-rata at
 * `valuation × tier`, move every sector into the country's National Corporation,
 * re-stamp the seized corp's issued bonds to the National Corporation (the state
 * assumes the debt — coupons keep paying, no default), then dissolve the seized
 * shell. Valuation inputs are captured BEFORE anything moves.
 */
export async function nationalizeWholeCorp(
  db: Db,
  params: NationalizeWholeCorpParams
): Promise<NationalizeWholeCorpResult> {
  const now = new Date();
  const corps = db.collection<Corporation>("corporations");
  const sectors = db.collection<CorporateSector>("corporateSectors");
  const bonds = db.collection<Bond>("bonds");

  const target = await corps.findOne({ _id: params.corporationId });
  if (!target) throw new Error("Target corporation not found");
  if (target.countryOwnerId || target.ownershipState === "stateOwned") {
    throw new Error("Cannot nationalize a state-owned corporation");
  }

  const nationalizationOperationKey = `nationalize:${params.countryId}:${target._id.toHexString()}:${params.consequence.turn}`;
  const buyoutKey = `nationalize-corporation:${params.countryId}:${target._id.toString()}:${params.consequence.turn}`;
  const ledger: TreasuryCashOptions = { context: await loadTreasuryCashContext(db) };
  const hasFundedNationalizationMarker =
    target.pendingFundedNationalization?.operationKey === nationalizationOperationKey;
  if (
    (target.pendingFundedNationalization && !hasFundedNationalizationMarker) ||
    (hasFundedNationalizationMarker && !ledger.context?.treasuryCashLedgerEnabled)
  ) {
    throw new Error("Funded nationalization retry requires Treasury cash");
  }

  const targetSectors = await sectors.find({ corporationId: target._id }).toArray();
  if (
    !ledger.context?.treasuryCashLedgerEnabled &&
    targetSectors.some(
      (sector) => sector.constructionPropertyTransition?.kind === "nationalization"
    )
  ) {
    throw new Error("Nationalization retry requires its original Treasury cash mode");
  }
  const transitionKeys = await reserveSectorsForTransition(
    db,
    targetSectors,
    "nationalization",
    nationalizationOperationKey,
    true
  );
  if (!transitionKeys) {
    throw badRequest("Resolve secured construction before nationalizing this corporation");
  }
  if (ledger.context?.treasuryCashLedgerEnabled) {
    const marker = await corps.updateOne(
      {
        _id: target._id,
        $or: [
          { pendingFundedNationalization: { $exists: false } },
          { pendingFundedNationalization: { operationKey: nationalizationOperationKey } },
        ],
      },
      {
        $set: {
          pendingFundedNationalization: { operationKey: nationalizationOperationKey },
          updatedAt: now,
        },
      }
    );
    if ((marker?.matchedCount ?? 0) !== 1)
      throw new Error("Could not reserve the funded nationalization mode");
  }
  const transitionKeyBySectorId = new Map(
    targetSectors.map((sector, index) => [sector._id.toHexString(), transitionKeys[index]])
  );

  // The primary NatCorp is the bond-assumption target + the canonical return.
  // Individual sectors may route to split-offs (resolved per type below).
  const nationalCorp = await ensurePrimaryNationalCorporation(db, params.countryId);

  // ── 1. Capture valuation inputs BEFORE moving sectors/bonds (₳). ──
  const [
    targetBonds,
    heldStakes,
    centralBanks,
    fxByCurrency,
    targetFxRate,
    marketMode,
    corpGameState,
  ] = await Promise.all([
    bonds.find({ corporationId: target._id, matured: false }).toArray(),
    corps
      .find(
        { "shareholders.corporationId": target._id },
        { projection: { shareholders: 1, sharePrice: 1, liquidCurrencyCode: 1, countryId: 1 } }
      )
      .toArray(),
    db.collection<CentralBank>("centralBanks").find({}).toArray(),
    loadFxRatesByCurrency(db),
    getCorpFxRate(db, target),
    getMarketSystemModeForDb(db),
    getGameState(db),
  ]);
  const corpPlantsEnabled = marketAtLeast(marketMode, "plants");
  const corpEraUnitScale = await loadWorldEraUnitScale(db);
  const primeMap = buildPrimeRateMap(centralBanks);
  // Steady-state valuation for the whole-corp payout — see nationalizeSector.
  // D11: under plants the sector leg of balance-sheet equity is replacement-cost
  // book, not capitalized earnings.
  const sectorNpvAnchor = corpPlantsEnabled
    ? sumSectorBookValueAnchor(
        targetSectors,
        corpGameState?.currentYear,
        corpEraUnitScale,
        corpGameState?.currentTurn
      )
    : computeSectorNpvSum(targetSectors, primeMap, target, fxByCurrency, {
        excludeGrowthCost: true,
      });
  const liquidCapitalAnchor = corpLiquidCapitalToAnchor(target.liquidCapital, target, targetFxRate);
  // Debt the state assumes — sum of the corp's issued, non-matured bond principal.
  const debtAnchor = sumBondPrincipalAnchor(targetBonds, fxByCurrency);
  // Shares the seized corp holds in other corporations pass to the National
  // Corporation (step 5b) as shares only, so the buyout pays the holders their
  // market value, like cash (#3041). Held bonds are still left out (conservative
  // under-valuation, never an over-pay) until the portfolio pass (P5+).
  const heldEquityAnchor = heldStakeValueAnchor(heldStakes, target._id, fxByCurrency);
  const sharePriceAnchor = corpLiquidCapitalToAnchor(target.sharePrice, target, targetFxRate);
  // D11 — base and premium must move together. Under plants the sector leg is
  // replacement-cost book and carries the BOOK premium; cash is taken at par
  // (paying a premium on cash mints money); debt nets off cash first. Pre-fix,
  // `computeWholeCorpValuation`'s max(marketCap, equity) could hand a MARKET
  // base to `applyTier`'s BOOK premium — see `wholeCorpCompensationAnchor`.
  // Below plants the original market-cap-floored path is untouched.
  let valuationAnchor: number;
  let payoutPoolAnchor: number;
  if (corpPlantsEnabled) {
    const comp = wholeCorpCompensationAnchor({
      sectorBookAnchor: sectorNpvAnchor,
      nonSectorAssetsAnchor: liquidCapitalAnchor + heldEquityAnchor,
      debtAnchor,
      tier: params.tier,
    });
    valuationAnchor = comp.valuationAnchor;
    payoutPoolAnchor = comp.payoutAnchor;
  } else {
    valuationAnchor = computeWholeCorpValuation({
      sharePrice: sharePriceAnchor,
      totalShares: target.totalShares,
      balanceSheetEquity: liquidCapitalAnchor + sectorNpvAnchor + heldEquityAnchor,
      debt: debtAnchor,
    });
    payoutPoolAnchor = applyTier(valuationAnchor, params.tier);
  }

  // ── 2. Debit the treasury BEFORE any mutation. Unconditional — an unaffordable
  //       taking deepens the treasury's debt rather than being blocked. The pool
  //       passes through the seized corporation, where every holder row settles. ──
  if (ledger.context?.treasuryCashLedgerEnabled) {
    await settleFundedWholeCorpShareholderPool(db, {
      countryId: params.countryId,
      target,
      poolAnchor: payoutPoolAnchor,
      fxByCurrency,
      forexEnabled: await isForexEnabled(),
      ledger,
      key: buyoutKey,
      now,
    });
  } else {
    await debitTreasuryCompensation(db, params.countryId, payoutPoolAnchor, fxByCurrency, now, {
      flow: "nationalization_buyout_pool",
      key: buyoutKey,
      ledger,
      passThroughCorpId: target._id.toString(),
    });

    // ── 3. Pay shareholders pro-rata (counterparty of the treasury debit). ──
    if (payoutPoolAnchor > 0) {
      await payShareholders(db, target, payoutPoolAnchor, fxByCurrency, now, {
        turn: ledger.context?.turn ?? params.consequence.turn,
        kind: "nationalize_whole",
        treasury: ledger,
      });
    }
  }

  // ── 3b. Settle the dissolved corp's liquid cash (Bug #0775). The shell is
  //       deleted below, so its `liquidCapital` must be distributed rather than
  //       silently destroyed. The state recoups the cash up to the compensation
  //       it just paid shareholders (the buyout already valued that cash); any
  //       cash BEYOND the buyout is paid to the CEO. A seizure (no compensation)
  //       or a vacant seat routes all of it to the treasury. Conserves money:
  //       ceoSurplus + treasuryRecoup === liquidCapital always.
  const forexEnabled = await isForexEnabled();
  if (liquidCapitalAnchor > 0 || ledger.context?.treasuryCashLedgerEnabled) {
    const ceoChar =
      params.tier === "seizure" || target.ceoVacant || !target.ceoId
        ? null
        : await db.collection<Character>("characters").findOne({ _id: target.ceoId });
    const ceoSurplusAnchor = ceoChar ? Math.max(0, liquidCapitalAnchor - payoutPoolAnchor) : 0;
    const treasuryCashAnchor = liquidCapitalAnchor - ceoSurplusAnchor;

    if (ledger.context?.treasuryCashLedgerEnabled) {
      await settleFundedWholeCorpLiquidation(db, {
        countryId: params.countryId,
        target,
        ceo: ceoChar,
        ceoSurplusAnchor,
        treasuryCashAnchor,
        liquidCapitalAnchor,
        fxByCurrency,
        forexEnabled,
        ledger,
        key: buyoutKey,
        now,
      });
    } else {
      if (ceoChar && ceoSurplusAnchor > 0) {
        const currency = getHomeCurrency(ceoChar, corpGameState?.preset);
        const rate = fxByCurrency.get(currency as CurrencyCode) ?? 1;
        const amt = Math.round(forexEnabled ? ceoSurplusAnchor * rate : ceoSurplusAnchor);
        const credited = await db
          .collection<Character>("characters")
          .updateOne(
            { _id: ceoChar._id },
            { $inc: buildPersonalBalanceInc(amt, currency, forexEnabled), $set: { updatedAt: now } }
          );
        if ((credited?.matchedCount ?? 0) > 0) {
          await witnessTreasuryCash(db, ledger, {
            flow: "corporation_liquidation",
            account: { kind: "character", characterId: ceoChar._id.toString(), currency },
            amount: amt,
            now,
            site: "ownershipTransition:ceoSurplus",
          });
        }
      }
      if (treasuryCashAnchor > 0) {
        await creditTreasuryProceedsFromAnchor(db, params.countryId, treasuryCashAnchor, now, {
          flow: "corporation_liquidation",
          ledger,
        });
      }
    }
  }

  // ── 4. Partition by jurisdiction. DOMESTIC sectors are absorbed into the
  //       NatCorp that owns each sector TYPE (a taking spanning multiple types
  //       fans across split-offs + primary; each MERGES into the NatCorp's
  //       existing (state, type) holding so a repeat can't collide on the unique
  //       index). FOREIGN sectors (operated outside this country) cannot be held
  //       under another jurisdiction — they are released to the open unowned
  //       market. A sector with no countryId defaults to domestic (legacy-safe).
  const domesticSectors = targetSectors.filter(
    (s) => !s.countryId || s.countryId === params.countryId
  );
  const foreignSectors = targetSectors.filter(
    (s) => s.countryId && s.countryId !== params.countryId
  );

  // Snapshot the SOCI escalation multiplier at taking time (one value for the
  // whole-corp taking) so the transition shock is fixed to today's concentration.
  const transitionMultiplier = sociMultiplier(
    await readStateOwnershipConcentration(db, params.countryId)
  );

  const destByType = new Map<string, ObjectId>();
  for (const s of domesticSectors) {
    const modelKey = `${s.sectorType}:${s.industryModel ?? ""}:${s.mediaDiscriminator ?? ""}`;
    let destId = destByType.get(modelKey);
    if (!destId) {
      const dest =
        s.industryModel || s.mediaDiscriminator
          ? await resolveNationalCorporationForSector(
              db,
              params.countryId,
              s.sectorType,
              s.industryModel,
              s.mediaDiscriminator
            )
          : await resolveNationalCorporationForSector(db, params.countryId, s.sectorType);
      destId = dest._id;
      destByType.set(modelKey, destId);
    }
    await absorbSectorIntoNatCorp(
      db,
      s,
      destId,
      params.consequence.turn,
      now,
      transitionMultiplier,
      corpPlantsEnabled,
      transitionKeyBySectorId.get(s._id.toHexString())!
    );
  }
  for (const s of foreignSectors) {
    // A foreign sector's revenue is stored in ITS host-state currency, not the
    // (donor) corp's — convert to the ₳-native unowned pool at the host rate.
    await releaseForeignSectorToUnowned(
      db,
      s,
      resolveSectorHostCurrencyCode(s, target),
      fxRateForSectorHostFromMap(s, target, fxByCurrency),
      now,
      corpPlantsEnabled,
      corpEraUnitScale,
      transitionKeyBySectorId.get(s._id.toHexString())!
    );
  }

  // ── 5. State assumes the seized corp's issued bonds (re-stamp; no default). ──
  if (targetBonds.length > 0) {
    await bonds.updateMany(
      { corporationId: target._id, matured: false },
      { $set: { corporationId: nationalCorp._id, originalIssuerName: target.name, updatedAt: now } }
    );
  }

  // ── 5b. Transfer shares owned by the seized corp in other corporations. ──
  // ── 5b. Transfer shares owned by the seized corp in other corporations. ──
  // When a corporation owns shares in other corporations, those shares must be
  // transferred rather than silently destroyed during dissolution (Bug #0803).
  await transferOwnedSharesToNatCorp(db, target, nationalCorp._id, heldStakes, now);

  // ── 6. Dissolve the seized shell. ──
  await cleanupShareMarketActivityForCorporations(db, [target._id], now, forexEnabled);
  await stampSubjectDeleted(db, target._id, {
    sequentialId: target.sequentialId,
    deletedAt: now,
  });
  await deleteDissolvedCorporation(db, target._id, ledger, now, "ownershipTransition:dissolve");
  // Keep every reservation through compensation, asset transfer, share/bond
  // settlement, and shell deletion. Only release after ownership is final.
  await Promise.all(
    targetSectors.map((sector) =>
      releaseConstructionPropertyTransition(
        db,
        sector._id,
        transitionKeyBySectorId.get(sector._id.toHexString())!
      )
    )
  );

  // Politics + investor-confidence (spec §12). `target` + `targetSectors` are
  // still in scope here (captured before the shell was deleted), so the foreign
  // owner + sector types are available for framing.
  // Framing reflects what the state actually NATIONALIZED — the domestic sectors
  // taken into the NatCorp. Foreign holdings were divested to the open market.
  const sectorTypesTaken = Array.from(new Set(domesticSectors.map((s) => s.sectorType)));
  const consequenceResult = await applyNationalizationConsequences(db, {
    countryId: params.countryId,
    method: params.consequence.method,
    tier: params.tier,
    triggers: params.consequence.triggers,
    sectorTypes: sectorTypesTaken,
    valuationAnchor,
    compensationAnchor: payoutPoolAnchor,
    foreignOwnerCountryId: target.countryId !== params.countryId ? target.countryId : null,
    governingPartyId: params.consequence.governingPartyId ?? null,
    turn: params.consequence.turn,
    actorCharacterId: params.consequence.actorCharacterId,
  });

  // Acquisition ledger (Register tab). Best-effort — a failed write never aborts.
  try {
    await recordNationalizationLedger(db, {
      countryId: params.countryId,
      nationalCorporationId: nationalCorp._id,
      kind: "nationalize_whole",
      method: params.consequence.method,
      triggers: params.consequence.triggers,
      tier: params.tier,
      valuationAnchor,
      compensationAnchor: payoutPoolAnchor,
      debtAnchor,
      shareholdersSettled: target.shareholders?.length ?? 0,
      sectorTypes: sectorTypesTaken,
      formerCorpName: target.name,
      foreignOwnerCountryId: target.countryId !== params.countryId ? target.countryId : null,
      confidenceBefore: consequenceResult.confidenceBefore,
      confidenceAfter: consequenceResult.confidenceAfter,
      legitimacyDelta: consequenceResult.legitimacyDelta,
      turn: params.consequence.turn,
    });
  } catch (err) {
    console.error("[nationalizationLedger] whole-corp ledger write failed:", err);
  }

  return {
    nationalCorporationId: nationalCorp._id,
    sectorsAbsorbed: domesticSectors.length,
    bondsAssumed: targetBonds.length,
    shareholderPayoutAnchor: payoutPoolAnchor,
  };
}

/**
 * Distribute a ₳-denominated shareholder pool pro-rata across every bucket —
 * character + imperial holders (to personal cash, in home currency), corporate
 * holders (to liquidCapital), and the public float (to the country's central
 * bank reserve). Mirrors the bucket handling of the dissolution settlement so
 * no slice is silently dropped.
 */
export async function settleFundedWholeCorpShareholderPool(
  db: Db,
  input: {
    countryId: CountryId;
    target: Corporation;
    poolAnchor: number;
    fxByCurrency: ReadonlyMap<CurrencyCode, number>;
    forexEnabled: boolean;
    ledger: TreasuryCashOptions;
    key: string;
    now: Date;
  }
): Promise<void> {
  const context = input.ledger.context;
  const settlementKey = `treasury-nationalization-buyout:${input.key}`;
  const prior = await db
    .collection<{ _id: string }>("bankMoneyMoves")
    .findOne({ _id: settlementKey });
  if (prior) {
    const resumed = await resumeSettlement(db, settlementKey);
    if (resumed.status !== "applied" && !(resumed.status === "replayed" && !resumed.error))
      throw new Error(resumed.error ?? "Funded shareholder buyout is incomplete");
    return;
  }
  if (!context?.treasuryCashLedgerEnabled) throw new Error("Funded buyout requires Treasury cash");

  const allocation = allocateShareholderPool(input.target, input.poolAnchor, new Map());
  const personalRows = allocation.characterRows.filter((row) => row.payout > 0);
  const corpRows = allocation.corporationRows.filter((row) => row.payout > 0);
  const fundRows = allocation.fundRows.filter((row) => row.payout > 0);
  const floatPayout = allocation.publicFloatRow?.payout ?? 0;
  const totalAnchor =
    personalRows.reduce((sum, row) => sum + row.payout, 0) +
    corpRows.reduce((sum, row) => sum + row.payout, 0) +
    fundRows.reduce((sum, row) => sum + row.payout, 0) +
    floatPayout;
  if (!(totalAnchor > 0)) return;

  const [personalDocs, imperialDocs, corpDocs, funds] = await Promise.all([
    db
      .collection<Character>("characters")
      .find({
        _id: {
          $in: personalRows
            .filter((row) => !row.isImperial)
            .map((row) => new ObjectId(row.characterId)),
        },
      })
      .toArray(),
    db
      .collection<ImperialCharacter>("imperialCharacters")
      .find({
        _id: {
          $in: personalRows
            .filter((row) => row.isImperial)
            .map((row) => new ObjectId(row.characterId)),
        },
      })
      .toArray(),
    db
      .collection<Corporation>("corporations")
      .find({ _id: { $in: corpRows.map((row) => new ObjectId(row.corporationId)) } })
      .toArray(),
    db
      .collection<IndexFund>("indexFunds")
      .find({ _id: { $in: fundRows.map((row) => new ObjectId(row.fundId)) } })
      .toArray(),
  ]);
  const personalById = new Map(
    [...personalDocs, ...imperialDocs].map((doc) => [doc._id.toString(), doc])
  );
  const corpById = new Map(corpDocs.map((doc) => [doc._id.toString(), doc]));
  const fundById = new Map(funds.map((doc) => [doc._id.toString(), doc]));
  if (personalRows.some((row) => !personalById.has(row.characterId)))
    throw new Error("Funded buyout shareholder is missing");
  if (corpRows.some((row) => !corpById.has(row.corporationId)))
    throw new Error("Funded buyout corporate shareholder is missing");
  if (fundRows.some((row) => !fundById.has(row.fundId)))
    throw new Error("Funded buyout index-fund shareholder is missing");

  const treasuryCurrency =
    context.treasuryCurrencies.get(input.countryId) ??
    COUNTRY_CURRENCY_MAP[input.countryId] ??
    "USD";
  const treasuryRate = treasuryAnchorValuation({
    countryId: input.countryId,
    currencyCode: treasuryCurrency,
    preset: context.preset,
    observedRate: context.rates.get(treasuryCurrency),
  }).anchorRate;
  const treasuryLocal = Math.round(
    writeGovBudgetLocal(totalAnchor, treasuryCurrency, treasuryRate)
  );
  if (!(treasuryLocal > 0))
    throw new Error("Funded buyout rounded to a non-positive Treasury debit");
  const budget = await db
    .collection<{ countryId: string; currencyCode?: CurrencyCode | null }>("federalBudget")
    .findOne({ countryId: input.countryId }, { projection: { countryId: 1, currencyCode: 1 } });
  if (!budget) throw new Error("Funded buyout Treasury account is missing");
  const treasuryFilter: Record<string, unknown> = { countryId: budget.countryId };
  if (Object.prototype.hasOwnProperty.call(budget, "currencyCode"))
    treasuryFilter.currencyCode =
      budget.currencyCode === null ? { $type: 10 } : budget.currencyCode;
  else treasuryFilter.currencyCode = { $exists: false };
  const legs: TransitionLeg[] = [
    {
      kind: "debit",
      amount: treasuryLocal,
      valuation: { currencyCode: treasuryCurrency, localPerAnchor: treasuryLocal / totalAnchor },
      collection: "federalBudget",
      filter: { ...treasuryFilter, treasuryCashLocal: { $gte: treasuryLocal } },
      path: "treasuryCashLocal",
      note: "Fund whole-corporation nationalization shareholder pool",
    },
  ];
  if (floatPayout > 0) {
    const amount = Math.round(writeGovBudgetLocal(floatPayout, treasuryCurrency, treasuryRate));
    legs.push({
      kind: "credit",
      amount,
      valuation: { currencyCode: treasuryCurrency, localPerAnchor: amount / floatPayout },
      collection: "federalBudget",
      filter: treasuryFilter,
      path: "treasuryCashLocal",
      note: "Return the public-float shareholder allocation to Treasury",
    });
  }
  const requireRate = (currency: CurrencyCode): number => {
    const rate = input.fxByCurrency.get(currency);
    if (rate === undefined || !Number.isFinite(rate) || rate <= 0)
      throw new Error(`Missing funded buyout FX rate for ${currency}`);
    return rate;
  };
  for (const row of personalRows) {
    const holder = personalById.get(row.characterId)!;
    const currency = getHomeCurrency(holder);
    const local = input.forexEnabled ? row.payout * requireRate(currency) : row.payout;
    const path = Object.keys(buildPersonalBalanceInc(1, currency, input.forexEnabled))[0]!;
    const holderFilter: Record<string, unknown> = { _id: holder._id };
    if (input.forexEnabled) holderFilter.countryId = holder.countryId;
    legs.push({
      kind: "credit",
      amount: local,
      valuation: {
        currencyCode: input.forexEnabled ? currency : "USD",
        localPerAnchor: local / row.payout,
      },
      collection: row.isImperial ? "imperialCharacters" : "characters",
      filter: holderFilter,
      path,
      note: `Pay frozen personal shareholder ${row.characterId}`,
    });
  }
  for (const row of corpRows) {
    const holder = corpById.get(row.corporationId)!;
    const currency = resolveCorpLiquidCurrencyCode(holder);
    if (!currency)
      throw new Error(`Missing funded buyout currency for corporation ${row.corporationId}`);
    const rate = requireRate(currency);
    const local = Math.round(anchorToCorpLiquidCapital(row.payout, holder, rate));
    const filter: Record<string, unknown> = { _id: holder._id };
    if (holder.liquidCurrencyCode == null || !String(holder.liquidCurrencyCode).trim()) {
      filter.liquidCurrencyCode =
        holder.liquidCurrencyCode === undefined
          ? { $exists: false }
          : holder.liquidCurrencyCode === null
            ? { $type: 10 }
            : holder.liquidCurrencyCode;
      filter.countryId = holder.countryId === undefined ? { $exists: false } : holder.countryId;
    } else {
      filter.liquidCurrencyCode = holder.liquidCurrencyCode;
    }
    legs.push({
      kind: "credit",
      amount: local,
      valuation: { currencyCode: currency, localPerAnchor: local / row.payout },
      collection: "corporations",
      filter,
      path: "liquidCapital",
      note: `Pay frozen corporate shareholder ${row.corporationId}`,
    });
  }
  for (const row of fundRows) {
    legs.push({
      kind: "credit",
      amount: row.payout,
      valuation: { currencyCode: "USD", localPerAnchor: 1 },
      collection: "indexFunds",
      filter: {
        _id: new ObjectId(row.fundId),
        anchorCurrencyCode: fundById.get(row.fundId)!.anchorCurrencyCode,
      },
      path: "cashAnchor",
      note: `Pay frozen index-fund shareholder ${row.fundId}`,
    });
  }
  const projections = [
    {
      collection: "federalBudget",
      filter: treasuryFilter,
      update: {
        $inc: {
          treasuryBalance:
            -treasuryLocal +
            Math.round(writeGovBudgetLocal(floatPayout, treasuryCurrency, treasuryRate)),
        },
        $set: { updatedAt: input.now },
      },
      note: "Update signed fiscal position for funded shareholder buyout",
    },
  ];
  const transition: BankingTransition = {
    key: settlementKey,
    kind: "nationalization_shareholder_pool",
    turn: context.turn,
    currency: treasuryCurrency,
    retryCreditLegOnGuardFailure: true,
    legs,
    projections,
    event: {
      kind: "monetary.executed",
      command: "nationalization.whole_corporation_buyout",
      subjectType: "corporation",
      subjectId: input.target._id.toString(),
      amount: treasuryLocal,
      meta: { flow: "nationalization_buyout_pool", holders: legs.length - 1 },
    },
  };
  const settled = await settleTransition(db, transition);
  if (settled.status !== "applied" && !(settled.status === "replayed" && !settled.error))
    throw new Error(settled.error ?? "Funded shareholder buyout is incomplete");
}

async function settleFundedWholeCorpLiquidation(
  db: Db,
  input: {
    countryId: CountryId;
    target: Corporation;
    ceo: Character | null;
    ceoSurplusAnchor: number;
    treasuryCashAnchor: number;
    liquidCapitalAnchor: number;
    fxByCurrency: ReadonlyMap<CurrencyCode, number>;
    forexEnabled: boolean;
    ledger: TreasuryCashOptions;
    key: string;
    now: Date;
  }
): Promise<void> {
  const context = input.ledger.context;
  const settlementKey = `treasury-nationalization-liquidation:${input.key}`;
  if (await db.collection<{ _id: string }>("bankMoneyMoves").findOne({ _id: settlementKey })) {
    const resumed = await resumeSettlement(db, settlementKey);
    if (resumed.status !== "applied" && !(resumed.status === "replayed" && !resumed.error))
      throw new Error(resumed.error ?? "Funded corporation liquidation is incomplete");
    return;
  }
  if (!context?.treasuryCashLedgerEnabled)
    throw new Error("Funded corporation liquidation requires Treasury cash");
  if (!(input.liquidCapitalAnchor > 0)) return;

  const sourceCurrency = resolveCorpLiquidCurrencyCode(input.target);
  if (!sourceCurrency) throw new Error("Funded corporation liquidation has no source currency");
  const sourceRate = input.fxByCurrency.get(sourceCurrency);
  if (sourceRate === undefined || !Number.isFinite(sourceRate) || sourceRate <= 0)
    throw new Error(`Missing funded liquidation FX rate for ${sourceCurrency}`);
  const sourceLocal = input.target.liquidCapital;
  if (!(sourceLocal > 0) || !Number.isFinite(sourceLocal))
    throw new Error("Funded corporation liquidation has no valid source cash");
  const legs: TransitionLeg[] = [
    {
      kind: "debit",
      amount: sourceLocal,
      valuation: {
        currencyCode: sourceCurrency,
        localPerAnchor: sourceLocal / input.liquidCapitalAnchor,
      },
      collection: "corporations",
      filter: {
        _id: input.target._id,
        liquidCapital: { $gte: sourceLocal },
        ...(input.target.liquidCurrencyCode === undefined
          ? { liquidCurrencyCode: { $exists: false } }
          : input.target.liquidCurrencyCode === null
            ? { liquidCurrencyCode: { $type: 10 } }
            : { liquidCurrencyCode: input.target.liquidCurrencyCode }),
        ...(!input.target.liquidCurrencyCode || !String(input.target.liquidCurrencyCode).trim()
          ? { countryId: input.target.countryId }
          : {}),
      },
      path: "liquidCapital",
      note: "Fund the dissolved corporation's frozen liquidation proceeds",
    },
  ];
  if (input.ceo && input.ceoSurplusAnchor > 0) {
    const currency = getHomeCurrency(input.ceo);
    const rate = input.forexEnabled ? input.fxByCurrency.get(currency) : 1;
    if (input.forexEnabled && (rate === undefined || !Number.isFinite(rate) || rate <= 0))
      throw new Error(`Missing funded liquidation FX rate for CEO currency ${currency}`);
    const local = input.forexEnabled ? input.ceoSurplusAnchor * rate! : input.ceoSurplusAnchor;
    const path = Object.keys(buildPersonalBalanceInc(1, currency, input.forexEnabled))[0]!;
    legs.push({
      kind: "credit",
      amount: local,
      valuation: {
        currencyCode: input.forexEnabled ? currency : "USD",
        localPerAnchor: local / input.ceoSurplusAnchor,
      },
      collection: "characters",
      filter: {
        _id: input.ceo._id,
        ...(input.forexEnabled ? { countryId: input.ceo.countryId } : {}),
      },
      path,
      note: "Pay the frozen executive share of corporation liquidation cash",
    });
  }
  const treasuryCurrency =
    context.treasuryCurrencies.get(input.countryId) ??
    COUNTRY_CURRENCY_MAP[input.countryId] ??
    "USD";
  const treasuryRate = treasuryAnchorValuation({
    countryId: input.countryId,
    currencyCode: treasuryCurrency,
    preset: context.preset,
    observedRate: context.rates.get(treasuryCurrency),
  }).anchorRate;
  const treasuryLocal = Math.round(
    writeGovBudgetLocal(input.treasuryCashAnchor, treasuryCurrency, treasuryRate)
  );
  let treasuryFilter: Record<string, unknown> | undefined;
  if (treasuryLocal > 0) {
    const budget = await db
      .collection<{ countryId: string; currencyCode?: CurrencyCode | null }>("federalBudget")
      .findOne({ countryId: input.countryId }, { projection: { countryId: 1, currencyCode: 1 } });
    if (!budget) throw new Error("Funded liquidation Treasury account is missing");
    treasuryFilter = { countryId: budget.countryId };
    if (Object.prototype.hasOwnProperty.call(budget, "currencyCode"))
      treasuryFilter.currencyCode =
        budget.currencyCode === null ? { $type: 10 } : budget.currencyCode;
    else treasuryFilter.currencyCode = { $exists: false };
    legs.push({
      kind: "credit",
      amount: treasuryLocal,
      valuation: {
        currencyCode: treasuryCurrency,
        localPerAnchor: treasuryLocal / input.treasuryCashAnchor,
      },
      collection: "federalBudget",
      filter: treasuryFilter,
      path: "treasuryCashLocal",
      note: "Return the frozen residual liquidation cash to Treasury",
    });
  }
  const transition: BankingTransition = {
    key: settlementKey,
    kind: "nationalization_corporation_liquidation",
    turn: context.turn,
    currency: sourceCurrency,
    legs,
    retryCreditLegOnGuardFailure: true,
    projections:
      treasuryLocal > 0 && treasuryFilter
        ? [
            {
              collection: "federalBudget",
              filter: treasuryFilter,
              update: { $inc: { treasuryBalance: treasuryLocal }, $set: { updatedAt: input.now } },
              note: "Update signed fiscal position after funded liquidation proceeds",
            },
          ]
        : [],
    event: {
      kind: "monetary.executed",
      command: "nationalization.corporation_liquidation",
      subjectType: "corporation",
      subjectId: input.target._id.toString(),
      amount: sourceLocal,
      meta: { flow: "corporation_liquidation" },
    },
  };
  const settled = await settleTransition(db, transition);
  if (settled.status !== "applied" && !(settled.status === "replayed" && !settled.error))
    throw new Error(settled.error ?? "Funded corporation liquidation is incomplete");
}

export async function payShareholders(
  db: Db,
  target: Corporation,
  poolAnchor: number,
  fxByCurrency: ReadonlyMap<CurrencyCode, number>,
  now: Date,
  ledger?: PayShareholdersLedgerContext
): Promise<void> {
  const allocation = allocateShareholderPool(target, poolAnchor, new Map());
  const forexEnabled = await isForexEnabled();
  // Ledger legs for every holder credited below. Collected here and flushed once
  // at the end so a throw part-way through does not log money that was reversed.
  const ledgerEntries: PayShareholdersTxInput[] = [];

  const anchorToLocal = (amtAnchor: number, currency: string): number => {
    const rate = fxByCurrency.get(currency as CurrencyCode);
    return Number.isFinite(rate) && rate && rate > 0 ? amtAnchor * rate : amtAnchor;
  };

  // Character + imperial holders → personal cash, split by collection.
  const charRows = allocation.characterRows.filter((r) => !r.isImperial && r.payout > 0);
  const imperialRows = allocation.characterRows.filter((r) => r.isImperial && r.payout > 0);

  if (charRows.length > 0) {
    const ids = charRows.map((r) => new ObjectId(r.characterId));
    const docs = await db
      .collection<Character>("characters")
      .find({ _id: { $in: ids } })
      .toArray();
    const currencyById = new Map(docs.map((c) => [c._id.toString(), getHomeCurrency(c)]));
    await db.collection<Character>("characters").bulkWrite(
      charRows.map((r) => {
        const currency = currencyById.get(r.characterId) ?? "USD";
        const amt = forexEnabled ? anchorToLocal(r.payout, currency) : r.payout;
        if (ledger)
          ledgerEntries.push(
            buyoutPayoutLeg(ledger, target, "character", new ObjectId(r.characterId), amt, currency)
          );
        return {
          updateOne: {
            filter: { _id: new ObjectId(r.characterId) },
            update: {
              $inc: buildPersonalBalanceInc(amt, currency, forexEnabled),
              $set: { updatedAt: now },
            },
          },
        };
      })
    );
  }

  if (imperialRows.length > 0) {
    const ids = imperialRows.map((r) => new ObjectId(r.characterId));
    const docs = await db
      .collection<ImperialCharacter>("imperialCharacters")
      .find({ _id: { $in: ids } })
      .toArray();
    const currencyById = new Map(docs.map((c) => [c._id.toString(), getHomeCurrency(c)]));
    await db.collection<ImperialCharacter>("imperialCharacters").bulkWrite(
      imperialRows.map((r) => {
        const currency = currencyById.get(r.characterId) ?? "USD";
        const amt = forexEnabled ? anchorToLocal(r.payout, currency) : r.payout;
        if (ledger)
          ledgerEntries.push(
            buyoutPayoutLeg(
              ledger,
              target,
              "character",
              new ObjectId(r.characterId),
              amt,
              currency,
              {
                imperial: true,
              }
            )
          );
        return {
          updateOne: {
            filter: { _id: new ObjectId(r.characterId) },
            update: {
              $inc: buildPersonalBalanceInc(amt, currency, forexEnabled),
              $set: { updatedAt: now },
            },
          },
        };
      })
    );
  }

  // Corporate equity holders → liquidCapital, in each corp's home currency.
  const corpRows = allocation.corporationRows.filter((r) => r.payout > 0);
  if (corpRows.length > 0) {
    const ids = corpRows.map((r) => new ObjectId(r.corporationId));
    const docs = await db
      .collection<Corporation>("corporations")
      .find({ _id: { $in: ids } })
      .toArray();
    const corpById = new Map(docs.map((c) => [c._id.toString(), c]));
    await db.collection<Corporation>("corporations").bulkWrite(
      corpRows.map((r) => {
        const creditor = corpById.get(r.corporationId);
        const creditorCurrency = (creditor?.liquidCurrencyCode ??
          COUNTRY_CURRENCY_MAP[creditor?.countryId as CountryId] ??
          "USD") as CurrencyCode;
        const rate = fxByCurrency.get(creditorCurrency) ?? 1;
        const amtInCapital = Math.round(anchorToCorpLiquidCapital(r.payout, creditor ?? {}, rate));
        if (ledger)
          ledgerEntries.push(
            buyoutPayoutLeg(
              ledger,
              target,
              "corporation",
              new ObjectId(r.corporationId),
              amtInCapital,
              creditorCurrency
            )
          );
        return {
          updateOne: {
            filter: { _id: new ObjectId(r.corporationId) },
            update: { $inc: { liquidCapital: amtInCapital }, $set: { updatedAt: now } },
          },
        };
      })
    );
  }

  // Public float → the national treasury (no value dropped). Same unified
  // treasury the rest of the nationalization money flows move (spec §5).
  if (allocation.publicFloatRow && allocation.publicFloatRow.payout > 0) {
    // The treasury leg settles against the seized corporation like the holder rows.
    await creditTreasuryProceedsFromAnchor(
      db,
      target.countryId,
      allocation.publicFloatRow.payout,
      now,
      ledger
        ? {
            flow: "nationalization_buyout_float",
            key: `nationalize-float:${target._id.toString()}:${ledger.turn}`,
            ledger: ledger.treasury,
            passThroughCorpId: target._id.toString(),
          }
        : undefined
    );
  }

  // Index-fund shareholders → fund cash (₳). Same pool, no FX (cashAnchor is ₳).
  // #3451: previously dropped by allocateShareholderPool. The whole-corp shell is
  // deleted after this transition, so the fund's holding of it is pulled too.
  // #992 tranche 3: fund rows are ledgered with the same share_buyout_payout
  // type as every other holder bucket now that fund cash is a ledger account.
  if (allocation.fundRows.length > 0) {
    const { txEntries: fundTxEntries } = await payFundShareholderRows(
      db,
      allocation.fundRows,
      target._id,
      now,
      {
        ledger: ledger
          ? {
              turn: ledger.turn,
              txType: "share_buyout_payout",
              kind: ledger.kind,
              counterpartyId: target._id,
              counterpartyName: target.name,
            }
          : undefined,
      }
    );
    if (ledger) ledgerEntries.push(...fundTxEntries);
  }

  // Flush every holder leg in one insert.
  if (ledger && ledgerEntries.length > 0) {
    await emitTxBulk(db, ledgerEntries, await loadTxThresholds(db));
  }
}

/** Ledger context for {@link payShareholders}; omit to skip emission entirely. */
export interface PayShareholdersLedgerContext {
  turn: number;
  /** Short marker for what moved the money, e.g. "agreed_acquisition". */
  kind: string;
  /** Witness context for the public float's treasury leg. */
  treasury?: TreasuryCashOptions;
}

type PayShareholdersTxInput = Omit<FinancialTxLogEntry, "_id" | "expiresAt" | "flagged">;

/** One holder-side buyout credit, counterparty being the corp being bought out. */
function buyoutPayoutLeg(
  ledger: PayShareholdersLedgerContext,
  target: Corporation,
  subjectType: "character" | "corporation",
  subjectId: ObjectId,
  amount: number,
  currencyCode: string,
  meta?: Record<string, unknown>
): PayShareholdersTxInput {
  return {
    type: "share_buyout_payout",
    turn: ledger.turn,
    createdAt: new Date(),
    subjectType,
    subjectId,
    subjectName: subjectType === "corporation" ? "(corp shareholder)" : "(shareholder)",
    // The exact credited amount: wallets are credited unrounded, so a rounded row
    // would leave the holder's stock check off by the fraction.
    amount,
    currencyCode: currencyCode as CurrencyCode,
    counterpartyType: "corporation",
    counterpartyId: target._id,
    counterpartyName: target.name,
    meta: { kind: ledger.kind, ...(meta ?? {}) },
  };
}

/** One corporation the seized corporation holds shares in, as read for the taking. */
type HeldStake = Pick<
  Corporation,
  "_id" | "shareholders" | "sharePrice" | "liquidCurrencyCode" | "countryId"
>;

/** Market value, in ₳, of the shares the seized corporation holds in other corporations. */
function heldStakeValueAnchor(
  stakes: HeldStake[],
  seizedCorpId: ObjectId,
  fxByCurrency: ReadonlyMap<CurrencyCode, number>
): number {
  let total = 0;
  for (const stake of stakes) {
    const shares =
      stake.shareholders?.find((sh) => sh.corporationId?.equals(seizedCorpId))?.shares ?? 0;
    if (!(shares > 0)) continue;
    total += corpLiquidCapitalToAnchor(
      shares * (stake.sharePrice ?? 0),
      stake,
      fxByCurrency.get(stake.liquidCurrencyCode as CurrencyCode) ?? 1
    );
  }
  return total;
}

/**
 * Transfer shares owned by the seized corporation in other corporations to the
 * National Corporation. When a corporation owns shares in other corporations,
 * those shares must be transferred rather than silently destroyed during
 * dissolution (Bug #0803). They move as shares only: the buyout already paid
 * the seized corporation's holders their market value (#3041), so crediting
 * that value again as cash would create money.
 */
async function transferOwnedSharesToNatCorp(
  db: Db,
  seizedCorp: Corporation,
  nationalCorpId: ObjectId,
  heldStakes: HeldStake[],
  now: Date
): Promise<void> {
  const corps = db.collection<Corporation>("corporations");

  for (const targetCorp of heldStakes) {
    const shareholderEntry = targetCorp.shareholders?.find((sh) =>
      sh.corporationId?.equals(seizedCorp._id)
    );

    if (!shareholderEntry || shareholderEntry.shares <= 0) {
      continue;
    }
    const shares = shareholderEntry.shares;

    // Remove the seized corp's shareholder entry
    await corps.updateOne(
      { _id: targetCorp._id },
      {
        $pull: {
          shareholders: { corporationId: seizedCorp._id },
        },
        $set: { updatedAt: now },
      }
    );

    // Transfer the shares to the National Corporation as a shareholder of the
    // target corporation (not to the NatCorp's own shareholders array).
    const existingEntry = targetCorp.shareholders?.find((sh) =>
      sh.corporationId?.equals(nationalCorpId)
    );

    if (existingEntry) {
      const combinedShares = existingEntry.shares + shares;
      const combinedAvgCost =
        combinedShares > 0
          ? (existingEntry.shares * (existingEntry.avgCostPerShare ?? 0) +
              shares * (shareholderEntry.avgCostPerShare ?? 0)) /
            combinedShares
          : 0;
      await corps.updateOne(
        { _id: targetCorp._id },
        {
          $set: {
            "shareholders.$[elem].shares": combinedShares,
            "shareholders.$[elem].avgCostPerShare": combinedAvgCost,
            updatedAt: now,
          },
        },
        { arrayFilters: [{ "elem.corporationId": nationalCorpId }] }
      );
    } else {
      await corps.updateOne(
        { _id: targetCorp._id },
        {
          $push: {
            shareholders: {
              corporationId: nationalCorpId,
              shares: shares,
              avgCostPerShare: shareholderEntry.avgCostPerShare,
            },
          },
          $set: { updatedAt: now },
        }
      );
    }
  }
}
