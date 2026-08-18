import type { Db, ObjectId } from "mongodb";
import type { Corporation, ShareTradeHistory, ShareTradeKind, ShareOrder } from "@/lib/db/types";
import type { ShareOffer } from "@/lib/db/types/shareListings";
import {
  CEO_SELF_ACQUISITION_CAP_FRACTION,
  CEO_SELF_ACQUISITION_WINDOW_TURNS,
} from "@/lib/constants/corporations";

export type CeoHolderField = "characterId" | "imperialCharacterId";

/** Acquisition kinds that count toward the CEO self-acquisition window. */
const COUNTED_KINDS: ShareTradeKind[] = ["market_buy", "limit_fill", "peer_fill", "listing_fill"];

export interface CeoSelfAcquisitionWindow {
  acquiredShares: number;
  capShares: number;
  remainingShares: number;
  /** Smallest turn among counted rows, or null when none. */
  oldestInWindowTurn: number | null;
  /** Turns until the oldest counted purchase ages out (0 when none/aged). */
  freesUpInTurns: number;
}

/**
 * Shares the CEO has acquired (float + other-character buys) in the trailing
 * window, read from the immutable shareTradeHistory ledger. Pure read.
 */
export async function ceoSelfAcquisitionWindow(
  db: Db,
  corp: Pick<Corporation, "_id" | "totalShares">,
  ceoId: ObjectId,
  holderField: CeoHolderField,
  currentTurn: number
): Promise<CeoSelfAcquisitionWindow> {
  const windowStart = currentTurn - CEO_SELF_ACQUISITION_WINDOW_TURNS;
  const rows = await db
    .collection<ShareTradeHistory>("shareTradeHistory")
    .find({
      corporationId: corp._id,
      [`to.${holderField}`]: ceoId,
      kind: { $in: COUNTED_KINDS },
      turn: { $gte: windowStart },
    })
    .toArray();

  let acquiredShares = 0;
  let oldestInWindowTurn: number | null = null;
  for (const r of rows) {
    acquiredShares += r.shares ?? 0;
    if (oldestInWindowTurn === null || r.turn < oldestInWindowTurn) oldestInWindowTurn = r.turn;
  }

  const capShares = Math.floor(CEO_SELF_ACQUISITION_CAP_FRACTION * (corp.totalShares ?? 0));
  const remainingShares = Math.max(0, capShares - acquiredShares);
  const freesUpInTurns =
    oldestInWindowTurn === null
      ? 0
      : Math.max(0, oldestInWindowTurn + CEO_SELF_ACQUISITION_WINDOW_TURNS - currentTurn);

  return { acquiredShares, capShares, remainingShares, oldestInWindowTurn, freesUpInTurns };
}

export interface CapRejection {
  error: string;
  status: 400;
}

/**
 * Reject a CEO self-acquisition that would push their trailing-window total
 * (filled + open buy orders + open buy offers) over CAP_FRACTION × totalShares.
 * Returns null when allowed, or when the buyer is not this corp's sitting CEO.
 */
export async function assertCeoAcquisitionWithinCap(
  db: Db,
  corp: Pick<Corporation, "_id" | "name" | "totalShares" | "ceoId" | "ceoVacant" | "isPrivate">,
  buyerId: ObjectId,
  holderField: CeoHolderField,
  requestedShares: number,
  currentTurn: number
): Promise<CapRejection | null> {
  // Scope: only the corp's own sitting CEO is capped. Private corps have no
  // public float to pump; the cap exists to throttle public-market self-dealing,
  // and would otherwise block a friendly transfer of a private subsidiary.
  if (!corp.ceoId || corp.ceoVacant === true || !corp.ceoId.equals(buyerId)) return null;
  if (corp.isPrivate === true) return null;

  const window = await ceoSelfAcquisitionWindow(db, corp, buyerId, holderField, currentTurn);

  const openOrders = await db
    .collection<ShareOrder>("shareOrders")
    .find({ corporationId: corp._id, characterId: buyerId, type: "buy", status: "open" })
    .toArray();
  const openOrderShares = openOrders.reduce((s, o) => s + (o.sharesRemaining ?? 0), 0);

  const openOffers = await db
    .collection<ShareOffer>("shareOffers")
    .find({ corporationId: corp._id, buyerCharacterId: buyerId, status: "pending" })
    .toArray();
  const openOfferShares = openOffers.reduce((s, o) => s + (o.shares ?? 0), 0);

  const committed = window.acquiredShares + openOrderShares + openOfferShares;
  if (committed + requestedShares <= window.capShares) return null;

  const total = corp.totalShares || 1;
  const usedPct = ((committed / total) * 100).toFixed(1);
  const remainingPct = (Math.max(0, window.capShares - committed) / total) * 100;
  const availClause = remainingPct > 0 ? ` ${remainingPct.toFixed(1)}% available now,` : "";
  const freesClause =
    window.freesUpInTurns > 0 ? ` full capacity in ${window.freesUpInTurns} turns.` : "";
  return {
    status: 400,
    error:
      `As CEO you may acquire at most 10% of ${corp.name}'s shares per 120 turns. ` +
      `You've used ${usedPct}%.${availClause}${freesClause}`.trim(),
  };
}
