import type { Db, ObjectId } from "mongodb";
import type { ShareTradeHistory, ShareTradeParty } from "@/lib/db/types/shareTradeHistory";

/**
 * Wash-trade guard for the order-flow price signal.
 *
 * The 5-minute price cron turns windowed buy/sell notionals into a bounded
 * price multiplier (orderFlowEngine). A round trip — the same actor buying and
 * selling the same corp's shares within the window — carries no honest
 * order-flow information, but by timing the legs across cron resets an actor
 * could register a large one-sided notional in each window and hold the
 * multiplier pinned (2026-08-20 incident: a $10.6bn buy+sell round trip within
 * 10 seconds at identical price). The suspectScan analytics already flag these
 * (wash_trade / same_price_wash) but nothing enforced at accumulation time.
 *
 * Enforcement: when the incoming trade's actor has an OPPOSITE-side trade on
 * the same corp inside the window, the incoming leg is excluded from its own
 * window and its notional is instead SUBTRACTED from the opposite window,
 * neutralizing the earlier leg regardless of leg order. Price is deliberately
 * not compared: a fast round trip is signal-free at any price, and a same-price
 * check invites trivial 1.01x evasion. Window values are floored at zero when
 * read (orderFlowEngine), so the subtraction can never punish third parties.
 */
export const ORDER_FLOW_WASH_WINDOW_MS = 10 * 60 * 1000;

/** Prior-trade kinds that represent an actor actually taking/leaving a position. */
const WASH_RELEVANT_KINDS: ShareTradeHistory["kind"][] = [
  "market_buy",
  "market_sell",
  "limit_fill",
  "peer_fill",
];

export interface OrderFlowActor {
  characterId?: ObjectId;
  imperialCharacterId?: ObjectId;
  corporationId?: ObjectId;
}

function partyMatchesActor(party: ShareTradeParty | null, actor: OrderFlowActor): boolean {
  if (!party) return false;
  if (actor.characterId && party.characterId) {
    return party.characterId.toString() === actor.characterId.toString();
  }
  if (actor.imperialCharacterId && party.imperialCharacterId) {
    return party.imperialCharacterId.toString() === actor.imperialCharacterId.toString();
  }
  if (actor.corporationId && party.corporationId) {
    return party.corporationId.toString() === actor.corporationId.toString();
  }
  return false;
}

/**
 * Pure matcher: does `trade` represent the OPPOSITE side of `side` executed by
 * `actor` within `windowMs` of `now`? Buys record the actor in `to`, sells in
 * `from` (see recordShareTrade call sites), and limit/peer fills record both
 * parties, so checking the correct slot per side covers every kind.
 */
export function isOppositeSideTradeByActor(
  trade: Pick<ShareTradeHistory, "kind" | "from" | "to" | "createdAt">,
  actor: OrderFlowActor,
  side: "buy" | "sell",
  now: Date,
  windowMs: number = ORDER_FLOW_WASH_WINDOW_MS
): boolean {
  if (!WASH_RELEVANT_KINDS.includes(trade.kind)) return false;
  if (now.getTime() - trade.createdAt.getTime() > windowMs) return false;
  // Current side "sell" means the wash pair is a recent BUY by this actor
  // (actor appears as `to` on the prior row), and vice versa.
  return side === "sell"
    ? partyMatchesActor(trade.to, actor)
    : partyMatchesActor(trade.from, actor);
}

/**
 * True when the actor executed an opposite-side trade on this corp inside the
 * wash window. Best-effort read of the immutable trade audit trail; a lookup
 * failure returns false (accumulate normally) rather than blocking the trade.
 */
export async function isOrderFlowWashRoundTrip(
  db: Db,
  corporationId: ObjectId,
  actor: OrderFlowActor,
  side: "buy" | "sell",
  now: Date = new Date()
): Promise<boolean> {
  try {
    const recent = await db
      .collection<ShareTradeHistory>("shareTradeHistory")
      .find(
        {
          corporationId,
          kind: { $in: WASH_RELEVANT_KINDS },
          createdAt: { $gte: new Date(now.getTime() - ORDER_FLOW_WASH_WINDOW_MS) },
        },
        { projection: { kind: 1, from: 1, to: 1, createdAt: 1 }, limit: 100 }
      )
      .toArray();
    return recent.some((t) => isOppositeSideTradeByActor(t, actor, side, now));
  } catch {
    return false;
  }
}

/**
 * Builds the order-flow window $inc fragment for one trade leg.
 *
 * Normal leg: accumulate `notional` into the side's own window. Wash leg:
 * contribute nothing to the own window and subtract the notional from the
 * OPPOSITE window to neutralize the earlier leg of the round trip. Returns the
 * empty object when order-flow accumulation is not eligible for this corp.
 */
export function buildOrderFlowWindowInc(
  eligible: boolean,
  side: "buy" | "sell",
  notional: number,
  washExcluded: boolean
): Partial<Record<"orderFlowWindowBuyValue" | "orderFlowWindowSellValue", number>> {
  if (!eligible || !(notional > 0)) return {};
  const own = side === "buy" ? "orderFlowWindowBuyValue" : "orderFlowWindowSellValue";
  const opposite = side === "buy" ? "orderFlowWindowSellValue" : "orderFlowWindowBuyValue";
  return washExcluded ? { [opposite]: -notional } : { [own]: notional };
}

/** Exact reversal of {@link buildOrderFlowWindowInc} for rollback paths. */
export function buildOrderFlowWindowIncReversal(
  eligible: boolean,
  side: "buy" | "sell",
  notional: number,
  washExcluded: boolean
): Partial<Record<"orderFlowWindowBuyValue" | "orderFlowWindowSellValue", number>> {
  const inc = buildOrderFlowWindowInc(eligible, side, notional, washExcluded);
  const out: Partial<Record<"orderFlowWindowBuyValue" | "orderFlowWindowSellValue", number>> = {};
  for (const [k, v] of Object.entries(inc)) {
    out[k as "orderFlowWindowBuyValue" | "orderFlowWindowSellValue"] = -v;
  }
  return out;
}
