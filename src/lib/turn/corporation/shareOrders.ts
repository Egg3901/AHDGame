import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Character, Corporation } from "@/lib/db/types";
import { buildPersonalBalanceBulkOp } from "@/lib/currency/characterFunds";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import {
  anchorToCorpCapital,
  corpLiquidCapitalToAnchor,
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import { recordShareTrade } from "@/lib/corporations/shareTradeHistory";
import type { ShareTradeParty } from "@/lib/db/types/shareTradeHistory";
import { resolveShareExecutionPrice } from "@/lib/corporations/marketExecution";
import { creditSharesToFund } from "@/lib/corporations/shareholderOps";

/** Per-character delta for a corp, plus the fill price for new-entry cost basis. */
interface ShareDelta {
  delta: number;
  /**
   * Per-share fill price (₳). Set when this delta *increases* a holding (buy fill)
   * so we can stamp `avgCostPerShare` on a brand-new pushed entry and match the
   * convention used by the direct-buy route. Not tracked for sells (decrement only).
   */
  pricePerShare?: number;
}

/**
 * One queued trade-history emission collected during fill resolution.
 * Names are resolved in a batch lookup after all fills are applied.
 */
interface PendingHistoryEmit {
  corporationId: ObjectId;
  kind: "limit_fill";
  shares: number;
  pricePerShareAnchor: number;
  corpCurrencyCode?: CurrencyCode;
  /** Populated with a resolved name before insert. */
  fromPartyRef?: { characterId?: ObjectId; corporationId?: ObjectId };
  toPartyRef?: { characterId?: ObjectId; corporationId?: ObjectId };
}

/**
 * Check all open share orders and fill any that match the current market price.
 * Buy orders fill when sharePrice <= pricePerShare (and public float has enough shares).
 * Sell orders fill when sharePrice >= pricePerShare (proceeds credited to seller).
 *
 * `turn` is stamped on every emitted `shareTradeHistory` row.
 */
export async function fillPendingShareOrders(db: Db, now: Date, turn: number): Promise<void> {
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

  // All maps below store ₳. Each contribution converts from target-corp-local
  // to ₳ at attribution time; payout converts ₳ → payee's home currency.
  const charCashAdjustments = new Map<string, number>();
  // liquidCapital adjustments for corporations that placed sell orders
  const corpCashAdjustments = new Map<string, number>(); // placerCorpId -> proceeds
  // shareholder updates per corporation (track incrementally), carrying fill price
  const corpShareholderUpdates = new Map<string, Map<string, ShareDelta>>();
  const corpFloatDeltas = new Map<string, number>(); // corpId -> publicFloat delta
  // Treasury-backed market maker: issuer liquidCapital delta from float fills.
  // Buy fills credit the issuer (the buyer's payment); sell fills debit it,
  // capped at the issuer's treasury, so a limit order can't mint money via the
  // float the way the market-sell cap already prevents.
  const corpTreasuryDeltas = new Map<string, number>(); // corpId -> liquidCapital delta (local)
  // ── Index-fund-owned buy orders ──────────────────────────────────────────
  // Fund share credits per corp (corp → fund → ShareDelta) applied after the
  // corp bulk writes via creditSharesToFund.
  const fundShareholderUpdates = new Map<string, Map<string, ShareDelta>>();
  // Unused-escrow refunds per fund (fundId → ₳ refund) credited back to cashAnchor.
  const fundCashAdjustments = new Map<string, number>();
  const historyEmits: PendingHistoryEmit[] = [];

  const orderFillOps: {
    updateOne: { filter: Record<string, unknown>; update: Record<string, unknown> };
  }[] = [];

  for (const [corpIdStr, orders] of ordersByCorp) {
    const corp = corpMap.get(corpIdStr);
    if (!corp) continue;

    const currentPrice = resolveShareExecutionPrice(corp) ?? 0.01;
    // Target corp's FX rate, applied to every local-currency amount in this
    // corp's fill loop (price × shares, escrow diffs, proceeds).
    const targetFxRate = fxRateForCorpFromMap(corp, fxByCurrency);
    let availableFloat: number = corp.publicFloat ?? 0;
    // Running issuer treasury (local currency) — sell fills are capped to it,
    // buy fills top it up. Starts from the corp's current liquidCapital.
    let treasuryRemaining = corp.liquidCapital ?? 0;
    let treasuryDelta = 0;
    const corpCurrencyCode = resolveCorpLiquidCurrencyCode(corp) as CurrencyCode | undefined;

    for (const order of orders) {
      const charIdStr = order.characterId?.toString();

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
          const fundIdStr = order.placerFundId.toString();
          const fundDelta = fundShareholderUpdates.get(corpIdStr) ?? new Map<string, ShareDelta>();
          const existingFund = fundDelta.get(fundIdStr) ?? { delta: 0 };
          fundDelta.set(fundIdStr, {
            delta: existingFund.delta + toFill,
            pricePerShare: currentPrice,
          });
          fundShareholderUpdates.set(corpIdStr, fundDelta);

          if (refundLocal > 0) {
            const refundAnchor = corpLiquidCapitalToAnchor(refundLocal, corp, targetFxRate);
            fundCashAdjustments.set(
              fundIdStr,
              (fundCashAdjustments.get(fundIdStr) ?? 0) + refundAnchor
            );
          }

          availableFloat -= toFill;
          corpFloatDeltas.set(corpIdStr, (corpFloatDeltas.get(corpIdStr) ?? 0) - toFill);

          // Buyer's payment (actual fill cost) flows into the issuer treasury.
          treasuryRemaining += actualCostLocal;
          treasuryDelta += actualCostLocal;

          historyEmits.push({
            corporationId: new ObjectId(corpIdStr),
            kind: "limit_fill",
            shares: toFill,
            pricePerShareAnchor: corpLiquidCapitalToAnchor(currentPrice, corp, targetFxRate),
            corpCurrencyCode,
            // Fund holders aren't a char/corp party ref; record float→null buy.
            toPartyRef: undefined,
          });

          // Reserve the unfilled shares' escrow (both local and anchor) on
          // partial fills so a later cancel refunds exactly that portion.
          orderFillOps.push({
            updateOne: {
              filter: { _id: order._id },
              update: {
                $set: {
                  sharesRemaining: filled ? 0 : order.sharesRemaining - toFill,
                  escrowAmount: filled ? 0 : residualEscrowLocal,
                  escrowAnchor: filled ? 0 : residualEscrowAnchor,
                  status: filled ? "filled" : "open",
                  updatedAt: now,
                },
              },
            },
          });
          continue;
        }

        if (!charIdStr) continue;

        // Credit shares. Record the fill price so a brand-new shareholder entry
        // gets its avgCostPerShare stamped (matches /shares/buy convention).
        const delta = corpShareholderUpdates.get(corpIdStr) ?? new Map<string, ShareDelta>();
        const existing = delta.get(charIdStr) ?? { delta: 0 };
        delta.set(charIdStr, {
          delta: existing.delta + toFill,
          pricePerShare: currentPrice,
        });
        corpShareholderUpdates.set(corpIdStr, delta);

        // Refund unused escrow (paid limit price, filled at lower market price).
        // Normalize local → ₳ so the per-character map can aggregate correctly
        // across fills in multiple target currencies.
        if (refundLocal > 0) {
          const refundAnchor = corpLiquidCapitalToAnchor(refundLocal, corp, targetFxRate);
          charCashAdjustments.set(
            charIdStr,
            (charCashAdjustments.get(charIdStr) ?? 0) + refundAnchor
          );
        }

        availableFloat -= toFill;
        corpFloatDeltas.set(corpIdStr, (corpFloatDeltas.get(corpIdStr) ?? 0) - toFill);

        // Buyer's payment (actual fill cost) flows into the issuer treasury.
        treasuryRemaining += actualCostLocal;
        treasuryDelta += actualCostLocal;

        // Queue history entry — buy: from = float (null), to = character.
        // currentPrice (= corp.sharePrice) is stored in the target corp's
        // liquidCurrencyCode (Option B, v0.2.6); convert to ₳ for the audit row.
        historyEmits.push({
          corporationId: new ObjectId(corpIdStr),
          kind: "limit_fill",
          shares: toFill,
          pricePerShareAnchor: corpLiquidCapitalToAnchor(currentPrice, corp, targetFxRate),
          corpCurrencyCode,
          toPartyRef: { characterId: order.characterId },
        });

        orderFillOps.push({
          updateOne: {
            filter: { _id: order._id },
            update: {
              $set: {
                sharesRemaining: filled ? 0 : order.sharesRemaining - toFill,
                escrowAmount: filled ? 0 : residualEscrowLocal,
                status: filled ? "filled" : "open",
                updatedAt: now,
              },
            },
          },
        });
      } else if (order.type === "sell" && currentPrice >= order.pricePerShare) {
        // Fill sell order: add shares to public float, pay seller at limit price.
        const proceedsLocal = order.sharesRemaining * order.pricePerShare;
        // Treasury cap: the issuer buys the shares back from its own
        // liquidCapital. If it can't cover, leave the order open (no mint).
        if (treasuryRemaining < proceedsLocal) continue;
        treasuryRemaining -= proceedsLocal;
        treasuryDelta -= proceedsLocal;
        const proceedsAnchor = corpLiquidCapitalToAnchor(proceedsLocal, corp, targetFxRate);

        // Corp sell orders: pay the placing corporation, not the CEO character.
        // Character sell orders: pay the character directly.
        if (order.placerCorporationId) {
          const placerIdStr = order.placerCorporationId.toString();
          corpCashAdjustments.set(
            placerIdStr,
            (corpCashAdjustments.get(placerIdStr) ?? 0) + proceedsAnchor
          );
        } else if (charIdStr) {
          charCashAdjustments.set(
            charIdStr,
            (charCashAdjustments.get(charIdStr) ?? 0) + proceedsAnchor
          );
        }

        // Shares go to public float
        availableFloat += order.sharesRemaining;
        corpFloatDeltas.set(
          corpIdStr,
          (corpFloatDeltas.get(corpIdStr) ?? 0) + order.sharesRemaining
        );

        // Corp sell orders already debited shares from the corp's shareholder
        // entry at order-creation time — do NOT debit again.
        // Character sell orders only reserved shares, so debit now.
        if (!order.placerCorporationId && charIdStr) {
          const delta = corpShareholderUpdates.get(corpIdStr) ?? new Map<string, ShareDelta>();
          const existing = delta.get(charIdStr) ?? { delta: 0 };
          delta.set(charIdStr, { delta: existing.delta - order.sharesRemaining });
          corpShareholderUpdates.set(corpIdStr, delta);
        }

        // Queue history entry — sell: from = seller, to = float (null).
        // order.pricePerShare is stored in the target corp's liquidCurrencyCode
        // (Option B); convert to ₳ for the audit row.
        historyEmits.push({
          corporationId: new ObjectId(corpIdStr),
          kind: "limit_fill",
          shares: order.sharesRemaining,
          pricePerShareAnchor: corpLiquidCapitalToAnchor(order.pricePerShare, corp, targetFxRate),
          corpCurrencyCode,
          fromPartyRef: order.placerCorporationId
            ? { corporationId: order.placerCorporationId }
            : { characterId: order.characterId },
        });

        orderFillOps.push({
          updateOne: {
            filter: { _id: order._id },
            update: { $set: { sharesRemaining: 0, status: "filled", updatedAt: now } },
          },
        });
      }
    }

    if (treasuryDelta !== 0) corpTreasuryDeltas.set(corpIdStr, treasuryDelta);
  }

  // Apply corporation shareholder updates atomically (per-character positional ops)
  // Phase 1: $inc existing shareholder entries + float/trade updates per corp
  const incOps: {
    updateOne: { filter: Record<string, unknown>; update: Record<string, unknown> };
  }[] = [];
  // Track which (corp, char) pairs need a $push if they don't have an existing entry.
  // pricePerShare (₳) is stamped on the new entry as avgCostPerShare so portfolio
  // cost-basis / PnL display works for orders filled by the turn processor.
  const pushNeeded: {
    corpId: ObjectId;
    charId: ObjectId;
    delta: number;
    pricePerShare?: number;
  }[] = [];

  for (const [corpIdStr, charDeltas] of corpShareholderUpdates) {
    const corp = corpMap.get(corpIdStr);
    if (!corp) continue;

    const existingCharIds = new Set(
      (corp.shareholders ?? [])
        .filter((sh) => sh.characterId)
        .map((sh) => sh.characterId!.toString())
    );

    const floatDelta = corpFloatDeltas.get(corpIdStr) ?? 0;

    // One update per corp for float delta
    if (floatDelta !== 0) {
      incOps.push({
        updateOne: {
          filter: { _id: new ObjectId(corpIdStr) },
          update: {
            $inc: { publicFloat: floatDelta },
            $set: { updatedAt: now },
          },
        },
      });
    }

    for (const [charIdStr, { delta, pricePerShare }] of charDeltas) {
      if (existingCharIds.has(charIdStr)) {
        // Atomic positional $inc on existing entry
        incOps.push({
          updateOne: {
            filter: {
              _id: new ObjectId(corpIdStr),
              "shareholders.characterId": new ObjectId(charIdStr),
            },
            update: {
              $inc: { "shareholders.$.shares": delta },
              $set: { updatedAt: now },
            },
          },
        });
      } else {
        pushNeeded.push({
          corpId: new ObjectId(corpIdStr),
          charId: new ObjectId(charIdStr),
          delta,
          pricePerShare,
        });
      }
    }
  }

  // Apply float deltas for corps with only sell-order fills (no buy-order shareholder changes)
  for (const [corpIdStr, floatDelta] of corpFloatDeltas) {
    if (!corpShareholderUpdates.has(corpIdStr) && floatDelta !== 0) {
      incOps.push({
        updateOne: {
          filter: { _id: new ObjectId(corpIdStr) },
          update: {
            $inc: { publicFloat: floatDelta },
            $set: { updatedAt: now },
          },
        },
      });
    }
  }

  if (orderFillOps.length > 0) {
    await db.collection("shareOrders").bulkWrite(orderFillOps);
  }
  if (incOps.length > 0) {
    await db.collection("corporations").bulkWrite(incOps);
  }
  // Phase 2: $push for new shareholder entries that didn't exist at read time.
  // Include avgCostPerShare so the pushed entry matches the shape /shares/buy
  // writes — otherwise portfolio PnL display shows "-" for these holdings.
  if (pushNeeded.length > 0) {
    const pushOps = pushNeeded.map(({ corpId, charId, delta, pricePerShare }) => ({
      updateOne: {
        filter: { _id: corpId },
        update: {
          $push: {
            shareholders: {
              characterId: charId,
              shares: delta,
              ...(pricePerShare !== undefined ? { avgCostPerShare: pricePerShare } : {}),
            },
          },
          $set: { updatedAt: now },
        },
      },
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.collection("corporations").bulkWrite(pushOps as any[]);
  }
  if (charCashAdjustments.size > 0) {
    const forexEnabled = await isForexEnabled();
    const adjCharIds = [...charCashAdjustments.keys()].map((id) => new ObjectId(id));
    const adjChars = await db
      .collection<Character>("characters")
      .find({ _id: { $in: adjCharIds } })
      .project<{ _id: ObjectId; countryId: string }>({ _id: 1, countryId: 1 })
      .toArray();
    const charCountryMap = new Map(adjChars.map((c) => [c._id.toString(), c.countryId]));

    // Map values are ₳ (normalized at attribution). Convert to each character's
    // home currency for the wallet credit.
    const charOps = [...charCashAdjustments.entries()].map(([charIdStr, amountAnchor]) => {
      const countryId = charCountryMap.get(charIdStr) ?? "US";
      const currency: CurrencyCode =
        COUNTRY_CURRENCY_MAP[countryId as keyof typeof COUNTRY_CURRENCY_MAP] ?? "USD";
      const rate = fxByCurrency.get(currency) ?? 1.0;
      const amountInCurrency = forexEnabled ? amountAnchor * rate : amountAnchor;
      return buildPersonalBalanceBulkOp(
        new ObjectId(charIdStr),
        amountInCurrency,
        currency,
        forexEnabled
      );
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.collection("characters").bulkWrite(charOps as any);
  }

  // Pay corporations that had sell orders filled (proceeds → liquidCapital).
  // Map values are ₳ (normalized at attribution); each corp's liquidCapital is
  // in its home currency, so convert on payout.
  if (corpCashAdjustments.size > 0) {
    const corpPayOps = [...corpCashAdjustments.entries()].map(([corpIdStr, amount]) => {
      const corp = corpMap.get(corpIdStr);
      // Use the resolver so corps with `countryId` but no `liquidCurrencyCode`
      // stamped yet fall back to COUNTRY_CURRENCY_MAP — otherwise the amount
      // lands as raw ₳ in a local-denominated liquidCapital field.
      const code = corp ? resolveCorpLiquidCurrencyCode(corp) : undefined;
      // USD floats against ₳ like every other forex-active currency — must use
      // the live rate, not 1.0. See invariant in corporationCapital.ts:13-17.
      const rate = code ? (fxByCurrency.get(code) ?? 1.0) : 1.0;
      const credit = anchorToCorpCapital(amount, code, rate);
      return {
        updateOne: {
          filter: { _id: new ObjectId(corpIdStr) },
          update: { $inc: { liquidCapital: credit }, $set: { updatedAt: now } },
        },
      };
    });
    await db.collection("corporations").bulkWrite(corpPayOps);
  }

  // Treasury-backed market maker: apply each issuer's net liquidCapital delta
  // from float fills (already in the issuer's local currency). Buy fills credit,
  // sell fills debit — so the float trades conserve money against the treasury.
  if (corpTreasuryDeltas.size > 0) {
    const treasuryOps = [...corpTreasuryDeltas.entries()]
      .filter(([, delta]) => delta !== 0)
      .map(([corpIdStr, delta]) => ({
        updateOne: {
          filter: { _id: new ObjectId(corpIdStr) },
          update: { $inc: { liquidCapital: delta }, $set: { updatedAt: now } },
        },
      }));
    if (treasuryOps.length > 0) {
      await db.collection("corporations").bulkWrite(treasuryOps);
    }
  }

  // ── Index-fund buy fills ─────────────────────────────────────────────────
  // Credit fund cap-table holdings for each (corp, fund) buy fill, then refund
  // unused escrow to each fund's cashAnchor. Float deltas were already applied
  // above (corpFloatDeltas), so pass shares-only credits here (no extra float
  // $inc — that would double-decrement). The issuer treasury already received
  // the buyer payment via corpTreasuryDeltas, conserving money exactly as for a
  // character/corp buy.
  if (fundShareholderUpdates.size > 0) {
    for (const [corpIdStr, fundDeltas] of fundShareholderUpdates) {
      const corp = corpMap.get(corpIdStr);
      if (!corp) continue;
      const targetFxRate = fxRateForCorpFromMap(corp, fxByCurrency);
      for (const [fundIdStr, { delta, pricePerShare }] of fundDeltas) {
        if (delta <= 0) continue;
        // Stamp ₳ cost basis on the fund holding (pricePerShare is corp-local).
        const fillPriceAnchor = corpLiquidCapitalToAnchor(pricePerShare ?? 0, corp, targetFxRate);
        await creditSharesToFund(
          db,
          new ObjectId(corpIdStr),
          new ObjectId(fundIdStr),
          delta,
          fillPriceAnchor,
          { $set: { updatedAt: now } }
        );
      }
    }
  }

  if (fundCashAdjustments.size > 0) {
    const fundRefundOps = [...fundCashAdjustments.entries()]
      .filter(([, amount]) => amount > 0)
      .map(([fundIdStr, amount]) => ({
        updateOne: {
          filter: { _id: new ObjectId(fundIdStr) },
          update: { $inc: { cashAnchor: amount }, $set: { updatedAt: now } },
        },
      }));
    if (fundRefundOps.length > 0) {
      await db.collection("indexFunds").bulkWrite(fundRefundOps);
    }
  }

  // Resolve party display names in a batch and emit history rows. Trade-history
  // writes are best-effort; they must not roll back any share movement above.
  if (historyEmits.length > 0) {
    const charIdSet = new Set<string>();
    const corpIdSet = new Set<string>();
    for (const emit of historyEmits) {
      if (emit.fromPartyRef?.characterId) charIdSet.add(emit.fromPartyRef.characterId.toString());
      if (emit.toPartyRef?.characterId) charIdSet.add(emit.toPartyRef.characterId.toString());
      if (emit.fromPartyRef?.corporationId)
        corpIdSet.add(emit.fromPartyRef.corporationId.toString());
      if (emit.toPartyRef?.corporationId) corpIdSet.add(emit.toPartyRef.corporationId.toString());
    }

    const [nameChars, nameCorps] = await Promise.all([
      charIdSet.size > 0
        ? db
            .collection<Character>("characters")
            .find({ _id: { $in: [...charIdSet].map((id) => new ObjectId(id)) } })
            .project<{ _id: ObjectId; name: string }>({ _id: 1, name: 1 })
            .toArray()
        : Promise.resolve([] as { _id: ObjectId; name: string }[]),
      corpIdSet.size > 0
        ? db
            .collection<Corporation>("corporations")
            .find({ _id: { $in: [...corpIdSet].map((id) => new ObjectId(id)) } })
            .project<{ _id: ObjectId; name: string }>({ _id: 1, name: 1 })
            .toArray()
        : Promise.resolve([] as { _id: ObjectId; name: string }[]),
    ]);
    const charNameMap = new Map(nameChars.map((c) => [c._id.toString(), c.name]));
    const corpNameMap = new Map(nameCorps.map((c) => [c._id.toString(), c.name]));

    const toParty = (
      ref: PendingHistoryEmit["fromPartyRef"] | PendingHistoryEmit["toPartyRef"]
    ): ShareTradeParty | null => {
      if (!ref) return null;
      if (ref.characterId) {
        return {
          characterId: ref.characterId,
          name: charNameMap.get(ref.characterId.toString()) ?? "Unknown character",
        };
      }
      if (ref.corporationId) {
        return {
          corporationId: ref.corporationId,
          name: corpNameMap.get(ref.corporationId.toString()) ?? "Unknown corporation",
        };
      }
      return null;
    };

    for (const emit of historyEmits) {
      await recordShareTrade(db, {
        corporationId: emit.corporationId,
        kind: emit.kind,
        turn,
        shares: emit.shares,
        pricePerShareAnchor: emit.pricePerShareAnchor,
        corpCurrencyCode: emit.corpCurrencyCode,
        from: toParty(emit.fromPartyRef),
        to: toParty(emit.toPartyRef),
      });
    }
  }
}
