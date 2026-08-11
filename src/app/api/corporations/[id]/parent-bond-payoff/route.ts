import { NextResponse } from "next/server";
import { ObjectId, type ClientSession, type AnyBulkWriteOperation } from "mongodb";
import * as Sentry from "@sentry/nextjs";
import { getDb } from "@/lib/mongodb";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { parseJsonBody } from "@/lib/api/validate";
import { parentBondPayoffSchema } from "@/lib/api/schemas/corporations";
import { handleRouteError, badRequest, internalError } from "@/lib/api/errors";
import {
  corporationQueryFromParamId,
  resolveCorporation,
  requireCeo,
} from "@/lib/api/corporations/resolveQuery";
import type { Bond, Character, Corporation } from "@/lib/db/types";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { buildPersonalBalanceInc, getHomeCurrency } from "@/lib/currency/characterFunds";
import {
  acquirerOwnershipPercent,
  HOSTILE_TAKEOVER_OWNERSHIP_THRESHOLD_PERCENT,
} from "@/lib/corporations/corporateOwnership";
import {
  anchorToCorpLiquidCapital,
  corpCapitalToAnchor,
  corpLiquidCapitalToAnchor,
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { sumNonMaturedBondPrincipal } from "@/lib/bonds/corporateBondDefault";
import { emitTxBulk, loadTxThresholds } from "@/lib/financialTxLog/emit";
import { getGameState } from "@/lib/gameState";
import { withCorporationSettlementLock } from "@/lib/corporations/settlementLock";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/corporations/[id]/parent-bond-payoff
 * Parent corporation pays off all outstanding bonds of a target subsidiary
 * from the parent's liquid capital, clearing the path for a hostile takeover.
 * Auth: requireBasicAuth (CEO of parent corp only)
 * Errors: 400, 401, 403, 404, 429, 503
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(`parent-bond-payoff:${auth.user.userId}`, 5, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    const parsed = await parseJsonBody(request, parentBondPayoffSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();

    // Paying off a subsidiary's bonds from a parent corp's funds is a
    // corporation action: blocked while an admin has paused corporation actions.
    const pausedGuard = await requireCorporationActionsEnabled(db);
    if (pausedGuard) return pausedGuard;

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
      return NextResponse.json(
        { error: "A corporation cannot pay off its own bonds via this route" },
        { status: 400 }
      );
    }

    if (target.countryOwnerId) {
      return NextResponse.json(
        { error: "National corporations cannot have bonds paid off by a parent corporation" },
        { status: 400 }
      );
    }

    if (target.imfBailoutActive) {
      return NextResponse.json(
        { error: "Target is under IMF restructuring — bonds are managed by the IMF facility" },
        { status: 400 }
      );
    }

    const pct = acquirerOwnershipPercent(parent._id, target);
    if (pct <= HOSTILE_TAKEOVER_OWNERSHIP_THRESHOLD_PERCENT) {
      return NextResponse.json(
        {
          error: `Your corporation must hold more than ${HOSTILE_TAKEOVER_OWNERSHIP_THRESHOLD_PERCENT}% of outstanding shares to pay off bonds (${pct.toFixed(2)}% currently).`,
        },
        { status: 400 }
      );
    }

    // Game state is required: cure stamp + ledger emit both derive `turn`
    // from `currentTurn`. Fail explicitly rather than leaking turn=0
    // sentinels into the audit trail.
    const gameStateForCure = await getGameState();
    const cureTurn = gameStateForCure?.currentTurn ?? 0;
    if (cureTurn <= 0) {
      return NextResponse.json(
        { error: "Game state unavailable; parent-bond-payoff cannot be processed." },
        { status: 503 }
      );
    }

    const now = new Date();
    const result = await withCorporationSettlementLock(
      db,
      target._id,
      "bondSettlementInProgressAt",
      now,
      async () => {
        const outstandingBonds = await db
          .collection<Bond>("bonds")
          .find({ corporationId: target._id, matured: false })
          .toArray();

        if (outstandingBonds.length === 0) {
          return NextResponse.json({ error: "No outstanding bonds to pay off" }, { status: 400 });
        }

        // Load FX rates once so the cost sum + per-bond face + holder payouts all
        // anchor-normalize coherently. Pre-fix the variable was literally named
        // `totalCostAnchor` but summed LOCAL `b.totalIssued` — comparing ₳
        // parentCapital against LOCAL cost blocked JP targets and the
        // `anchorToCorpLiquidCapital(totalCostAnchor, parent, ...)` deduction
        // treated LOCAL as ₳, over-deducting UK parents by ~25%.
        const fxByCurrency = await loadFxRatesByCurrency(db);
        const totalCostAnchor = sumNonMaturedBondPrincipal(outstandingBonds, fxByCurrency);

        const refreshedParent = await db.collection<Corporation>("corporations").findOne({
          _id: parent._id,
        });
        if (!refreshedParent) {
          return NextResponse.json({ error: "Parent corporation not found" }, { status: 404 });
        }

        const parentFxRate = fxRateForCorpFromMap(refreshedParent, fxByCurrency);
        const parentCapitalAnchor = corpLiquidCapitalToAnchor(
          refreshedParent.liquidCapital,
          refreshedParent,
          parentFxRate
        );

        if (parentCapitalAnchor < totalCostAnchor) {
          return NextResponse.json(
            badRequest(
              `Insufficient liquid capital. Need $${Math.round(totalCostAnchor).toLocaleString()} to pay off ${outstandingBonds.length} outstanding bond(s).`
            ).toJson(),
            { status: 400 }
          );
        }

        const costInParentCapital = anchorToCorpLiquidCapital(
          totalCostAnchor,
          refreshedParent,
          parentFxRate
        );
        const charIncs = new Map<string, number>();
        const imperialIncs = new Map<string, number>();
        const corpIncs = new Map<string, number>();
        const pendingMaturityTxs: Array<{
          holderType: "character" | "imperial" | "corp";
          holderId: string;
          bondId: string;
          bondCcy: CurrencyCode | undefined;
          faceAnchor: number;
          units: number;
          couponRate: number;
        }> = [];

        for (const bond of outstandingBonds) {
          const bondCcy = (bond.currencyCode ?? undefined) as CurrencyCode | undefined;
          const bondRate = bondCcy ? (fxByCurrency.get(bondCcy) ?? 1) : 1;
          for (const h of bond.holders) {
            const faceLocal = h.units * BOND_UNIT_FACE_VALUE;
            const faceAnchor = corpCapitalToAnchor(faceLocal, bondCcy, bondRate);
            if (h.characterId) {
              const k = h.characterId.toString();
              charIncs.set(k, (charIncs.get(k) ?? 0) + faceAnchor);
              pendingMaturityTxs.push({
                holderType: "character",
                holderId: k,
                bondId: bond._id.toString(),
                bondCcy,
                faceAnchor,
                units: h.units,
                couponRate: bond.couponRate,
              });
            } else if (h.imperialCharacterId) {
              const k = h.imperialCharacterId.toString();
              imperialIncs.set(k, (imperialIncs.get(k) ?? 0) + faceAnchor);
              pendingMaturityTxs.push({
                holderType: "imperial",
                holderId: k,
                bondId: bond._id.toString(),
                bondCcy,
                faceAnchor,
                units: h.units,
                couponRate: bond.couponRate,
              });
            } else if (h.corporationId && h.corporationId.toString() !== target._id.toString()) {
              const k = h.corporationId.toString();
              corpIncs.set(k, (corpIncs.get(k) ?? 0) + faceAnchor);
              pendingMaturityTxs.push({
                holderType: "corp",
                holderId: k,
                bondId: bond._id.toString(),
                bondCcy,
                faceAnchor,
                units: h.units,
                couponRate: bond.couponRate,
              });
            }
          }
        }

        const nameById = new Map<string, string>();
        const anchorToLocal = (amtAnchor: number, currency: string): number => {
          const rate = fxByCurrency.get(currency as never);
          return Number.isFinite(rate) && rate && rate > 0 ? amtAnchor * rate : amtAnchor;
        };

        const holderCorpFxByHolderId = new Map<
          string,
          { currency: CurrencyCode; fxRate: number; doc: Corporation }
        >();
        const bondIds = outstandingBonds.map((b) => b._id);

        // Move the money atomically when the deployment supports transactions
        // (Atlas / replica set). The live server is a Railway standalone mongod
        // where transactions throw code 20; `runWithOptionalTransaction` then
        // falls back to sequential writes, which we keep money-safe with an
        // explicit compensation stack. Invariant: the payoff either fully
        // completes or has no net financial effect — never a partial state.
        const applyPayoff = async (
          session: ClientSession | undefined,
          compensate: boolean
        ): Promise<void> => {
          const sessionOpt: { session?: ClientSession } = session ? { session } : {};
          const forexEnabled = await isForexEnabled();

          // ── Phase R: reads + validation + op building (no writes yet) ──
          // All holder reads happen before any debit, so missing/invalid holder
          // data costs nothing on the standalone fallback path. Each credit is
          // built alongside its exact reversal for compensation.
          let charOps: AnyBulkWriteOperation<Character>[] = [];
          let charReverseOps: AnyBulkWriteOperation<Character>[] = [];
          if (charIncs.size > 0) {
            const charIds = [...charIncs.keys()].map((entryId) => new ObjectId(entryId));
            const charDocs = await db
              .collection<Character>("characters")
              .find({ _id: { $in: charIds } }, sessionOpt)
              .project<Pick<Character, "_id" | "countryId" | "name">>({
                _id: 1,
                countryId: 1,
                name: 1,
              })
              .toArray();
            if (charDocs.length !== charIncs.size) {
              throw internalError("Bond holder data is inconsistent; contact an admin.");
            }
            const charCurrencyMap = new Map(
              charDocs.map((c) => [c._id.toString(), getHomeCurrency(c as Character)])
            );
            for (const c of charDocs) nameById.set(c._id.toString(), c.name as string);

            const buildCharOps = (sign: 1 | -1): AnyBulkWriteOperation<Character>[] =>
              [...charIncs.entries()].map(([charIdStr, amtAnchor]) => {
                const currency = charCurrencyMap.get(charIdStr) ?? "USD";
                const amt = forexEnabled ? anchorToLocal(amtAnchor, currency) : amtAnchor;
                return {
                  updateOne: {
                    filter: { _id: new ObjectId(charIdStr) },
                    update: {
                      $inc: buildPersonalBalanceInc(sign * amt, currency, forexEnabled),
                      $set: { updatedAt: now },
                    },
                  },
                };
              });
            charOps = buildCharOps(1);
            charReverseOps = buildCharOps(-1);
          }

          let imperialOps: AnyBulkWriteOperation<ImperialCharacter>[] = [];
          let imperialReverseOps: AnyBulkWriteOperation<ImperialCharacter>[] = [];
          if (imperialIncs.size > 0) {
            const imperialIds = [...imperialIncs.keys()].map((entryId) => new ObjectId(entryId));
            const imperialDocs = await db
              .collection<ImperialCharacter>("imperialCharacters")
              .find({ _id: { $in: imperialIds } }, sessionOpt)
              .project<Pick<ImperialCharacter, "_id" | "countryId" | "name">>({
                _id: 1,
                countryId: 1,
                name: 1,
              })
              .toArray();
            if (imperialDocs.length !== imperialIncs.size) {
              throw internalError("Bond holder data is inconsistent; contact an admin.");
            }
            const imperialCurrencyMap = new Map(
              imperialDocs.map((c) => [c._id.toString(), getHomeCurrency(c as ImperialCharacter)])
            );
            for (const c of imperialDocs) nameById.set(c._id.toString(), c.name as string);

            const buildImperialOps = (sign: 1 | -1): AnyBulkWriteOperation<ImperialCharacter>[] =>
              [...imperialIncs.entries()].map(([imperialIdStr, amtAnchor]) => {
                const currency = imperialCurrencyMap.get(imperialIdStr) ?? "USD";
                const amt = forexEnabled ? anchorToLocal(amtAnchor, currency) : amtAnchor;
                return {
                  updateOne: {
                    filter: { _id: new ObjectId(imperialIdStr) },
                    update: {
                      $inc: buildPersonalBalanceInc(sign * amt, currency, forexEnabled),
                      $set: { updatedAt: now },
                    },
                  },
                };
              });
            imperialOps = buildImperialOps(1);
            imperialReverseOps = buildImperialOps(-1);
          }

          let corpOps: AnyBulkWriteOperation<Corporation>[] = [];
          let corpReverseOps: AnyBulkWriteOperation<Corporation>[] = [];
          if (corpIncs.size > 0) {
            const creditorIds = [...corpIncs.keys()].map((entryId) => new ObjectId(entryId));
            const creditorDocs = await db
              .collection<Corporation>("corporations")
              .find({ _id: { $in: creditorIds } }, sessionOpt)
              .toArray();
            if (creditorDocs.length !== corpIncs.size) {
              throw internalError("Bond holder data is inconsistent; contact an admin.");
            }
            const resolvedCreditors = creditorDocs.map((creditor) => {
              const fxRate = fxRateForCorpFromMap(creditor, fxByCurrency);
              const currency = (resolveCorpLiquidCurrencyCode(creditor) ?? "USD") as CurrencyCode;
              return { creditor, fxRate, currency };
            });
            for (const { creditor, fxRate, currency } of resolvedCreditors) {
              holderCorpFxByHolderId.set(creditor._id.toString(), {
                currency,
                fxRate,
                doc: creditor,
              });
              nameById.set(creditor._id.toString(), creditor.name);
            }
            const buildCorpOps = (sign: 1 | -1): AnyBulkWriteOperation<Corporation>[] =>
              [...corpIncs.entries()].map(([corpIdStr, amt]) => {
                const info = holderCorpFxByHolderId.get(corpIdStr);
                if (!info) {
                  throw internalError("Bond holder data is inconsistent; contact an admin.");
                }
                const amtInCapital = anchorToCorpLiquidCapital(amt, info.doc, info.fxRate);
                return {
                  updateOne: {
                    filter: { _id: new ObjectId(corpIdStr) },
                    update: {
                      $inc: { liquidCapital: sign * amtInCapital },
                      $set: { updatedAt: now },
                    },
                  },
                };
              });
            corpOps = buildCorpOps(1);
            corpReverseOps = buildCorpOps(-1);
          }

          // ── Phase W: writes (debit → credits → mature) ──
          // In transaction mode (compensate=false) any throw aborts and Mongo
          // rolls back — no manual undo. On the standalone fallback
          // (compensate=true) each completed write registers its reversal, and a
          // later failure replays them in reverse so no money is created or lost.
          const undo: Array<() => Promise<void>> = [];
          const compensateAndThrow = async (err: unknown): Promise<never> => {
            if (compensate) {
              for (const revert of undo.reverse()) {
                try {
                  await revert();
                } catch (compErr) {
                  // Compensation-of-last-resort failed: the standalone deployment
                  // is genuinely mid-failure. Surface loudly for manual
                  // reconciliation rather than swallow a money inconsistency.
                  Sentry.captureException(compErr, {
                    extra: {
                      context: "parent-bond-payoff fallback compensation failed",
                      parentCorporationId: refreshedParent._id.toString(),
                      targetCorporationId: target._id.toString(),
                    },
                  });
                }
              }
            }
            throw err;
          };

          // 1. Debit the parent (conditional). Nothing else is written yet, so a
          //    failure here needs no compensation.
          const debitResult = await db
            .collection<Corporation>("corporations")
            .updateOne(
              { _id: refreshedParent._id, liquidCapital: { $gte: costInParentCapital } },
              { $inc: { liquidCapital: -costInParentCapital }, $set: { updatedAt: now } },
              sessionOpt
            );
          if (debitResult.modifiedCount === 0) {
            throw badRequest("Insufficient liquid capital (race with another transaction).");
          }
          undo.push(async () => {
            await db
              .collection<Corporation>("corporations")
              .updateOne(
                { _id: refreshedParent._id },
                { $inc: { liquidCapital: costInParentCapital }, $set: { updatedAt: now } },
                sessionOpt
              );
          });

          // 2–4. Credit holders. Register each reversal only after the write lands.
          if (charOps.length > 0) {
            try {
              await db.collection<Character>("characters").bulkWrite(charOps, sessionOpt);
            } catch (err) {
              return compensateAndThrow(err);
            }
            undo.push(async () => {
              await db.collection<Character>("characters").bulkWrite(charReverseOps, sessionOpt);
            });
          }
          if (imperialOps.length > 0) {
            try {
              await db
                .collection<ImperialCharacter>("imperialCharacters")
                .bulkWrite(imperialOps, sessionOpt);
            } catch (err) {
              return compensateAndThrow(err);
            }
            undo.push(async () => {
              await db
                .collection<ImperialCharacter>("imperialCharacters")
                .bulkWrite(imperialReverseOps, sessionOpt);
            });
          }
          if (corpOps.length > 0) {
            try {
              await db.collection<Corporation>("corporations").bulkWrite(corpOps, sessionOpt);
            } catch (err) {
              return compensateAndThrow(err);
            }
            undo.push(async () => {
              await db
                .collection<Corporation>("corporations")
                .bulkWrite(corpReverseOps, sessionOpt);
            });
          }

          // 5. Mature the bonds last: on failure there is nothing to un-mature
          //    (the only write whose reversal would need prior-state capture).
          let matured: { modifiedCount: number };
          try {
            matured = await db.collection<Bond>("bonds").updateMany(
              { _id: { $in: bondIds }, corporationId: target._id, matured: false },
              {
                $set: {
                  matured: true,
                  marketPrice: 1,
                  defaulted: false,
                  defaultCure: {
                    cureMethod: "parent_payoff" as const,
                    curedAtTurn: cureTurn,
                  },
                  updatedAt: now,
                },
              },
              sessionOpt
            );
          } catch (err) {
            return compensateAndThrow(err);
          }
          if (matured.modifiedCount !== bondIds.length) {
            return compensateAndThrow(
              badRequest("Bond state changed during payoff. Refresh and try again.")
            );
          }
        };

        try {
          await runWithOptionalTransaction(
            (session) => applyPayoff(session, false),
            () => applyPayoff(undefined, true)
          );
        } catch (err) {
          if (err instanceof Error && err.message === "RATE_UNAVAILABLE") {
            return NextResponse.json(
              { error: "Exchange rate unavailable, try again shortly" },
              { status: 503 }
            );
          }
          throw err;
        }

        if (pendingMaturityTxs.length > 0) {
          const currentTurn = cureTurn;
          const txEntries = pendingMaturityTxs.map((t) => {
            const bondRate = t.bondCcy ? (fxByCurrency.get(t.bondCcy) ?? 1) : 1;
            const bondLocalAmount = t.faceAnchor * (bondRate > 0 ? bondRate : 1);

            if (t.holderType === "corp") {
              const info = holderCorpFxByHolderId.get(t.holderId);
              const lcAmount = anchorToCorpLiquidCapital(
                t.faceAnchor,
                info?.doc,
                info?.fxRate ?? 1
              );
              const lcCurrency = info?.currency ?? "USD";
              return {
                type: "bond_maturity" as const,
                turn: currentTurn,
                createdAt: now,
                subjectType: "corporation" as const,
                subjectId: new ObjectId(t.holderId),
                subjectName: nameById.get(t.holderId) ?? "(holder)",
                amount: Math.round(lcAmount * 100) / 100,
                currencyCode: lcCurrency as CurrencyCode,
                counterpartyType: "corporation" as const,
                counterpartyId: target._id,
                counterpartyName: target.name,
                meta: {
                  bondId: t.bondId,
                  units: t.units,
                  couponRate: t.couponRate,
                  source: "parent_bond_payoff",
                  parentCorporationId: refreshedParent._id.toString(),
                  ...(t.bondCcy
                    ? {
                        bondCurrency: t.bondCcy,
                        bondAmount: Math.round(bondLocalAmount * 100) / 100,
                      }
                    : {}),
                },
              };
            }

            return {
              type: "bond_maturity" as const,
              turn: currentTurn,
              createdAt: now,
              subjectType: "character" as const,
              subjectId: new ObjectId(t.holderId),
              subjectName: nameById.get(t.holderId) ?? "(holder)",
              amount: Math.round(bondLocalAmount * 100) / 100,
              currencyCode: (t.bondCcy ?? "USD") as CurrencyCode,
              counterpartyType: "corporation" as const,
              counterpartyId: target._id,
              counterpartyName: target.name,
              meta: {
                bondId: t.bondId,
                units: t.units,
                couponRate: t.couponRate,
                source: "parent_bond_payoff",
                parentCorporationId: refreshedParent._id.toString(),
                ...(t.holderType === "imperial" ? { imperial: true } : {}),
              },
            };
          });
          const thresholds = await loadTxThresholds(db);
          await emitTxBulk(db, txEntries, thresholds);
        }

        return NextResponse.json({
          success: true,
          paid: totalCostAnchor,
          bondsMatured: bondIds.length,
          parentCorporationId: refreshedParent._id.toString(),
          targetCorporationId: target._id.toString(),
        });
      }
    );

    if (!result) {
      return NextResponse.json(
        { error: "Bond settlement is already in progress for this corporation" },
        { status: 409 }
      );
    }

    return result;
  } catch (error) {
    return handleRouteError(error);
  }
}
