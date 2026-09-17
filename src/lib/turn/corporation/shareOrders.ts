import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Character, Corporation } from "@/lib/db/types";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import {
  anchorToCorpCapital,
  corpLiquidCapitalToAnchor,
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import { recoverShareFillOrphans } from "@/lib/corporations/commands/shareTrading/shareFillAudit";
import { recoverShareFillMoneyOrphans } from "@/lib/corporations/commands/shareTrading/shareFillMoney";
import { recoverShareOrderRefundOrphans } from "@/lib/corporations/shareOrderRefund";
import { recoverShareOrderPlacementOrphans } from "@/lib/corporations/shareOrderPlacement";
import { recoverPublicShareTradeOrphans } from "@/lib/corporations/commands/shareTrading/publicShareTradeSpend";
import { recoverShareListingCancelOrphans } from "@/lib/corporations/cancelShareListing";
import { MoneyFlowKeyConflictError, MoneyFlowTerminalError } from "@/lib/db/nonAtomicMoneyFlow";
import { personalBalanceField } from "@/lib/corporations/commands/shareTrading/shareFillMoney";
import type { ShareFillCashLeg } from "@/lib/corporations/commands/shareTrading/shareFillMoney";
import {
  buildShareMatchKey,
  executeShareMatchFlow,
  recoverShareMatchOrphans,
  type ShareMatchDealerLeg,
  type ShareMatchHistoryParty,
  type ShareMatchPlan,
} from "./shareMatchSettlement";
import { loadEquityPoolsByCurrency, loadEquityQuote } from "@/lib/equities/marketPool";

/**
 * One computed fill, collected during resolution and settled sequentially
 * afterwards — one durable per-match flow per record, in array order, so
 * price/time priority and the running float/treasury/pool counters behave
 * exactly as the legacy batch commit did, while every write is keyed and
 * resumable (see shareMatchSettlement.ts).
 */
interface RawShareMatch {
  orderId: ObjectId;
  corpId: ObjectId;
  direction: "buy" | "sell";
  toFill: number;
  /** Executable market price in the target corp's local currency. */
  priceLocal: number;
  preSharesRemaining: number;
  postSharesRemaining: number;
  preEscrowAmount: number;
  postEscrowAmount: number;
  /** Fund-owned buys only: residual anchor escrow, mirroring the legacy ops. */
  preEscrowAnchor?: number;
  postEscrowAnchor?: number;
  filled: boolean;
  corpCurrencyCode?: CurrencyCode;
  priceAnchor: number;
  /** Buyer identity: exactly one of the two is set on buys. */
  buyerCharId?: ObjectId;
  buyerFundId?: ObjectId;
  /** Character seller (cap-table debit + proceeds). Unset for corp placers. */
  sellerCharId?: ObjectId;
  /** Placing corporation receiving sell proceeds. Unset for character sells. */
  sellerCorpId?: ObjectId;
  /** ₳ refund (buys) or proceeds (sells) before home-currency conversion. */
  cashAnchor: number;
  /** Placer-corp proceeds already converted to its liquid currency. */
  corpCreditLocal?: number;
  /** Pool/treasury dealer movement in local currency, signed. */
  dealer:
    | {
        kind: "pool";
        currency: CurrencyCode;
        amountLocal: number;
        flowKind: "purchasesIn" | "salesOut";
      }
    | { kind: "treasury"; amountLocal: number };
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Check all open share orders and fill any that match the current market price.
 * Buy orders fill when sharePrice <= pricePerShare (and public float has enough shares).
 * Sell orders fill when sharePrice >= pricePerShare (proceeds credited to seller).
 *
 * `turn` is stamped on every emitted `shareTradeHistory` row.
 */
export async function fillPendingShareOrders(db: Db, now: Date, turn: number): Promise<void> {
  // Peer-fill orphan recovery (issue #1672): route and market-sell fills run
  // keyed money legs under a money receipt, then convergent audit rows under
  // the audit receipt. The matcher's own per-match receipts converge here
  // first (disjoint key space, so order across scans is irrelevant). Re-drive
  // bounded recovery every turn before the fresh scan, money first so the
  // audit pass observes settled money: a crash between two money legs
  // converges the balances here, a crash between money and audit lands the
  // missing rows there. Placement receipts (a crash between the escrow debit
  // and the order insert, or mid-fill) converge here too, so a dead placer
  // route never strands debited-with-no-order rows past this turn. Fills
  // are rejected during the turn so no live attempt races this, and lonely
  // orphans (order already filled) are covered by the receipt scans rather
  // than the per-order stamp hook. Best-effort: recovery never fails the
  // matcher.
  try {
    await recoverShareMatchOrphans(db, 50);
  } catch {
    // Match receipts stay `in_progress` for the next turn.
  }
  try {
    await recoverShareFillMoneyOrphans(db, 50);
  } catch {
    // Money receipts stay `in_progress` for the next turn.
  }
  try {
    await recoverShareFillOrphans(db, 50);
  } catch {
    // Receipts stay `in_progress` for the next turn.
  }
  try {
    await recoverShareOrderRefundOrphans(db, 50);
  } catch {
    // Cancel receipts stay `in_progress` for the next turn.
  }
  try {
    await recoverShareOrderPlacementOrphans(db, 50);
  } catch {
    // Placement receipts stay `in_progress` for the next turn.
  }
  try {
    await recoverPublicShareTradeOrphans(db, 50);
  } catch {
    // Float-trade receipts stay `in_progress` for the next turn.
  }
  try {
    await recoverShareListingCancelOrphans(db, 50);
  } catch {
    // Listing-cancel receipts stay `in_progress` for the next turn.
  }

  const openOrders = await db.collection("shareOrders").find({ status: "open" }).toArray();

  if (openOrders.length === 0) return;

  // Group orders by corporationId
  const ordersByCorp = new Map<string, typeof openOrders>();
  for (const order of openOrders) {
    const key = order.corporationId.toString();
    const list = ordersByCorp.get(key) ?? [];
    list.push(order);
    ordersByCorp.set(key, list);
  }

  const corpIds = [...ordersByCorp.keys()].map((k) => new ObjectId(k));
  const corpDocs = await db
    .collection<Corporation>("corporations")
    .find({ _id: { $in: corpIds } })
    .toArray();
  const corpMap = new Map(corpDocs.map((c) => [c._id.toString(), c]));

  // Pre-load FX rates once so we can normalize each fill's local-currency
  // amount to ₳ before aggregating (Option B — order.pricePerShare and
  // order.escrowAmount are in each target corp's liquidCurrencyCode, and
  // adjustments here batch across corps of different currencies).
  const fxByCurrency = await loadFxRatesByCurrency(db);

  // Computed fills in deterministic resolution order. Each record converts
  // from target-corp-local to ₳ at attribution time; payout converts
  // ₳ → payee's home currency at plan build. The running counters below
  // (float, treasury, pool cash) serialize competing orders exactly as the
  // legacy batch commit did; settlement replays the records in array order.
  const rawMatches: RawShareMatch[] = [];
  // Character shares already sold this pass per corp (ticket #1154 cap input).
  const soldSharesByChar = new Map<string, Map<string, number>>();
  // Treasury-backed market maker: issuer liquidCapital movement from float
  // fills. Buy fills credit the issuer (the buyer's payment); sell fills
  // debit it, capped at the issuer's treasury, so a limit order can't mint
  // money via the float the way the market-sell cap already prevents.
  const poolCashRemaining = new Map<CurrencyCode, number>();

  // One pool document per currency; read them once for the whole loop.
  const equityPools = await loadEquityPoolsByCurrency(db);
  for (const [corpIdStr, orders] of ordersByCorp) {
    const corp = corpMap.get(corpIdStr);
    if (!corp) continue;

    const marketQuote = await loadEquityQuote(db, corp, { pools: equityPools });
    if (marketQuote.active && !poolCashRemaining.has(marketQuote.currency)) {
      poolCashRemaining.set(marketQuote.currency, marketQuote.poolCashLocal);
    }
    // Target corp's FX rate, applied to every local-currency amount in this
    // corp's fill loop (price × shares, escrow diffs, proceeds).
    const targetFxRate = fxRateForCorpFromMap(corp, fxByCurrency);
    let availableFloat: number = corp.publicFloat ?? 0;
    // Running issuer treasury (local currency) — sell fills are capped to it,
    // buy fills top it up. Starts from the corp's current liquidCapital.
    let treasuryRemaining = corp.liquidCapital ?? 0;
    const corpCurrencyCode = resolveCorpLiquidCurrencyCode(corp) as CurrencyCode | undefined;

    for (const order of orders) {
      const charIdStr = order.characterId?.toString();
      const currentPrice =
        order.type === "buy" ? marketQuote.askPriceLocal : marketQuote.bidPriceLocal;

      if (order.type === "buy" && currentPrice <= order.pricePerShare) {
        // Fill buy order if public float has shares
        const toFill = Math.min(order.sharesRemaining, availableFloat);
        if (toFill <= 0) continue;

        const actualCostLocal = toFill * currentPrice;
        const filled = toFill >= order.sharesRemaining;
        // Refund only the FILLED shares' below-limit savings (paid limit price,
        // executed at lower market price). The branch guard guarantees
        // currentPrice <= order.pricePerShare, so this is >= 0. For a full fill
        // this equals the old `order.escrowAmount - actualCostLocal`. On a
        // partial fill, the unfilled shares' escrow stays reserved on the order
        // (see escrowAmount/escrowAnchor below) so cancel refunds it later —
        // refunding the whole remainder here would double-count it.
        const refundLocal = toFill * (order.pricePerShare - currentPrice); // local currency
        // Share-proportional residual escrow for the unfilled portion (FX-stable).
        const unfilledFraction = (order.sharesRemaining - toFill) / order.sharesRemaining;
        const residualEscrowLocal = order.escrowAmount * unfilledFraction;
        const residualEscrowAnchor = (order.escrowAnchor ?? 0) * unfilledFraction;

        if (order.placerFundId) {
          // ── Index-fund-owned buy fill ────────────────────────────────────
          // Mirrors the character path exactly, but credits go to the fund's
          // cap-table entry (fundId) and unused-escrow refunds go to the fund's
          // cashAnchor. Treasury/float deltas are identical to a char buy, so
          // the issuer still receives the buyer payment (money conserved).
          // Reserve the unfilled shares' escrow (both local and anchor) on
          // partial fills so a later cancel refunds exactly that portion.
          availableFloat -= toFill;
          let fundDealer: RawShareMatch["dealer"];
          if (marketQuote.active) {
            poolCashRemaining.set(
              marketQuote.currency,
              (poolCashRemaining.get(marketQuote.currency) ?? 0) + actualCostLocal
            );
            fundDealer = {
              kind: "pool",
              currency: marketQuote.currency,
              amountLocal: actualCostLocal,
              flowKind: "purchasesIn",
            };
          } else {
            treasuryRemaining += actualCostLocal;
            fundDealer = { kind: "treasury", amountLocal: actualCostLocal };
          }
          rawMatches.push({
            orderId: order._id,
            corpId: new ObjectId(corpIdStr),
            direction: "buy",
            toFill,
            priceLocal: currentPrice,
            preSharesRemaining: order.sharesRemaining,
            postSharesRemaining: filled ? 0 : order.sharesRemaining - toFill,
            preEscrowAmount: order.escrowAmount,
            postEscrowAmount: filled ? 0 : residualEscrowLocal,
            preEscrowAnchor: order.escrowAnchor,
            postEscrowAnchor: filled ? 0 : residualEscrowAnchor,
            filled,
            corpCurrencyCode,
            priceAnchor: corpLiquidCapitalToAnchor(currentPrice, corp, targetFxRate),
            buyerFundId: order.placerFundId,
            cashAnchor:
              refundLocal > 0 ? corpLiquidCapitalToAnchor(refundLocal, corp, targetFxRate) : 0,
            dealer: fundDealer,
          });
          continue;
        }

        if (!charIdStr) continue;

        // Refund unused escrow (paid limit price, filled at lower market price).
        // Normalize local → ₳ at attribution; payout converts ₳ → home
        // currency at plan build so the record aggregates correctly across
        // fills in multiple target currencies.
        availableFloat -= toFill;
        let charDealer: RawShareMatch["dealer"];
        if (marketQuote.active) {
          poolCashRemaining.set(
            marketQuote.currency,
            (poolCashRemaining.get(marketQuote.currency) ?? 0) + actualCostLocal
          );
          charDealer = {
            kind: "pool",
            currency: marketQuote.currency,
            amountLocal: actualCostLocal,
            flowKind: "purchasesIn",
          };
        } else {
          treasuryRemaining += actualCostLocal;
          charDealer = { kind: "treasury", amountLocal: actualCostLocal };
        }

        // Queue the match — buy: from = float (null), to = character.
        // currentPrice (= corp.sharePrice) is stored in the target corp's
        // liquidCurrencyCode (Option B, v0.2.6); convert to ₳ for the audit row.
        rawMatches.push({
          orderId: order._id,
          corpId: new ObjectId(corpIdStr),
          direction: "buy",
          toFill,
          priceLocal: currentPrice,
          preSharesRemaining: order.sharesRemaining,
          postSharesRemaining: filled ? 0 : order.sharesRemaining - toFill,
          preEscrowAmount: order.escrowAmount,
          postEscrowAmount: filled ? 0 : residualEscrowLocal,
          filled,
          corpCurrencyCode,
          priceAnchor: corpLiquidCapitalToAnchor(currentPrice, corp, targetFxRate),
          buyerCharId: order.characterId,
          cashAnchor:
            refundLocal > 0 ? corpLiquidCapitalToAnchor(refundLocal, corp, targetFxRate) : 0,
          dealer: charDealer,
        });
      } else if (order.type === "sell" && currentPrice >= order.pricePerShare) {
        // Fund-owned asks are executable peer quotes. They intentionally do
        // not auto-fill against the issuer treasury: doing so would guarantee
        // the liquidity provider an exit and would bypass the guarded dual
        // debit of its cap-table and fund holdings ledgers.
        if (order.placerFundId) continue;
        // Fill sell order at the executable bid (which is at least the seller's
        // limit), add the shares to public float, and pay the seller.
        // Character sell orders are not debited at placement, so a reverse split
        // (or any later sale) can leave sharesRemaining far above the live
        // holding. Capping here stops the fill from driving the seller negative
        // and dumping a pre-split share count into the float (ticket #1154).
        let toFill = order.sharesRemaining;
        if (!order.placerCorporationId && charIdStr) {
          const held =
            (corp.shareholders ?? []).find((sh) => sh.characterId?.toString() === charIdStr)
              ?.shares ?? 0;
          // Shares already sold by this character earlier in this pass were
          // never added back to the snapshot holding, so subtract them here
          // (ticket #1154 cap, same arithmetic as the legacy debit map).
          const alreadySold = soldSharesByChar.get(corpIdStr)?.get(charIdStr) ?? 0;
          const available = Math.max(0, held - alreadySold);
          toFill = Math.min(toFill, available);
        }
        if (marketQuote.active) {
          const cashAvailable = poolCashRemaining.get(marketQuote.currency) ?? 0;
          const cashLimitedShares =
            currentPrice > 0 ? Math.floor((cashAvailable + 1e-9) / currentPrice) : 0;
          toFill = Math.min(toFill, cashLimitedShares);
        }
        if (toFill <= 0) continue;

        const proceedsLocal = toFill * currentPrice;
        let sellDealer: RawShareMatch["dealer"];
        if (marketQuote.active) {
          const remainingCash = poolCashRemaining.get(marketQuote.currency) ?? 0;
          poolCashRemaining.set(marketQuote.currency, remainingCash - proceedsLocal);
          sellDealer = {
            kind: "pool",
            currency: marketQuote.currency,
            amountLocal: -proceedsLocal,
            flowKind: "salesOut",
          };
        } else {
          // Compatibility fallback for worlds without a pool.
          if (treasuryRemaining < proceedsLocal) continue;
          treasuryRemaining -= proceedsLocal;
          sellDealer = { kind: "treasury", amountLocal: -proceedsLocal };
        }
        const proceedsAnchor = corpLiquidCapitalToAnchor(proceedsLocal, corp, targetFxRate);

        // Shares go to public float
        availableFloat += toFill;

        // Corp sell orders already debited shares from the corp's shareholder
        // entry at order-creation time — do NOT debit again.
        // Character sell orders only reserved shares, so debit now; track
        // this pass's sales for the ticket #1154 cap above.
        let sellerDebitCharId: ObjectId | undefined;
        if (!order.placerCorporationId && charIdStr) {
          sellerDebitCharId = order.characterId;
          const sold = soldSharesByChar.get(corpIdStr) ?? new Map<string, number>();
          sold.set(charIdStr, (sold.get(charIdStr) ?? 0) + toFill);
          soldSharesByChar.set(corpIdStr, sold);
        }

        // Corp sell orders: pay the placing corporation, not the CEO character.
        // Character sell orders: pay the character directly. The placer-corp
        // credit is converted here (its liquid currency is known); character
        // credits convert ₳ → home currency at plan build.
        let corpCreditLocal: number | undefined;
        if (order.placerCorporationId) {
          const placerCorp = corpMap.get(order.placerCorporationId.toString());
          const code = placerCorp ? resolveCorpLiquidCurrencyCode(placerCorp) : undefined;
          const rate = code ? (fxByCurrency.get(code) ?? 1.0) : 1.0;
          corpCreditLocal = anchorToCorpCapital(proceedsAnchor, code, rate);
        }

        // Queue the match — sell: from = seller, to = float (null).
        // order.pricePerShare is stored in the target corp's liquidCurrencyCode
        // (Option B); convert to ₳ for the audit row.
        const sellFilled = toFill >= order.sharesRemaining;
        rawMatches.push({
          orderId: order._id,
          corpId: new ObjectId(corpIdStr),
          direction: "sell",
          toFill,
          priceLocal: currentPrice,
          preSharesRemaining: order.sharesRemaining,
          postSharesRemaining: sellFilled ? 0 : order.sharesRemaining - toFill,
          preEscrowAmount: order.escrowAmount ?? 0,
          postEscrowAmount: order.escrowAmount ?? 0,
          filled: sellFilled,
          corpCurrencyCode,
          priceAnchor: corpLiquidCapitalToAnchor(currentPrice, corp, targetFxRate),
          sellerCharId: order.placerCorporationId ? undefined : order.characterId,
          sellerCorpId: order.placerCorporationId,
          sellerDebitCharId,
          cashAnchor: proceedsAnchor,
          corpCreditLocal,
          dealer: sellDealer,
        });
      }
    }
  }

  // Nothing matched: no receipts, no writes.
  if (rawMatches.length === 0) return;

  // ── Plan assembly ──────────────────────────────────────────────────────
  // Character cash parties need home-currency conversion (batch load, one
  // query), and history parties need display names (batch loads). All
  // amounts are pinned here; execution and recovery never recompute them.
  const forexEnabled = await isForexEnabled();
  const cashCharIds = new Set<string>();
  const nameCharIds = new Set<string>();
  const nameCorpIds = new Set<string>();
  for (const match of rawMatches) {
    if (match.buyerCharId) {
      cashCharIds.add(match.buyerCharId.toString());
      nameCharIds.add(match.buyerCharId.toString());
    }
    if (match.sellerCharId) {
      cashCharIds.add(match.sellerCharId.toString());
      nameCharIds.add(match.sellerCharId.toString());
    }
    if (match.sellerCorpId) nameCorpIds.add(match.sellerCorpId.toString());
  }
  const cashChars =
    cashCharIds.size > 0
      ? await db
          .collection<Character>("characters")
          .find({ _id: { $in: [...cashCharIds].map((id) => new ObjectId(id)) } })
          .project<{ _id: ObjectId; countryId: string; name: string }>({
            _id: 1,
            countryId: 1,
            name: 1,
          })
          .toArray()
      : [];
  const charCountryMap = new Map(cashChars.map((c) => [c._id.toString(), c.countryId]));
  const charNameMap = new Map(cashChars.map((c) => [c._id.toString(), c.name]));
  const nameCorps =
    nameCorpIds.size > 0
      ? await db
          .collection<Corporation>("corporations")
          .find({ _id: { $in: [...nameCorpIds].map((id) => new ObjectId(id)) } })
          .project<{ _id: ObjectId; name: string }>({ _id: 1, name: 1 })
          .toArray()
      : [];
  const corpNameMap = new Map(nameCorps.map((c) => [c._id.toString(), c.name]));

  const toHistoryParty = (
    charId: ObjectId | undefined,
    corpId: ObjectId | undefined
  ): ShareMatchHistoryParty | null => {
    if (charId) {
      return {
        characterIdHex: charId.toString(),
        name: charNameMap.get(charId.toString()) ?? "Unknown character",
      };
    }
    if (corpId) {
      return {
        corporationIdHex: corpId.toString(),
        name: corpNameMap.get(corpId.toString()) ?? "Unknown corporation",
      };
    }
    return null;
  };

  const toCharCashLeg = (charId: ObjectId, anchorAmount: number): ShareFillCashLeg => {
    const countryId = charCountryMap.get(charId.toString()) ?? "US";
    const currency: CurrencyCode =
      COUNTRY_CURRENCY_MAP[countryId as keyof typeof COUNTRY_CURRENCY_MAP] ?? "USD";
    const rate = fxByCurrency.get(currency) ?? 1.0;
    return {
      collection: "characters",
      idHex: charId.toString(),
      field: personalBalanceField(currency, forexEnabled),
      amount: forexEnabled ? anchorAmount * rate : anchorAmount,
    };
  };

  const plans: ShareMatchPlan[] = rawMatches.map((match) => {
    let cashLeg: ShareFillCashLeg | null = null;
    if (match.direction === "buy") {
      if (match.cashAnchor !== 0) {
        cashLeg = match.buyerCharId
          ? toCharCashLeg(match.buyerCharId, match.cashAnchor)
          : {
              collection: "indexFunds",
              idHex: match.buyerFundId!.toString(),
              field: "cashAnchor",
              amount: match.cashAnchor,
            };
      }
    } else if (match.sellerCorpId) {
      cashLeg =
        match.corpCreditLocal !== undefined && match.corpCreditLocal !== 0
          ? {
              collection: "corporations",
              idHex: match.sellerCorpId.toString(),
              field: "liquidCapital",
              amount: match.corpCreditLocal,
            }
          : null;
    } else if (match.sellerCharId && match.cashAnchor !== 0) {
      cashLeg = toCharCashLeg(match.sellerCharId, match.cashAnchor);
    }

    let dealerLeg: ShareMatchDealerLeg | null = null;
    if (match.dealer.kind === "pool") {
      const rounded = roundCents(match.dealer.amountLocal);
      if (rounded !== 0) {
        dealerLeg = {
          kind: "pool",
          currency: match.dealer.currency,
          amountLocal: rounded,
          flowKind: match.dealer.flowKind,
        };
      }
    } else if (match.dealer.amountLocal !== 0) {
      dealerLeg = { kind: "treasury", amountLocal: match.dealer.amountLocal };
    }

    return {
      version: 1 as const,
      matchKey: buildShareMatchKey(turn, match.orderId.toString(), match.preSharesRemaining),
      turn,
      nowIso: now.toISOString(),
      orderIdHex: match.orderId.toString(),
      corpIdHex: match.corpId.toString(),
      direction: match.direction,
      shares: match.toFill,
      priceLocal: match.priceLocal,
      claim: {
        preSharesRemaining: match.preSharesRemaining,
        postSharesRemaining: match.postSharesRemaining,
        preEscrowAmount: match.preEscrowAmount,
        postEscrowAmount: match.postEscrowAmount,
        ...(match.preEscrowAnchor !== undefined
          ? {
              preEscrowAnchor: match.preEscrowAnchor,
              postEscrowAnchor: match.postEscrowAnchor ?? 0,
            }
          : {}),
        postStatus: match.filled ? ("filled" as const) : ("open" as const),
      },
      sellerDebit: match.sellerDebitCharId
        ? {
            field: "characterId" as const,
            idHex: match.sellerDebitCharId.toString(),
            pricePerShare: match.priceLocal,
          }
        : null,
      buyerCredit:
        match.direction === "buy"
          ? match.buyerCharId
            ? {
                field: "characterId" as const,
                idHex: match.buyerCharId.toString(),
                pricePerShare: match.priceLocal,
              }
            : {
                field: "fundId" as const,
                idHex: match.buyerFundId!.toString(),
                pricePerShare: match.priceLocal,
              }
          : null,
      // Fund holdings credit uses the same ₳ fill price the legacy batch
      // passed to the fund cap-table and holdings writers.
      holdingsCredit:
        match.direction === "buy" && match.buyerFundId
          ? { fundIdHex: match.buyerFundId.toString(), priceAnchor: match.priceAnchor }
          : null,
      cashLeg,
      dealerLeg,
      floatDelta: match.direction === "buy" ? -match.toFill : match.toFill,
      history: {
        shares: match.toFill,
        priceAnchor: match.priceAnchor,
        ...(match.corpCurrencyCode ? { corpCcy: match.corpCurrencyCode } : {}),
        from:
          match.direction === "sell"
            ? toHistoryParty(match.sellerCharId, match.sellerCorpId)
            : null,
        to: match.direction === "buy" ? toHistoryParty(match.buyerCharId, undefined) : null,
      },
    };
  });

  // ── Sequential settlement ──────────────────────────────────────────────
  // One durable flow per match, in resolution order. A match whose guards
  // fail at commit (pool/treasury short, seller shares raced away — only
  // reachable on a bug or a concurrent writer, never under the turn lock)
  // settles failed/compensated, reopens its order claim, and is SKIPPED so
  // the rest of the batch still fills; the receipt records the cause for
  // ops. Anything unexpected (validation, code defect) still throws and
  // fails the turn loudly. Later matches were computed against running
  // counters that assumed this match consumed, but every commit leg
  // re-guards atomically, so staleness can only skip a later match, never
  // over-apply it.
  for (const plan of plans) {
    try {
      await executeShareMatchFlow(db, plan);
    } catch (error) {
      if (
        error instanceof MoneyFlowTerminalError ||
        error instanceof MoneyFlowKeyConflictError ||
        (error instanceof Error && error.message.startsWith("share-match:"))
      ) {
        continue;
      }
      throw error;
    }
  }
}
