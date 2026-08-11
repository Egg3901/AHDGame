import { NextResponse } from "next/server";
import { ObjectId, type AnyBulkWriteOperation } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { formatFundsCompact } from "@/lib/utils/formatters";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import type { Bond, Character, Corporation, CorporateSector, CentralBank } from "@/lib/db/types";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import { logWireEvent, wireHeadlineCorpDissolved } from "@/lib/wireEvent";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { recordAudit } from "@/lib/audit/recordAudit";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { buildPersonalBalanceInc, getHomeCurrency } from "@/lib/currency/characterFunds";
import {
  anchorToCorpLiquidCapital,
  corpCapitalToAnchor,
  corpLiquidCapitalToAnchor,
  getCorpFxRate,
  loadFxRatesByCurrency,
} from "@/lib/currency/corporationCapital";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { previewQuickDissolve } from "@/lib/corporation/previewQuickDissolve";
import {
  cleanupShareMarketActivityForCorporations,
  cleanupShareMarketActivityForCorporationTargets,
} from "@/lib/corporations/cleanupShareMarketActivity";
import { releaseCorporationHeldSharesToFloat } from "@/lib/corporations/releaseHeldSharesToFloat";
import { distributeCrossEquityInKind } from "@/lib/corporations/distributeCrossEquityInKind";
import { computeDissolutionSectorSalvageAnchor } from "@/lib/corporations/dissolutionSectorSalvage";
import {
  corporationDissolutionAgeBlock,
  dissolutionAgeBlockedMessage,
} from "@/lib/corporations/dissolutionAgeGuard";
import { emitTxBulk, loadTxThresholds } from "@/lib/financialTxLog/emit";
import { stampSubjectDeleted } from "@/lib/financialTxLog/stampDeleted";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { restoreSectorsToUnowned } from "@/lib/corporations/restoreSectorsToUnowned";
import { withCorporationSettlementLock } from "@/lib/corporations/settlementLock";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { allocateShareholderPool } from "@/lib/bonds/corporateBondDefault";
import { payFundShareholderRows } from "@/lib/corporations/payFundShareholders";
import { getBankId } from "@/lib/centralBank/helpers";
import { writeGovBudgetLocal } from "@/lib/currency/govBudgetFields";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/corporations/[id]/dissolve — Preview for the sitting CEO’s quick dissolve (same auth as
 * POST). Not used for admin force-liquidate. Does not mutate state.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const db = await getDb();

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    const preview = await previewQuickDissolve(db, corporation);
    return NextResponse.json({ success: true, preview });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/corporations/[id]/dissolve
 * Instantly dissolve a corporation. Returns remaining liquid capital to player funds.
 * CEO only.
 */
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    const db = await getDb();

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    const currentTurn = await getCurrentTurn(db);
    const ageBlock = corporationDissolutionAgeBlock(corporation.foundedAtTurn, currentTurn);
    if (ageBlock.blocked) {
      return NextResponse.json(
        { error: dissolutionAgeBlockedMessage(ageBlock.turnsRemaining) },
        { status: 400 }
      );
    }

    // Bug #0597: Allow quick dissolve for public corps where the CEO is the
    // only real shareholder (all other shares are public float). In this case
    // there is no other shareholder to object, so a vote is unnecessary.
    const realShareholders = (corporation.shareholders ?? []).filter(
      (s) => s.characterId || s.imperialCharacterId || s.corporationId
    );
    const ceoIsOnlyRealShareholder =
      realShareholders.length === 1 &&
      realShareholders[0].characterId?.toString() === corporation.ceoId.toString();

    if (!corporation.isPrivate && !ceoIsOnlyRealShareholder) {
      const passedVote = await db.collection("corporationVotes").findOne({
        corporationId: corporation._id,
        type: "dissolution",
        status: "passed",
      });
      if (!passedVote) {
        return NextResponse.json(
          {
            error:
              "Public corporations require a passed shareholder dissolution vote. Propose one from the admin tab.",
          },
          { status: 403 }
        );
      }
    }

    const outstandingBonds = await db.collection<Bond>("bonds").countDocuments({
      corporationId: corporation._id,
      matured: false,
    });
    if (outstandingBonds > 0) {
      return NextResponse.json(
        {
          error:
            "This corporation has outstanding bonds. Resolve them via Bond default resolution (pay, refinance, or dissolve & settle) before using quick dissolve.",
        },
        { status: 400 }
      );
    }

    const forexEnabled = await isForexEnabled();
    const now = new Date();
    const result = await withCorporationSettlementLock(
      db,
      corporation._id,
      "dissolutionInProgressAt",
      now,
      async () => {
        await cleanupShareMarketActivityForCorporations(db, [corporation._id], now, forexEnabled);
        await cleanupShareMarketActivityForCorporationTargets(
          db,
          [corporation._id],
          now,
          forexEnabled
        );

        // Liquidate held bonds (at face value) into liquidCapital before
        // snapshotting; cross-corp equity is distributed in-kind below (NOT
        // cashed at market price — that was the money-mint).
        const [heldBonds, fxByCurrency] = await Promise.all([
          db
            .collection<Bond>("bonds")
            .find({ "holders.corporationId": corporation._id, matured: false })
            .toArray(),
          loadFxRatesByCurrency(db),
        ]);

        const corpFxRateEarly = await getCorpFxRate(db, corporation);
        let assetLiquidationInc = 0;

        for (const bond of heldBonds) {
          const h = bond.holders.find(
            (holder) => holder.corporationId?.toString() === corporation._id.toString()
          );
          if (!h || h.units <= 0) continue;
          const bondCcy = (bond.currencyCode ?? undefined) as CurrencyCode | undefined;
          const bondRate = bondCcy ? (fxByCurrency.get(bondCcy) ?? 1) : 1;
          const faceAnchor = corpCapitalToAnchor(h.units * BOND_UNIT_FACE_VALUE, bondCcy, bondRate);
          assetLiquidationInc += anchorToCorpLiquidCapital(
            faceAnchor,
            corporation,
            corpFxRateEarly
          );
          // Return the liquidated units to the issuer's public float so the
          // issuer's debt stays consistent (publicFloat + holderUnits ==
          // totalIssued/face). Pre-fix the $pull dropped the holder without
          // restoring float, orphaning the units: the issuer kept totalIssued
          // on its books but had zero outstanding units, so coupons stopped and
          // nothing settled at maturity (the "bonds disappeared" report).
          await db.collection<Bond>("bonds").updateOne(
            { _id: bond._id },
            {
              $pull: { holders: { corporationId: corporation._id } },
              $inc: { publicFloat: h.units },
              $set: { updatedAt: now },
            }
          );
        }

        // Cross-corp equity holdings are distributed IN-KIND, pro-rata, to the
        // dissolving corp's own shareholders — NOT cashed out at market price.
        // Pre-fix that credited `shares × issuer.sharePrice` into liquidCapital
        // with no counterparty debit, minting money a ring could pump and
        // extract (the money-laundering exploit).
        await distributeCrossEquityInKind(db, corporation, now);

        // Operating sectors are abandoned to the unowned market on dissolution
        // (no going-concern buyer), so a salvage fraction of their capitalized
        // NPV is realized as cash into the payout pool — mirroring the
        // bond-default dissolution settlement. Without this the shareholders got
        // nothing for the enterprise, only cash + redeemed bonds (the "why
        // doesn't dissolve count sector NPV" report). Computed before sectors are
        // restored to the unowned market below.
        const sectorSalvageAnchor = await computeDissolutionSectorSalvageAnchor(
          db,
          corporation,
          fxByCurrency
        );
        const sectorSalvageInc =
          sectorSalvageAnchor > 0
            ? anchorToCorpLiquidCapital(sectorSalvageAnchor, corporation, corpFxRateEarly)
            : 0;
        const capitalInc = assetLiquidationInc + sectorSalvageInc;
        if (capitalInc > 0) {
          await db
            .collection<Corporation>("corporations")
            .updateOne(
              { _id: corporation._id },
              { $inc: { liquidCapital: capitalInc }, $set: { updatedAt: now } }
            );
        }

        const refreshedCorporation = await db
          .collection<Corporation>("corporations")
          .findOne({ _id: corporation._id });
        if (!refreshedCorporation) {
          return NextResponse.json({ error: "Corporation not found" }, { status: 404 });
        }

        // Share-buyback escrow settles into the payout pool ahead of equity: a
        // positive reserve adds to it, a negative balance (buyback debt) is netted
        // out first. The max(0, …) floor means a debt exceeding assets is borne by
        // equity holders (no clawback from prior sellers). The corp is deleted
        // below, so the escrow field is terminal — adding it to the pool is safe.
        const returnedCapital = Math.max(
          0,
          Math.floor(
            refreshedCorporation.liquidCapital + (refreshedCorporation.shareEscrowBalance ?? 0)
          )
        );

        // Bug #0540 fix: pro-rata distribution to ALL shareholder buckets
        // (characters, imperials, corporate equity holders, publicFloat).
        // Pre-fix this route credited 100% of liquidCapital to the CEO even on
        // public corps where the cap table required a split — silently
        // confiscating other shareholders' value.
        //
        // For private corps the CEO is the sole shareholder so this still
        // yields a 100% CEO payout, matching the prior behaviour.
        let ceoPayoutAnchor = 0;
        let ceoCharForMsg: Pick<Character, "_id" | "name" | "countryId"> | null = null;

        if (returnedCapital > 0) {
          const corpFxRate = await getCorpFxRate(db, refreshedCorporation);
          const liquidCapitalAnchor = corpLiquidCapitalToAnchor(
            returnedCapital,
            refreshedCorporation,
            corpFxRate
          );

          // Fetch shareholder names (chars, imperials, corps) for nameById.
          const regularShareholderIds = (refreshedCorporation.shareholders ?? [])
            .map((s) => s.characterId)
            .filter((id): id is ObjectId => id !== undefined);
          const imperialShareholderIds = (refreshedCorporation.shareholders ?? [])
            .map((s) => s.imperialCharacterId)
            .filter((id): id is ObjectId => id !== undefined);
          const corpShareholderIds = (refreshedCorporation.shareholders ?? [])
            .map((s) => s.corporationId)
            .filter((id): id is ObjectId => id !== undefined);

          const [shareholderChars, imperialShareholderChars, corpShareholderDocs] =
            await Promise.all([
              regularShareholderIds.length > 0
                ? db
                    .collection<Character>("characters")
                    .find(
                      { _id: { $in: regularShareholderIds } },
                      { projection: { _id: 1, name: 1, countryId: 1 } }
                    )
                    .toArray()
                : [],
              imperialShareholderIds.length > 0
                ? db
                    .collection<ImperialCharacter>("imperialCharacters")
                    .find(
                      { _id: { $in: imperialShareholderIds } },
                      { projection: { _id: 1, name: 1, countryId: 1 } }
                    )
                    .toArray()
                : [],
              corpShareholderIds.length > 0
                ? db
                    .collection<Corporation>("corporations")
                    .find(
                      { _id: { $in: corpShareholderIds } },
                      {
                        projection: {
                          _id: 1,
                          name: 1,
                          liquidCurrencyCode: 1,
                          countryId: 1,
                        },
                      }
                    )
                    .toArray()
                : [],
            ]);

          const nameById = new Map<string, string>([
            ...shareholderChars.map((c) => [c._id.toString(), c.name] as const),
            ...imperialShareholderChars.map((c) => [c._id.toString(), c.name] as const),
            ...corpShareholderDocs.map((c) => [c._id.toString(), c.name] as const),
          ]);
          const charById = new Map(shareholderChars.map((c) => [c._id.toString(), c]));
          const imperialById = new Map(imperialShareholderChars.map((c) => [c._id.toString(), c]));
          const corpById = new Map(corpShareholderDocs.map((c) => [c._id.toString(), c]));

          const allocation = allocateShareholderPool(
            refreshedCorporation,
            liquidCapitalAnchor,
            nameById
          );

          const fxByCurrency = await loadFxRatesByCurrency(db);
          const anchorToLocal = (amtAnchor: number, currency: string): number => {
            const rate = fxByCurrency.get(currency as never);
            return Number.isFinite(rate) && rate && rate > 0 ? amtAnchor * rate : amtAnchor;
          };

          const corpHomeCurrency = (refreshedCorporation.liquidCurrencyCode ??
            COUNTRY_CURRENCY_MAP[
              refreshedCorporation.countryId as keyof typeof COUNTRY_CURRENCY_MAP
            ] ??
            "USD") as CurrencyCode;
          const dissolutionTxEntries: Omit<FinancialTxLogEntry, "_id" | "expiresAt" | "flagged">[] =
            [];

          // ── Character + imperial payouts ─────────────────────────────────
          const characterOps: AnyBulkWriteOperation<Character>[] = [];
          const imperialOps: AnyBulkWriteOperation<ImperialCharacter>[] = [];

          for (const row of allocation.characterRows) {
            if (row.payout <= 0) continue;
            const isImperial = row.isImperial === true;
            const holder = isImperial
              ? (imperialById.get(row.characterId) as ImperialCharacter | undefined)
              : (charById.get(row.characterId) as Character | undefined);
            const currency = holder ? getHomeCurrency(holder as Character) : "USD";
            const amtLocal = forexEnabled ? anchorToLocal(row.payout, currency) : row.payout;

            dissolutionTxEntries.push({
              type: "corp_dissolution_distribution",
              turn: currentTurn,
              createdAt: now,
              subjectType: "character",
              subjectId: new ObjectId(row.characterId),
              subjectName: row.name,
              amount: Math.round(amtLocal * 100) / 100,
              currencyCode: currency,
              counterpartyType: "corporation",
              counterpartyId: refreshedCorporation._id,
              counterpartyName: refreshedCorporation.name,
              meta: {
                side: "shareholder",
                finalDissolution: true,
                sharePayAnchor: Math.round(row.payout * 100) / 100,
                ...(isImperial ? { imperial: true } : {}),
              },
            });

            const op = {
              updateOne: {
                filter: { _id: new ObjectId(row.characterId) },
                update: {
                  $inc: buildPersonalBalanceInc(amtLocal, currency, forexEnabled),
                  $set: { updatedAt: now },
                },
              },
            };
            if (isImperial) imperialOps.push(op);
            else characterOps.push(op);

            if (!isImperial && row.characterId === refreshedCorporation.ceoId.toString()) {
              ceoPayoutAnchor = row.payout;
              ceoCharForMsg = holder
                ? {
                    _id: holder._id,
                    name: holder.name,
                    countryId: (holder as Character).countryId,
                  }
                : null;
            }
          }

          if (characterOps.length > 0) {
            await db.collection<Character>("characters").bulkWrite(characterOps);
          }
          if (imperialOps.length > 0) {
            await db.collection<ImperialCharacter>("imperialCharacters").bulkWrite(imperialOps);
          }

          // ── Corporate equity shareholder payouts (→ liquidCapital) ───────
          if (allocation.corporationRows.length > 0) {
            const equityOps = allocation.corporationRows
              .filter((row) => row.payout > 0)
              .map((row) => {
                const creditor = corpById.get(row.corporationId);
                const creditorCurrency = (creditor?.liquidCurrencyCode ??
                  COUNTRY_CURRENCY_MAP[creditor?.countryId as keyof typeof COUNTRY_CURRENCY_MAP] ??
                  "USD") as CurrencyCode;
                const creditorFxRate = fxByCurrency.get(creditorCurrency) ?? 1;
                const amtInCapital = anchorToCorpLiquidCapital(
                  row.payout,
                  creditor ?? {},
                  creditorFxRate
                );

                dissolutionTxEntries.push({
                  type: "corp_dissolution_distribution",
                  turn: currentTurn,
                  createdAt: now,
                  subjectType: "corporation",
                  subjectId: new ObjectId(row.corporationId),
                  subjectName: row.name,
                  amount: Math.round(amtInCapital * 100) / 100,
                  currencyCode: creditorCurrency,
                  counterpartyType: "corporation",
                  counterpartyId: refreshedCorporation._id,
                  counterpartyName: refreshedCorporation.name,
                  meta: {
                    side: "shareholder",
                    finalDissolution: true,
                    sharePayAnchor: Math.round(row.payout * 100) / 100,
                  },
                });

                return {
                  updateOne: {
                    filter: { _id: new ObjectId(row.corporationId) },
                    update: {
                      $inc: { liquidCapital: amtInCapital },
                      $set: { updatedAt: now },
                    },
                  },
                };
              });
            if (equityOps.length > 0) {
              await db.collection<Corporation>("corporations").bulkWrite(equityOps);
            }
          }

          // ── publicFloat → central bank reserve (country currency) ────────
          if (allocation.publicFloatRow && allocation.publicFloatRow.payout > 0) {
            const cbId = getBankId(refreshedCorporation.countryId);
            const floatLocal = writeGovBudgetLocal(
              allocation.publicFloatRow.payout,
              corpHomeCurrency,
              corpFxRate
            );
            await db
              .collection<CentralBank>("centralBanks")
              .updateOne(
                { _id: cbId },
                { $inc: { reserveBalance: floatLocal }, $set: { updatedAt: now } }
              );

            dissolutionTxEntries.push({
              type: "corp_dissolution_distribution",
              turn: currentTurn,
              createdAt: now,
              subjectType: "government",
              countryId: refreshedCorporation.countryId,
              subjectName: `${cbId} central bank reserve`,
              amount: Math.round(floatLocal * 100) / 100,
              currencyCode: corpHomeCurrency,
              counterpartyType: "corporation",
              counterpartyId: refreshedCorporation._id,
              counterpartyName: refreshedCorporation.name,
              meta: {
                side: "publicFloat",
                finalDissolution: true,
                sharePayAnchor: Math.round(allocation.publicFloatRow.payout * 100) / 100,
                floatShares: allocation.publicFloatRow.shares,
                centralBankId: cbId,
              },
            });
          }

          // ── Index-fund shareholders → fund cash (₳); drop the stale holding ──
          // #3451: previously a fund holder's slice was drained from the corp
          // but distributed to no one. Fund cash is ₳ (same as the pool), no FX.
          if (allocation.fundRows.length > 0) {
            await payFundShareholderRows(db, allocation.fundRows, refreshedCorporation._id, now);
          }

          // Corp outflow row mirrors the gross pool drained from the dissolving corp.
          dissolutionTxEntries.push({
            type: "corp_dissolution_distribution",
            turn: currentTurn,
            createdAt: now,
            subjectType: "corporation",
            subjectId: refreshedCorporation._id,
            subjectName: refreshedCorporation.name,
            amount: -returnedCapital,
            currencyCode: corpHomeCurrency,
            counterpartyType: "system",
            counterpartyName: "Corporation dissolution",
            meta: {
              side: "corp_outflow",
              finalDissolution: true,
              shareholderPoolAnchor: Math.round(liquidCapitalAnchor * 100) / 100,
            },
          });

          if (dissolutionTxEntries.length > 0) {
            const thresholds = await loadTxThresholds(db);
            void emitTxBulk(db, dissolutionTxEntries, thresholds);
          }
        }

        const sectors = await db
          .collection<CorporateSector>("corporateSectors")
          .find({ corporationId: refreshedCorporation._id })
          .toArray();

        await restoreSectorsToUnowned(db, sectors, now);
        await releaseCorporationHeldSharesToFloat(db, refreshedCorporation._id, now);

        await stampSubjectDeleted(db, refreshedCorporation._id, {
          sequentialId: refreshedCorporation.sequentialId,
          deletedAt: now,
        });

        await db
          .collection<Corporation>("corporations")
          .deleteOne({ _id: refreshedCorporation._id });

        logWireEvent(
          "corporation_dissolved",
          wireHeadlineCorpDissolved(refreshedCorporation.name, returnedCapital)
        );

        recordAudit({
          source: "api",
          action: "corp.dissolve",
          category: "corp",
          // actor defaults from the ambient audit context (stamped by
          // requireBasicAuth) — auth.user.userId isn't guaranteed to be a
          // valid ObjectId hex string at this layer (e.g. bot/service auth).
          subject: {
            type: "corporation",
            id: refreshedCorporation._id,
            name: refreshedCorporation.name,
          },
          amount: returnedCapital,
          refs: { corporationId: refreshedCorporation._id },
          outcome: "ok",
          meta: { isPrivate: refreshedCorporation.isPrivate, ceoPayoutAnchor },
        });

        const ceoPayoutDisplay = Math.max(0, Math.floor(ceoPayoutAnchor));
        const message = refreshedCorporation.isPrivate
          ? `${refreshedCorporation.name} has been dissolved. ${formatFundsCompact(returnedCapital)} returned to your personal funds.`
          : `${refreshedCorporation.name} has been dissolved. Liquidation proceeds were distributed pro-rata to all shareholders; your share: ${formatFundsCompact(ceoPayoutDisplay)}.`;

        return NextResponse.json({
          success: true,
          returnedCapital,
          ceoPayout: ceoPayoutDisplay,
          ceoName: ceoCharForMsg?.name ?? null,
          message,
        });
      }
    );

    if (!result) {
      return NextResponse.json(
        { error: "Dissolution is already in progress for this corporation" },
        { status: 409 }
      );
    }

    return result;
  } catch (error) {
    return handleRouteError(error);
  }
}
