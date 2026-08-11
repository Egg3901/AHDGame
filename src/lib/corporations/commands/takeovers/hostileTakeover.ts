import { NextResponse } from "next/server";
import type { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { hostileTakeoverSchema } from "@/lib/api/schemas/corporations";
import { handleRouteError } from "@/lib/api/errors";
import {
  corporationQueryFromParamId,
  resolveCorporation,
  requireCeo,
} from "@/lib/api/corporations/resolveQuery";
import type {
  Bond,
  Character,
  Corporation,
  CorporateSector,
  ImperialCharacter,
  State,
} from "@/lib/db/types";
import type { ShareListing } from "@/lib/db/types/shareListings";
import type { ShareOrder } from "@/lib/db/types/corporation";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import {
  acquirerOwnershipPercent,
  HOSTILE_TAKEOVER_OWNERSHIP_THRESHOLD_PERCENT,
  HOSTILE_TAKEOVER_PREMIUM_RATE,
} from "@/lib/corporations/corporateOwnership";
import { withCorpLock } from "@/lib/corporations/corpMoneyLock";
import {
  buildPersonalBalanceInc,
  getHomeCurrency,
  loadCharacterFxRate,
  type PersonalWealthHolder,
} from "@/lib/currency/characterFunds";
import {
  anchorToCorpLiquidCapital,
  corpLiquidCapitalToAnchor,
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { safeDistributeConversionSpread } from "@/lib/currency/marketMaker";
import { sectorFxSpreadBetween } from "@/lib/currency/sectorFxSpread";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  buildSectorStateCountryMap,
  getSectorOperatingCountryId,
} from "@/lib/corporations/sectorLocation";
import { mergeSectorPlantFields } from "@/lib/corporations/sectorTransferCapex";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { recordShareTrade } from "@/lib/corporations/shareTradeHistory";
import type { ShareTradeParty } from "@/lib/db/types/shareTradeHistory";
import { stampSubjectDeleted } from "@/lib/financialTxLog/stampDeleted";
import { releaseCorporationHeldBondsToFloat } from "@/lib/corporations/releaseHeldBondsToFloat";
import { applyBrandFacilityLoss } from "@/lib/corporations/brandFacilityLoss";
import { debitSharesFromFund } from "@/lib/corporations/shareholderOps";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { clampProductionPolicy } from "@/lib/utils/productionPolicy";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/corporations/[id]/hostile-takeover
 * Absorb a subsidiary into the parent corporation after paying minority shareholders
 * a 25% premium over market (125% of share price per share), forex-aware.
 * Auth: requireBasicAuth (CEO of parent corp only)
 * Errors: 400, 401, 403, 404, 429, 503
 */
export async function runHostileTakeover(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(`hostile-takeover:${auth.user.userId}`, 5, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    const parsed = await parseJsonBody(request, hostileTakeoverSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const corpGuard = await requireCorporationActionsEnabled(db);
    if (corpGuard) return corpGuard;

    const resolvedTarget = await resolveCorporation(db, id);
    if (!resolvedTarget.ok) return resolvedTarget.response;
    const target = resolvedTarget.corporation;

    const parentQuery = corporationQueryFromParamId(parsed.data.parentCorporationId);
    if (!parentQuery) {
      return NextResponse.json({ error: "Invalid parent corporation ID" }, { status: 400 });
    }
    const parent = await db.collection<Corporation>("corporations").findOne(parentQuery);
    if (!parent) {
      return NextResponse.json({ error: "Parent corporation not found" }, { status: 404 });
    }

    const ceoCheck = requireCeo(parent, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    if (parent._id.equals(target._id)) {
      return NextResponse.json({ error: "Invalid takeover target" }, { status: 400 });
    }

    if (target.countryOwnerId) {
      return NextResponse.json(
        { error: "National corporations cannot be merged via hostile takeover." },
        { status: 400 }
      );
    }

    const pct = acquirerOwnershipPercent(parent._id, target);
    if (pct <= HOSTILE_TAKEOVER_OWNERSHIP_THRESHOLD_PERCENT) {
      return NextResponse.json(
        {
          error: `Your corporation must hold more than ${HOSTILE_TAKEOVER_OWNERSHIP_THRESHOLD_PERCENT}% of outstanding shares (${pct.toFixed(2)}% currently).`,
        },
        { status: 400 }
      );
    }

    // Outstanding bonds transfer to the parent automatically (see bond
    // reassignment below). The parent assumes the debt; bondholders keep
    // their position with the new issuer. No blocker needed.

    // Target insolvency (negative net liquid capital after buyback escrow)
    // is not a blocker either. The cash-transfer clamp below floors the
    // target→parent cash at zero, so the parent can never be drained by a
    // negative-balance target. The parent shoulders the debt by absorbing
    // the shell; if the parent can still afford the minority squeeze-out,
    // the takeover proceeds.

    // The buyback escrow only ADDS to the transfer when it holds real collected
    // cash (positive). A negative escrow is a phantom/tracked buyback debt that
    // was never debited from liquidCapital (see shareEscrowSettlement money-
    // printing fix) — folding it in would net the target's REAL liquidCapital
    // down to a fraction and destroy value for the acquirer (the H&K/#787
    // incident, issue #2942). Floor escrow at 0 so the acquirer always inherits
    // the target's real liquid capital.
    const targetNetLiquidLocal =
      (target.liquidCapital ?? 0) + Math.max(0, target.shareEscrowBalance ?? 0);

    const forexEnabled = await isForexEnabled();
    // `target.sharePrice` is in the TARGET corp's home currency post-v0.2.6
    // (Task 18A). Normalize to ₳ before any cross-entity payout math so the
    // downstream conversions to parent/character/holder-corp currencies are
    // applying the right rate. Using target-local directly would mis-scale
    // every payout by (targetFxRate / recipientFxRate).
    const fxByCurrency = await loadFxRatesByCurrency(db);
    const targetFxPre = fxRateForCorpFromMap(target, fxByCurrency);
    const pricePerShareLocal = target.sharePrice * (1 + HOSTILE_TAKEOVER_PREMIUM_RATE);
    const pricePerShareAnchor = corpLiquidCapitalToAnchor(pricePerShareLocal, target, targetFxPre);

    const fundHeld = (target.shareholders ?? []).filter((sh) => sh.fundId && (sh.shares ?? 0) > 0);

    const minority = (target.shareholders ?? []).filter((sh) => {
      if (!sh.shares || sh.shares <= 0) return false;
      if (sh.corporationId?.equals(parent._id)) return false;
      if (sh.fundId) return false; // fund-held shares handled separately below
      return true;
    });

    let totalAnchor = 0;
    for (const sh of minority) {
      totalAnchor += sh.shares * pricePerShareAnchor;
    }
    let fundPayoutAnchor = 0;
    for (const fh of fundHeld) {
      fundPayoutAnchor += (fh.shares ?? 0) * pricePerShareAnchor;
    }
    totalAnchor += fundPayoutAnchor;

    const parentFxPre = fxRateForCorpFromMap(parent, fxByCurrency);
    // Cross-currency takeover: the acquirer pays the reduced sector FX spread on
    // the buyout cost when it and the target use different currencies. Routed
    // after the squeeze-out commits.
    const takeoverSpread = sectorFxSpreadBetween(
      resolveCorpLiquidCurrencyCode(parent) as CurrencyCode | null,
      resolveCorpLiquidCurrencyCode(target) as CurrencyCode | null,
      totalAnchor
    );
    const totalInParentCapital = anchorToCorpLiquidCapital(
      totalAnchor + takeoverSpread.spreadAnchor,
      parent,
      parentFxPre
    );

    // Compute the target→parent cash transfer up front so the catch handler
    // below can properly reverse it if we crash after applying it. Uses the net
    // position (liquidCapital + buyback escrow) so the parent absorbs the target's
    // escrow reserve/debt wholesale. Negative net is floored at 0 — the insolvency
    // guard above already rejects such targets; this clamp is the last line of
    // defence against a future refactor that reorders the checks.
    const targetCashAnchor = Math.max(
      0,
      corpLiquidCapitalToAnchor(targetNetLiquidLocal, target, targetFxPre)
    );
    const cashToParentLocal = anchorToCorpLiquidCapital(targetCashAnchor, parent, parentFxPre);

    if ((parent.liquidCapital ?? 0) + 1e-9 < totalInParentCapital) {
      return NextResponse.json(
        {
          error: `Insufficient liquid capital on the parent corporation to fund the squeeze-out (need ${Math.round(totalInParentCapital).toLocaleString()} in the parent’s operating currency).`,
        },
        { status: 400 }
      );
    }

    // Serialize the whole squeeze-debit → cash-transfer sequence against other
    // same-corp money ops on the parent (e.g. a bond issuance firing in the same
    // instant, issue #2949) so a concurrent read-then-write can't clobber one of
    // the parent's balance writes and silently lose money.
    return await withCorpLock(parent._id, async () => {
      const now = new Date();

      const debitResult = await db.collection<Corporation>("corporations").updateOne(
        {
          _id: parent._id,
          liquidCapital: { $gte: totalInParentCapital },
        },
        {
          $inc: { liquidCapital: -totalInParentCapital },
          $set: { updatedAt: now },
        }
      );
      if (debitResult.modifiedCount === 0) {
        return NextResponse.json(
          { error: "Insufficient liquid capital (race with another transaction)." },
          { status: 400 }
        );
      }

      // Track whether the target→parent cash transfer has landed. On rollback
      // the catch block needs to reverse both the minority-payout debit (always
      // applied before the try) and the cash transfer (applied partway through).
      let cashTransferApplied = false;

      try {
        const takeoverTurn = await getCurrentTurn(db);
        const parentParty: ShareTradeParty = { corporationId: parent._id, name: parent.name };
        for (const sh of minority) {
          const payoutAnchor = sh.shares * pricePerShareAnchor;
          if (payoutAnchor <= 0) continue;

          let holderParty: ShareTradeParty | null = null;
          if (sh.characterId) {
            const ch = await db
              .collection<Character>("characters")
              .findOne({ _id: sh.characterId });
            if (!ch) continue;
            const home = getHomeCurrency(ch);
            let amountLocal = payoutAnchor;
            if (forexEnabled) {
              const fx = await loadCharacterFxRate(db, home);
              if (!fx.ok) throw new Error("RATE_UNAVAILABLE");
              amountLocal = payoutAnchor * fx.rate;
            }
            await db.collection<Character>("characters").updateOne(
              { _id: sh.characterId },
              {
                $inc: buildPersonalBalanceInc(amountLocal, home, forexEnabled),
                $set: { updatedAt: now },
              }
            );
            holderParty = { characterId: sh.characterId, name: ch.name };
          } else if (sh.imperialCharacterId) {
            const ich = await db
              .collection<ImperialCharacter>("imperialCharacters")
              .findOne({ _id: sh.imperialCharacterId });
            if (!ich) continue;
            const home = getHomeCurrency(ich as PersonalWealthHolder);
            let amountLocal = payoutAnchor;
            if (forexEnabled) {
              const fx = await loadCharacterFxRate(db, home);
              if (!fx.ok) throw new Error("RATE_UNAVAILABLE");
              amountLocal = payoutAnchor * fx.rate;
            }
            await db.collection<ImperialCharacter>("imperialCharacters").updateOne(
              { _id: sh.imperialCharacterId },
              {
                $inc: buildPersonalBalanceInc(amountLocal, home, forexEnabled),
                $set: { updatedAt: now },
              }
            );
            holderParty = { imperialCharacterId: sh.imperialCharacterId, name: ich.name };
          } else if (sh.corporationId && !sh.corporationId.equals(parent._id)) {
            const holder = await db
              .collection<Corporation>("corporations")
              .findOne({ _id: sh.corporationId });
            if (!holder) continue;
            const hFx = fxRateForCorpFromMap(holder, fxByCurrency);
            const payoutLocal = anchorToCorpLiquidCapital(payoutAnchor, holder, hFx);
            await db
              .collection<Corporation>("corporations")
              .updateOne(
                { _id: holder._id },
                { $inc: { liquidCapital: payoutLocal }, $set: { updatedAt: now } }
              );
            holderParty = { corporationId: sh.corporationId, name: holder.name };
          }

          if (holderParty) {
            void recordShareTrade(db, {
              corporationId: target._id,
              kind: "takeover_buyout",
              turn: takeoverTurn,
              shares: sh.shares,
              pricePerShareAnchor,
              from: holderParty,
              to: parentParty,
              corpCurrencyCode: target.liquidCurrencyCode,
              note: `Hostile takeover by ${parent.name} — minority squeeze-out at 125% premium`,
            });
          }
        }

        // Pay out index fund shareholders — funds receive the takeover premium
        // as deployable cash (cashAnchor) and their positions are liquidated.
        for (const fh of fundHeld) {
          const fundId = fh.fundId!;
          const fundShares = fh.shares ?? 0;
          const fundPayout = fundShares * pricePerShareAnchor;
          if (fundPayout <= 0) continue;

          // Credit fund's cashAnchor with the takeover payout
          await db
            .collection("indexFunds")
            .updateOne(
              { _id: fundId },
              { $inc: { cashAnchor: fundPayout }, $set: { updatedAt: now } }
            );

          // Debit the fund's shares from the target's cap table
          await debitSharesFromFund(db, target._id, fundId, fundShares, {
            $set: { updatedAt: now },
          });

          // Remove the target corp from the fund's holdings ledger
          await db
            .collection("indexFunds")
            .updateOne({ _id: fundId, "holdings.corporationId": target._id }, [
              {
                $set: {
                  holdings: {
                    $filter: {
                      input: "$holdings",
                      as: "h",
                      cond: { $ne: ["$$h.corporationId", target._id] },
                    },
                  },
                  updatedAt: now,
                },
              },
            ]);
        }

        await db
          .collection<ShareOrder>("shareOrders")
          .updateMany(
            { corporationId: target._id, status: "open" },
            { $set: { status: "cancelled", updatedAt: now } }
          );

        await db
          .collection<ShareListing>("shareListings")
          .updateMany(
            { corporationId: target._id, status: "open" },
            { $set: { status: "cancelled" } }
          );

        const parentShareRow = (target.shareholders ?? []).find((s) =>
          s.corporationId?.equals(parent._id)
        );
        const parentShares = parentShareRow?.shares ?? 0;

        const targetSectors = await db
          .collection<CorporateSector>("corporateSectors")
          .find({ corporationId: target._id })
          .toArray();

        // Brand facility-loss (Boeing rule): the acquired target loses all of its
        // sectors to the parent, so dent its brand for the loss before the sectors
        // are reassigned (the aggregate still includes them). No-op when the target
        // has no loyalty. Best-effort — loyalty recomputes each turn.
        const targetSectorRevenue = targetSectors.reduce((sum, s) => sum + (s.revenue ?? 0), 0);
        await applyBrandFacilityLoss(db, target._id, targetSectorRevenue);

        const parentSectors = await db
          .collection<CorporateSector>("corporateSectors")
          .find({ corporationId: parent._id })
          .toArray();

        // Build lookup: "countryId:stateId:sectorType" → parent sector _id
        const sectorStateIds = [
          ...new Set([...targetSectors, ...parentSectors].map((s) => s.stateId)),
        ];
        const sectorStates = await db
          .collection<State>("states")
          .find({ _id: { $in: sectorStateIds } }, { projection: { _id: 1, countryId: 1 } })
          .toArray();
        const stateCountryByStateId = buildSectorStateCountryMap(sectorStates);
        const parentSectorKey = (s: CorporateSector) =>
          `${getSectorOperatingCountryId(s, stateCountryByStateId)}:${s.stateId}:${s.sectorType}`;
        const parentSectorMap = new Map(parentSectors.map((s) => [parentSectorKey(s), s]));

        // Sector.revenue is denominated in the OWNING corp's liquidCurrencyCode
        // (Task-18A). When merging/reassigning sectors from target → parent across
        // a currency boundary (e.g. UK corp takes over a JP corp), target-LOCAL
        // must be converted to parent-LOCAL via ₳; otherwise downstream turn
        // processors read the raw value with parent's FX rate and produce
        // order-of-magnitude wrong revenue.
        const tsRevenueInParent = (tsRevenue: number): number => {
          const anchor = corpLiquidCapitalToAnchor(tsRevenue, target, targetFxPre);
          return anchorToCorpLiquidCapital(anchor, parent, parentFxPre);
        };

        // Plant state only exists at/above the plants tier. Below it, spreading
        // the fold wrote `buildQueue: []` / `constructionInProgressAnchor: 0` /
        // `mothballed: false` / `plantsStartTurn: null` onto rows with no such
        // fields and SUMMED `capitalStock`, which capital mode owns and
        // re-derives from revenue every turn (see sectorTurn's capital block).
        const plantsEnabled = marketAtLeast(await getMarketSystemModeForDb(db), "plants");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sectorMergeOps: any[] = [];
        const sectorDeleteIds: ObjectId[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sectorReassignOps: any[] = [];

        for (const ts of targetSectors) {
          const existing = parentSectorMap.get(parentSectorKey(ts));
          if (existing) {
            // Merge: combine revenue and workers; weight-average profit margin,
            // production policy level, and sustained-negative-production counter by revenue
            const tsRevenueParent = tsRevenueInParent(ts.revenue);
            const combinedRevenue = existing.revenue + tsRevenueParent;
            const combinedWorkers = existing.workers + ts.workers;
            const weightedMargin =
              combinedRevenue > 0
                ? (existing.profitMargin * existing.revenue + ts.profitMargin * tsRevenueParent) /
                  combinedRevenue
                : existing.profitMargin;
            const weightedProductionPolicyLevel =
              combinedRevenue > 0
                ? clampProductionPolicy(
                    Math.round(
                      ((existing.productionPolicyLevel ?? 0) * existing.revenue +
                        (ts.productionPolicyLevel ?? 0) * tsRevenueParent) /
                        combinedRevenue
                    )
                  )
                : (existing.productionPolicyLevel ?? 0);
            const weightedNegativeProductionTurns =
              combinedRevenue > 0
                ? Math.round(
                    ((existing.negativeProductionSustainedTurns ?? 0) * existing.revenue +
                      (ts.negativeProductionSustainedTurns ?? 0) * tsRevenueParent) /
                      combinedRevenue
                  )
                : (existing.negativeProductionSustainedTurns ?? 0);
            // `ts` is deleted below, so fold its plant state into the survivor
            // first — same rule as the sector-purchase merge path. The
            // acquirer paid a share price that capitalized the target's
            // plants; dropping capacity/queue/CIP on the merge would destroy
            // exactly the assets it just bought. ₳ fields are summed, never
            // FX-rescaled (see sectorTransferCapex).
            const mergedPlant = plantsEnabled ? mergeSectorPlantFields(existing, ts) : {};
            sectorMergeOps.push({
              updateOne: {
                filter: { _id: existing._id },
                update: {
                  $set: {
                    countryId: getSectorOperatingCountryId(existing, stateCountryByStateId),
                    // Under plants `mergedPlant` below carries the real
                    // value; this nameplate is a one-turn placeholder.
                    // PLANTS-GATED: restated from `capitalStock` next tick.
                    revenue: combinedRevenue,
                    workers: combinedWorkers,
                    profitMargin: weightedMargin,
                    productionPolicyLevel: weightedProductionPolicyLevel,
                    negativeProductionSustainedTurns: weightedNegativeProductionTurns,
                    ...mergedPlant,
                    updatedAt: now,
                  },
                },
              },
            });
            sectorDeleteIds.push(ts._id);
          } else {
            // Reassign: convert revenue into parent's LOCAL currency at transfer time.
            sectorReassignOps.push({
              updateOne: {
                filter: { _id: ts._id },
                update: {
                  $set: {
                    corporationId: parent._id,
                    countryId: getSectorOperatingCountryId(ts, stateCountryByStateId),
                    // PLANTS-GATED: reassign path — the doc keeps its own
                    // plant state, and under plants `revenue` is restated from
                    // that capacity next turn regardless of this value.
                    revenue: tsRevenueInParent(ts.revenue),
                    updatedAt: now,
                  },
                },
              },
            });
          }
        }

        if (sectorMergeOps.length > 0) {
          await db.collection<CorporateSector>("corporateSectors").bulkWrite(sectorMergeOps);
        }
        if (sectorDeleteIds.length > 0) {
          await db
            .collection<CorporateSector>("corporateSectors")
            .deleteMany({ _id: { $in: sectorDeleteIds } });
        }
        if (sectorReassignOps.length > 0) {
          await db.collection<CorporateSector>("corporateSectors").bulkWrite(sectorReassignOps);
        }

        await db.collection<Bond>("bonds").updateMany(
          {
            corporationId: target._id,
            $or: [{ issuerType: "corporation" }, { issuerType: { $exists: false } }],
          },
          {
            $set: {
              corporationId: parent._id,
              issuerName: parent.name,
              updatedAt: now,
            },
          }
        );

        await db.collection<Corporation>("corporations").updateOne(
          { _id: parent._id },
          {
            $inc: { liquidCapital: cashToParentLocal },
            $set: { updatedAt: now },
          }
        );
        cashTransferApplied = true;

        // When `target` held equity in other corporations, pulling it from those
        // corps' shareholders arrays removes shares that the share-invariant
        // expects to be accounted for. Fold those stripped shares into each
        // host corp's publicFloat so totalShares stays balanced.
        const corpsHoldingTarget = await db
          .collection<Corporation>("corporations")
          .find({ "shareholders.corporationId": target._id })
          .project<{ _id: ObjectId; shareholders: { corporationId?: ObjectId; shares: number }[] }>(
            {
              _id: 1,
              "shareholders.$": 1,
            }
          )
          .toArray();

        const rebalanceOps = corpsHoldingTarget
          .map((c) => {
            const entry = c.shareholders?.[0];
            const stripped = entry?.shares ?? 0;
            if (stripped <= 0) return null;
            return {
              updateOne: {
                filter: { _id: c._id },
                update: {
                  $pull: { shareholders: { corporationId: target._id } } as never,
                  $inc: { publicFloat: stripped },
                  $set: { updatedAt: now },
                },
              },
            };
          })
          .filter((op): op is NonNullable<typeof op> => op !== null);

        if (rebalanceOps.length > 0) {
          // bulkWrite op array type doesn't satisfy AnyBulkWriteOperation narrowing — runtime shape is valid
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await db.collection<Corporation>("corporations").bulkWrite(rebalanceOps as any);
        }

        // Return any corporate bonds the absorbed target HELD as a creditor to
        // their issuers' public float — mirrors the share rebalance above. Pre-fix
        // these holder entries were left dangling on surviving issuers (orphaned
        // bond units pointing at a deleted corp).
        await releaseCorporationHeldBondsToFloat(db, target._id, now);

        // Phase 4: stamp tx history before deleting the absorbed corp so any
        // financial-ledger rows referencing the merged target (corp_dividend
        // it received, stock_trade_buy where it was the target, etc.) keep a
        // resolvable subjectName/sequentialId after the doc is gone.
        await stampSubjectDeleted(db, target._id, {
          sequentialId: target.sequentialId,
          deletedAt: now,
        });

        await db.collection<Corporation>("corporations").deleteOne({ _id: target._id });

        // Takeover fully committed — route the cross-currency acquisition spread
        // best-effort (the outer catch reverses liquidCapital, so this must never throw).
        if (takeoverSpread.spreadAnchor > 0 && takeoverSpread.from && takeoverSpread.to) {
          const feeInParent = Math.round(
            anchorToCorpLiquidCapital(takeoverSpread.spreadAnchor, parent, parentFxPre)
          );
          await safeDistributeConversionSpread(
            db,
            feeInParent,
            takeoverSpread.from,
            takeoverSpread.to
          );
        }

        return NextResponse.json({
          success: true,
          mergedTargetId: target._id.toString(),
          parentCorporationId: parent._id.toString(),
          subsidiarySharesRetired: parentShares,
          minorityPayoutAnchorTotal: Math.round(totalAnchor * 100) / 100,
          premiumRate: HOSTILE_TAKEOVER_PREMIUM_RATE,
          spreadPaid: Math.round(
            anchorToCorpLiquidCapital(takeoverSpread.spreadAnchor, parent, parentFxPre)
          ),
        });
      } catch (err) {
        // Restore parent's liquidCapital to the pre-debit value. If the cash
        // transfer landed before the crash, subtract that credit from the
        // refund so we don't over-refund. Reverses the debit alone when the
        // error occurred before the cash transfer (e.g., RATE_UNAVAILABLE
        // during minority payout).
        const netRefund = totalInParentCapital - (cashTransferApplied ? cashToParentLocal : 0);
        await db.collection<Corporation>("corporations").updateOne(
          { _id: parent._id },
          {
            $inc: { liquidCapital: netRefund },
            $set: { updatedAt: new Date() },
          }
        );
        if (err instanceof Error && err.message === "RATE_UNAVAILABLE") {
          return NextResponse.json(
            { error: "Exchange rate unavailable, try again shortly" },
            { status: 503 }
          );
        }
        throw err;
      }
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
