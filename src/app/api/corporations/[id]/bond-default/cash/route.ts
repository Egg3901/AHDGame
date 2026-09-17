import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { handleRouteError, badRequest, internalError } from "@/lib/api/errors";
import type { Bond, Character, Corporation } from "@/lib/db/types";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { getHomeCurrency } from "@/lib/currency/characterFunds";
import {
  anchorToCorpLiquidCapital,
  corpCapitalToAnchor,
  corpLiquidCapitalToAnchor,
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { sumDefaultedBondPrincipal } from "@/lib/bonds/corporateBondDefault";
import {
  applyBondPayoffSpend,
  buildBondPayoffFingerprint,
  BOND_PAYOFF_FUNDS,
  BOND_PAYOFF_HOLDER,
  BOND_PAYOFF_MATURE,
  type BondPayoffHolderCredit,
} from "@/lib/bonds/bondPayoffSpend";
import { MoneyFlowKeyConflictError, MoneyFlowTerminalError } from "@/lib/db/nonAtomicMoneyFlow";
import { splitBondPaymentWithEscrow } from "@/lib/corporations/escrowFunding";
import { emitTxBulk, loadTxThresholds } from "@/lib/financialTxLog/emit";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";

/** Shape `emitTxBulk` accepts (mirrors its private TxInput). */
type TxLogInput = Omit<FinancialTxLogEntry, "_id" | "expiresAt" | "flagged">;
import { getGameState } from "@/lib/gameState";
import { withCorporationSettlementLock } from "@/lib/corporations/settlementLock";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/corporations/[id]/bond-default/cash
 * Pay off defaulted bond principal from liquid capital and mature those bonds.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    // Crash-safe settlement (issue #1672): a client retry with the same key
    // replays the stored payoff outcome instead of paying again.
    const headerKey = request.headers.get("Idempotency-Key");
    if (headerKey !== null && (headerKey.length === 0 || headerKey.length > 128)) {
      return NextResponse.json({ error: "Invalid Idempotency-Key header" }, { status: 400 });
    }

    const { id } = await params;
    const db = await getDb();

    // Paying off defaulted bonds from corporate cash is a corporation action:
    // blocked while an admin has paused corporation actions.
    const pausedGuard = await requireCorporationActionsEnabled(db);
    if (pausedGuard) return pausedGuard;

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    if (corporation.countryOwnerId) {
      return NextResponse.json(
        { error: "Not available for national corporations" },
        { status: 400 }
      );
    }

    // Game state is required: the cure stamp's `curedAtTurn`, the
    // bond_maturity ledger rows' `turn`, and the audit trail all derive from
    // `currentTurn`. Fail explicitly rather than leaking turn=0 sentinels.
    const gameStateForCure = await getGameState();
    const cureTurn = gameStateForCure?.currentTurn ?? 0;
    if (cureTurn <= 0) {
      return NextResponse.json(
        { error: "Game state unavailable; cash payoff cannot be processed." },
        { status: 503 }
      );
    }

    const now = new Date();
    const result = await withCorporationSettlementLock(
      db,
      corporation._id,
      "bondSettlementInProgressAt",
      now,
      async () => {
        const defaultedBonds = await db
          .collection<Bond>("bonds")
          .find({ corporationId: corporation._id, matured: false, defaulted: true })
          .toArray();

        if (defaultedBonds.length === 0) {
          return NextResponse.json({ error: "No defaulted bonds to resolve" }, { status: 400 });
        }

        // Load FX rates once so the cost sum + per-bond face + holder payouts all
        // normalize to ₳ coherently. Pre-fix `cost` summed LOCAL `totalIssued`,
        // compared ₳ corpCapital against LOCAL cost, and `anchorToCorpLiquidCapital`
        // treated LOCAL as ₳ when deducting — blocking JP corps from cash-paying
        // off defaulted bonds and over-deducting UK corps.
        const fxByCurrency = await loadFxRatesByCurrency(db);
        const cost = sumDefaultedBondPrincipal(defaultedBonds, fxByCurrency);

        const refreshedCorporation = await db
          .collection<Corporation>("corporations")
          .findOne({ _id: corporation._id });
        if (!refreshedCorporation) {
          return NextResponse.json({ error: "Corporation not found" }, { status: 404 });
        }

        const corpFxRate = fxRateForCorpFromMap(refreshedCorporation, fxByCurrency);
        const corpCapitalAnchor = corpLiquidCapitalToAnchor(
          refreshedCorporation.liquidCapital,
          refreshedCorporation,
          corpFxRate
        );
        // Bonds-only escrow fallback: a positive buyback escrow can top up a
        // liquidCapital shortfall to pay off defaulted principal (never a negative
        // escrow). Available cash = liquidCapital + max(0, escrow), in ₳ for the check.
        const escrowPositiveAnchor = corpLiquidCapitalToAnchor(
          Math.max(0, refreshedCorporation.shareEscrowBalance ?? 0),
          refreshedCorporation,
          corpFxRate
        );
        if (corpCapitalAnchor + escrowPositiveAnchor < cost) {
          return NextResponse.json(
            badRequest(
              `Insufficient liquid capital. Need $${cost.toLocaleString()} to pay off defaulted principal (treasury + buyback escrow combined).`
            ).toJson(),
            { status: 400 }
          );
        }

        const charIncs = new Map<string, number>();
        const imperialIncs = new Map<string, number>();
        const corpIncs = new Map<string, number>();
        // Index funds and autonomous NPPs hold bond units too (BondHolder.fundId
        // / .nppId). They were silently dropped by the holder chain below while
        // the bond was still marked cured, so their principal simply vanished
        // (#809). Both hold in ₳, matching the bondTurn coupon/maturity legs.
        const fundIncsAnchor = new Map<string, number>();
        const nppIncsAnchor = new Map<string, number>();
        // Per-(holder, bond) snapshot so each holder gets a `bond_maturity` row at
        // emit time. Pre-fix the cash payoff moved cash silently — see audit on
        // corp 100 (Kaviori) where £500M+ flowed with no ledger trail.
        const pendingMaturityTxs: Array<{
          holderType: "character" | "imperial" | "corp" | "fund" | "npp";
          holderId: string;
          bondId: string;
          bondCcy: CurrencyCode | undefined;
          faceAnchor: number;
          units: number;
          couponRate: number;
        }> = [];

        // Each bond's face is denominated in its own `currencyCode`; anchor-normalize
        // per-bond so per-holder amounts are ₳, matching the downstream `anchorToLocal`
        // expectation. Same fix as A10 in executeCorporationBondDefaultDissolution.
        for (const bond of defaultedBonds) {
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
            } else if (
              h.corporationId &&
              h.corporationId.toString() !== refreshedCorporation._id.toString()
            ) {
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
            } else if (h.fundId) {
              const k = h.fundId.toString();
              fundIncsAnchor.set(k, (fundIncsAnchor.get(k) ?? 0) + faceAnchor);
              pendingMaturityTxs.push({
                holderType: "fund",
                holderId: k,
                bondId: bond._id.toString(),
                bondCcy,
                faceAnchor,
                units: h.units,
                couponRate: bond.couponRate,
              });
            } else if (h.nppId) {
              const k = h.nppId.toString();
              nppIncsAnchor.set(k, (nppIncsAnchor.get(k) ?? 0) + faceAnchor);
              pendingMaturityTxs.push({
                holderType: "npp",
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

        // Payoffs are now truly ₳ (per-bond face anchor-normalized above). Post-forex
        // holders need conversion to their home currency before $inc into
        // currencyBalances.personal.<code>; pre-forex holders keep the raw ₳ amount
        // since legacy `cashOnHand` is itself ₳. Mirrors the corp-to-corp creditor
        // path below (anchorToCorpLiquidCapital).
        const anchorToLocal = (amtAnchor: number, currency: string): number => {
          const rate = fxByCurrency.get(currency as never);
          return Number.isFinite(rate) && rate && rate > 0 ? amtAnchor * rate : amtAnchor;
        };

        // subjectName for tx emission. One map for all holder types; ids are unique
        // ObjectIds so collisions across types are not a concern in practice.
        const nameById = new Map<string, string>();
        const holderCorpFxByHolderId = new Map<
          string,
          { currency: CurrencyCode; fxRate: number; doc: Corporation }
        >();
        const costInCorpCapital = anchorToCorpLiquidCapital(cost, refreshedCorporation, corpFxRate);
        const bondIds = defaultedBonds.map((b) => b._id);
        const forexEnabled = await isForexEnabled();

        // Split the cost across liquidCapital first, then the positive escrow
        // remainder. Both are corp-local, so split in local (costInCorpCapital).
        const paymentSplit = splitBondPaymentWithEscrow({
          liquidCapital: refreshedCorporation.liquidCapital,
          escrowBalance: refreshedCorporation.shareEscrowBalance ?? 0,
          amountDue: costInCorpCapital,
        });

        // Holder reads happen before any write, so missing/invalid holder
        // data costs nothing: no debit, no maturation, no credit. Amounts are
        // converted to each holder's own denomination here; the keyed flow
        // below applies them exactly once.
        const charCurrencyMap = new Map<string, string>();
        if (charIncs.size > 0) {
          const charIds = [...charIncs.keys()].map((entryId) => new ObjectId(entryId));
          const charDocs = await db
            .collection<Character>("characters")
            .find({ _id: { $in: charIds } })
            .project<Pick<Character, "_id" | "countryId" | "name">>({
              _id: 1,
              countryId: 1,
              name: 1,
            })
            .toArray();
          if (charDocs.length !== charIncs.size) {
            throw internalError("Bond holder data is inconsistent; contact an admin.");
          }
          for (const c of charDocs) {
            charCurrencyMap.set(c._id.toString(), getHomeCurrency(c as Character));
            nameById.set(c._id.toString(), c.name as string);
          }
        }

        const imperialCurrencyMap = new Map<string, string>();
        if (imperialIncs.size > 0) {
          const imperialIds = [...imperialIncs.keys()].map((entryId) => new ObjectId(entryId));
          const imperialDocs = await db
            .collection<ImperialCharacter>("imperialCharacters")
            .find({ _id: { $in: imperialIds } })
            .project<Pick<ImperialCharacter, "_id" | "countryId" | "name">>({
              _id: 1,
              countryId: 1,
              name: 1,
            })
            .toArray();
          if (imperialDocs.length !== imperialIncs.size) {
            throw internalError("Bond holder data is inconsistent; contact an admin.");
          }
          for (const c of imperialDocs) {
            imperialCurrencyMap.set(c._id.toString(), getHomeCurrency(c as ImperialCharacter));
            nameById.set(c._id.toString(), c.name as string);
          }
        }

        if (corpIncs.size > 0) {
          const creditorIds = [...corpIncs.keys()].map((entryId) => new ObjectId(entryId));
          const creditorDocs = await db
            .collection<Corporation>("corporations")
            .find({ _id: { $in: creditorIds } })
            .toArray();
          if (creditorDocs.length !== corpIncs.size) {
            throw internalError("Bond holder data is inconsistent; contact an admin.");
          }
          for (const creditor of creditorDocs) {
            const fxRate = fxRateForCorpFromMap(creditor, fxByCurrency);
            const currency = (resolveCorpLiquidCurrencyCode(creditor) ?? "USD") as CurrencyCode;
            holderCorpFxByHolderId.set(creditor._id.toString(), {
              currency,
              fxRate,
              doc: creditor,
            });
            nameById.set(creditor._id.toString(), creditor.name);
          }
        }

        // Settle through the shared keyed payoff flow (issue #1672): the
        // guarded liquid (+escrow) debit lands first, one resumable credit
        // per holder second, the per-bond maturity claims last. A later
        // failure compensates its own prefix, so the payoff either fully
        // completes or has no net financial effect, on every topology.
        const holderCredits: BondPayoffHolderCredit[] = [];
        for (const [charIdStr, amtAnchor] of charIncs) {
          const currency = charCurrencyMap.get(charIdStr) ?? "USD";
          holderCredits.push({
            kind: "character",
            holderId: new ObjectId(charIdStr),
            field: forexEnabled ? `currencyBalances.personal.${currency}` : "cashOnHand",
            amount: forexEnabled ? anchorToLocal(amtAnchor, currency) : amtAnchor,
          });
        }
        for (const [imperialIdStr, amtAnchor] of imperialIncs) {
          const currency = imperialCurrencyMap.get(imperialIdStr) ?? "USD";
          holderCredits.push({
            kind: "imperial",
            holderId: new ObjectId(imperialIdStr),
            field: forexEnabled ? `currencyBalances.personal.${currency}` : "cashOnHand",
            amount: forexEnabled ? anchorToLocal(amtAnchor, currency) : amtAnchor,
          });
        }
        for (const [corpIdStr, amtAnchor] of corpIncs) {
          const info = holderCorpFxByHolderId.get(corpIdStr);
          if (!info) {
            throw internalError("Bond holder data is inconsistent; contact an admin.");
          }
          holderCredits.push({
            kind: "corp",
            holderId: new ObjectId(corpIdStr),
            field: "liquidCapital",
            amount: anchorToCorpLiquidCapital(amtAnchor, info.doc, info.fxRate),
          });
        }
        // Index funds hold in anchor on `cashAnchor`; autonomous NPPs on
        // `nppInvestmentCashAnchor` (investment returns, NOT campaign funds).
        // Same accounts and units the bondTurn coupon/maturity legs credit.
        for (const [fundIdStr, amtAnchor] of fundIncsAnchor) {
          holderCredits.push({
            kind: "fund",
            holderId: new ObjectId(fundIdStr),
            field: "cashAnchor",
            amount: Math.round(amtAnchor * 100) / 100,
          });
        }
        for (const [nppIdStr, amtAnchor] of nppIncsAnchor) {
          holderCredits.push({
            kind: "npp",
            holderId: new ObjectId(nppIdStr),
            field: "nppInvestmentCashAnchor",
            amount: Math.round(amtAnchor * 100) / 100,
          });
        }

        const fingerprint = buildBondPayoffFingerprint({
          cureMethod: "cash",
          payerCorpId: refreshedCorporation._id,
          issuerCorpId: refreshedCorporation._id,
          debitLiquidCapital: paymentSplit.fromLiquid,
          debitEscrow: paymentSplit.fromEscrow,
          bonds: bondIds,
          holders: holderCredits.map((h) => ({
            kind: h.kind,
            holderId: h.holderId,
            amount: h.amount,
          })),
        });

        // Map a keyed-settlement failure back onto the historical surface: a
        // lost funds race is the 400 race refusal, a lost maturity race the
        // 400 bond-state refusal, a vanished holder the 500 inconsistent
        // error. The primitive already compensated any applied prefix.
        try {
          await applyBondPayoffSpend(db, {
            payerCorpId: refreshedCorporation._id,
            issuerCorpId: refreshedCorporation._id,
            debitLiquidCapital: paymentSplit.fromLiquid,
            debitEscrow: paymentSplit.fromEscrow,
            holders: holderCredits,
            bonds: defaultedBonds.map((b) => ({
              bondId: b._id,
              priorMarketPrice: b.marketPrice,
              priorDefaulted: b.defaulted ?? false,
            })),
            cureMethod: "cash",
            onlyDefaulted: true,
            curedAtTurn: cureTurn,
            now,
            fingerprint,
            ...(headerKey !== null ? { idempotencyKey: headerKey } : {}),
          });
        } catch (err) {
          if (err instanceof Error && err.message === "RATE_UNAVAILABLE") {
            return NextResponse.json(
              { error: "Exchange rate unavailable, try again shortly" },
              { status: 503 }
            );
          }
          if (err instanceof MoneyFlowTerminalError) {
            return NextResponse.json(
              { error: "Payoff already settled; start a new attempt with a new key." },
              { status: 409 }
            );
          }
          if (err instanceof MoneyFlowKeyConflictError) {
            return NextResponse.json(
              { error: "Idempotency key was reused for a different payoff." },
              { status: 409 }
            );
          }
          const message = err instanceof Error ? err.message : "";
          if (message.startsWith(BOND_PAYOFF_FUNDS)) {
            return NextResponse.json(
              badRequest(
                "Insufficient liquid capital (race with another transaction). Refresh and try again."
              ).toJson(),
              { status: 400 }
            );
          }
          if (message.startsWith(BOND_PAYOFF_MATURE)) {
            return NextResponse.json(
              badRequest("Bond state changed during payoff. Refresh and try again.").toJson(),
              { status: 400 }
            );
          }
          if (message.startsWith(BOND_PAYOFF_HOLDER)) {
            throw internalError("Bond holder data is inconsistent; contact an admin.");
          }
          throw err;
        }

        // Emit one bond_maturity row per (holder, bond) pair so the cash payoff is
        // visible in the financial ledger / suspect-flag scan / wealth audit. This
        // stays outside the transaction because the tx-log helper is best-effort and
        // intentionally swallows its own write failures.
        if (pendingMaturityTxs.length > 0) {
          const currentTurn = cureTurn;
          const txEntries: TxLogInput[] = pendingMaturityTxs.flatMap((t): TxLogInput[] => {
            const bondRate = t.bondCcy ? (fxByCurrency.get(t.bondCcy) ?? 1) : 1;
            const bondLocalAmount = t.faceAnchor * (bondRate > 0 ? bondRate : 1);

            // Autonomous NPP investment returns are deliberately kept out of the
            // tx log, matching the NPP investment-account isolation the bondTurn
            // coupon/maturity legs already apply.
            if (t.holderType === "npp") return [];

            if (t.holderType === "corp" || t.holderType === "fund") {
              // A fund holds in ₳ and has no corp FX doc, so it logs the anchor
              // amount directly; a corporation logs in its own liquid currency.
              const info =
                t.holderType === "corp" ? holderCorpFxByHolderId.get(t.holderId) : undefined;
              const lcAmount =
                t.holderType === "fund"
                  ? t.faceAnchor
                  : anchorToCorpLiquidCapital(t.faceAnchor, info?.doc, info?.fxRate ?? 1);
              const lcCurrency = t.holderType === "fund" ? "USD" : (info?.currency ?? "USD");
              return [
                {
                  type: "bond_maturity" as const,
                  turn: currentTurn,
                  createdAt: now,
                  subjectType: "corporation" as const,
                  subjectId: new ObjectId(t.holderId),
                  subjectName: nameById.get(t.holderId) ?? "(holder)",
                  amount: Math.round(lcAmount * 100) / 100,
                  currencyCode: lcCurrency as CurrencyCode,
                  counterpartyType: "corporation" as const,
                  counterpartyId: refreshedCorporation._id,
                  counterpartyName: refreshedCorporation.name,
                  meta: {
                    bondId: t.bondId,
                    units: t.units,
                    couponRate: t.couponRate,
                    source: "default_cash_payoff",
                    ...(t.holderType === "fund" ? { fundId: t.holderId } : {}),
                    ...(t.bondCcy
                      ? {
                          bondCurrency: t.bondCcy,
                          bondAmount: Math.round(bondLocalAmount * 100) / 100,
                        }
                      : {}),
                  },
                },
              ];
            }

            return [
              {
                type: "bond_maturity" as const,
                turn: currentTurn,
                createdAt: now,
                subjectType: "character" as const,
                subjectId: new ObjectId(t.holderId),
                subjectName: nameById.get(t.holderId) ?? "(holder)",
                amount: Math.round(bondLocalAmount * 100) / 100,
                currencyCode: (t.bondCcy ?? "USD") as CurrencyCode,
                counterpartyType: "corporation" as const,
                counterpartyId: refreshedCorporation._id,
                counterpartyName: refreshedCorporation.name,
                meta: {
                  bondId: t.bondId,
                  units: t.units,
                  couponRate: t.couponRate,
                  source: "default_cash_payoff",
                  ...(t.holderType === "imperial" ? { imperial: true } : {}),
                },
              },
            ];
          });
          const thresholds = await loadTxThresholds(db);
          await emitTxBulk(db, txEntries, thresholds);
        }

        return NextResponse.json({
          success: true,
          paid: cost,
          bondsMatured: bondIds.length,
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
