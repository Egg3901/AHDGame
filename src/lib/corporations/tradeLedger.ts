/**
 * Per-holder realized P&L over the share-trade audit trail (suggestion #38).
 *
 * `shareTradeHistory` already records every share movement, but only ever as a
 * per-corporation public tape (`/api/corporations/[id]/shares/history`). There
 * was no way for a player to see THEIR OWN trades, and no cost basis anywhere:
 * `shareholders[].avgCostPerShare` describes the position you still hold, which
 * says nothing about what you made on the ones you already sold.
 *
 * This module is pure. It takes one holder's rows for ONE corporation in
 * chronological order and walks them through a FIFO lot tracker, so a sale is
 * matched against the oldest shares still open — the same convention a
 * brokerage statement uses by default.
 *
 * Splits are the trap. A `stock_split` / `reverse_split` row moves no shares
 * between holders but rescales everyone's count, so open lots have to be
 * rescaled with it or every basis computed across a split is wrong by the split
 * ratio. Those rows are matched on `structureChange`, not on `from`/`to`.
 */

import type { ObjectId } from "mongodb";
import type { ShareTradeHistory } from "@/lib/db/types/shareTradeHistory";

/** Who we are computing P&L for. Exactly one of these is set. */
export interface LedgerViewer {
  characterId?: ObjectId | string;
  corporationId?: ObjectId | string;
}

/** An open FIFO lot: shares acquired at a given ₳ cost per share. */
interface OpenLot {
  shares: number;
  costPerShareAnchor: number;
}

/** One row of the viewer's own trade history, annotated with realized P&L. */
export interface LedgerEntry {
  tradeId: string;
  corporationId: string;
  kind: ShareTradeHistory["kind"];
  turn: number;
  createdAt: Date;
  /** "buy" when the viewer received shares, "sell" when they released them. */
  side: "buy" | "sell";
  shares: number;
  pricePerShareAnchor: number;
  totalAnchor: number;
  /** Counterparty display name; "Public float" when the float was the other side. */
  counterparty: string;
  /**
   * ₳ realized on a sale: shares × (sale price − FIFO cost of the lots
   * consumed). Null on a buy, and null on a sale with no matching open lot
   * (a position that predates the audit trail) — reported as unknown rather
   * than silently booked as 100% profit.
   */
  realizedPnlAnchor: number | null;
  /** Weighted FIFO cost of the shares sold. Null whenever P&L is null. */
  costBasisAnchor: number | null;
}

export interface LedgerResult {
  entries: LedgerEntry[];
  /** Σ realized P&L over entries with a known basis, in ₳. */
  totalRealizedPnlAnchor: number;
  /** Shares still open at the end of the walk. */
  openShares: number;
  /** Weighted ₳ cost per share of the still-open position, null when flat. */
  openCostPerShareAnchor: number | null;
  /**
   * True when at least one sale could not be fully matched to an open lot, so
   * `totalRealizedPnlAnchor` understates activity. Surfaced so the UI can say
   * "partial history" instead of quoting a confident wrong number.
   */
  hasUnmatchedSales: boolean;
}

const idOf = (v: ObjectId | string | undefined): string | null =>
  v == null ? null : typeof v === "string" ? v : v.toString();

/** Does this trade party refer to the viewer? */
function isViewer(
  party: ShareTradeHistory["from"] | ShareTradeHistory["to"],
  viewer: LedgerViewer
): boolean {
  if (!party) return false;
  const charId = idOf(viewer.characterId);
  const corpId = idOf(viewer.corporationId);
  if (charId && party.characterId?.toString() === charId) return true;
  if (charId && party.imperialCharacterId?.toString() === charId) return true;
  if (corpId && party.corporationId?.toString() === corpId) return true;
  return false;
}

function partyName(party: ShareTradeHistory["from"] | ShareTradeHistory["to"]): string {
  return party?.name ?? "Public float";
}

/**
 * Split ratio for a structure-change row: how many new shares each old share
 * became. Returns null when the row is not a usable split.
 */
function splitRatio(trade: ShareTradeHistory): number | null {
  const meta = trade.structureChange;
  if (!meta) return null;
  const { oldTotalShares, newTotalShares } = meta;
  if (!Number.isFinite(oldTotalShares) || !Number.isFinite(newTotalShares)) return null;
  if (oldTotalShares <= 0 || newTotalShares <= 0) return null;
  return newTotalShares / oldTotalShares;
}

/**
 * Walk one holder's rows for ONE corporation and annotate each with realized
 * P&L. `trades` MUST be chronological (turn, then createdAt) — FIFO is
 * order-dependent and this function does not re-sort, so the caller's query
 * sort is load-bearing.
 */
export function computeRealizedPnl(
  trades: ShareTradeHistory[],
  viewer: LedgerViewer
): LedgerResult {
  const lots: OpenLot[] = [];
  const entries: LedgerEntry[] = [];
  let totalRealizedPnlAnchor = 0;
  let hasUnmatchedSales = false;

  for (const trade of trades) {
    // Splits rescale every open lot and are not themselves a buy or a sell.
    // Applied before the side check so a split row never falls through to it.
    const ratio = splitRatio(trade);
    if (ratio != null && (trade.kind === "stock_split" || trade.kind === "reverse_split")) {
      for (const lot of lots) {
        lot.shares *= ratio;
        lot.costPerShareAnchor /= ratio;
      }
      continue;
    }

    const received = isViewer(trade.to, viewer);
    const released = isViewer(trade.from, viewer);
    // Not the viewer's row, or an internal move where they are both sides
    // (nothing is realized by selling to yourself).
    if (received === released) continue;

    const shares = Number.isFinite(trade.shares) ? Math.max(0, trade.shares) : 0;
    if (shares === 0) continue;
    const price = Number.isFinite(trade.pricePerShareAnchor) ? trade.pricePerShareAnchor : 0;

    if (received) {
      lots.push({ shares, costPerShareAnchor: price });
      entries.push({
        tradeId: trade._id.toString(),
        corporationId: trade.corporationId.toString(),
        kind: trade.kind,
        turn: trade.turn,
        createdAt: trade.createdAt,
        side: "buy",
        shares,
        pricePerShareAnchor: price,
        totalAnchor: trade.totalAnchor,
        counterparty: partyName(trade.from),
        realizedPnlAnchor: null,
        costBasisAnchor: null,
      });
      continue;
    }

    // Sale: consume the oldest open lots first.
    let remaining = shares;
    let basis = 0;
    let matched = 0;
    while (remaining > 0 && lots.length > 0) {
      const lot = lots[0];
      const take = Math.min(lot.shares, remaining);
      basis += take * lot.costPerShareAnchor;
      matched += take;
      lot.shares -= take;
      remaining -= take;
      if (lot.shares <= 1e-9) lots.shift();
    }

    // A sale with no open lot at all means the position predates the audit
    // trail. Booking that as pure profit would invent money, so it is reported
    // as unknown instead.
    const fullyMatched = matched >= shares - 1e-9;
    if (!fullyMatched) hasUnmatchedSales = true;
    const realized = matched > 0 && fullyMatched ? round2(shares * price - basis) : null;
    if (realized != null) totalRealizedPnlAnchor += realized;

    entries.push({
      tradeId: trade._id.toString(),
      corporationId: trade.corporationId.toString(),
      kind: trade.kind,
      turn: trade.turn,
      createdAt: trade.createdAt,
      side: "sell",
      shares,
      pricePerShareAnchor: price,
      totalAnchor: trade.totalAnchor,
      counterparty: partyName(trade.to),
      realizedPnlAnchor: realized,
      costBasisAnchor: realized != null ? round2(basis) : null,
    });
  }

  const openShares = lots.reduce((sum, l) => sum + l.shares, 0);
  const openCost = lots.reduce((sum, l) => sum + l.shares * l.costPerShareAnchor, 0);

  return {
    entries,
    totalRealizedPnlAnchor: round2(totalRealizedPnlAnchor),
    openShares: round2(openShares),
    openCostPerShareAnchor: openShares > 1e-9 ? round2(openCost / openShares) : null,
    hasUnmatchedSales,
  };
}

/**
 * Group rows by corporation, run the FIFO walk per corporation, then merge.
 * FIFO only makes sense within one security, so this is the entry point every
 * caller with a mixed-corp result set should use.
 */
export function computeRealizedPnlByCorporation(
  trades: ShareTradeHistory[],
  viewer: LedgerViewer
): LedgerResult & { byCorporation: Map<string, LedgerResult> } {
  const grouped = new Map<string, ShareTradeHistory[]>();
  for (const t of trades) {
    const key = t.corporationId.toString();
    const bucket = grouped.get(key);
    if (bucket) bucket.push(t);
    else grouped.set(key, [t]);
  }

  const byCorporation = new Map<string, LedgerResult>();
  const entries: LedgerEntry[] = [];
  let totalRealizedPnlAnchor = 0;
  let hasUnmatchedSales = false;
  for (const [corpId, rows] of grouped) {
    const result = computeRealizedPnl(rows, viewer);
    byCorporation.set(corpId, result);
    entries.push(...result.entries);
    totalRealizedPnlAnchor += result.totalRealizedPnlAnchor;
    hasUnmatchedSales ||= result.hasUnmatchedSales;
  }

  // Newest first for display; the per-corp walks each ran chronologically.
  entries.sort((a, b) => b.turn - a.turn || b.createdAt.getTime() - a.createdAt.getTime());

  return {
    entries,
    totalRealizedPnlAnchor: round2(totalRealizedPnlAnchor),
    // Open position is per-security and does not aggregate meaningfully.
    openShares: 0,
    openCostPerShareAnchor: null,
    hasUnmatchedSales,
    byCorporation,
  };
}

function round2(v: number): number {
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}
