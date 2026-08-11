import type { Db, ObjectId } from "mongodb";
import type {
  Corporation,
  CorporateSector,
  NationalizationAuction,
  PendingNationalization,
} from "@/lib/db/types";
import type { NationalizationTrigger } from "./eligibility";
import { matchActiveNationalizationBills } from "./corpNationalizationThreat";

const CURABLE: ReadonlySet<NationalizationTrigger> = new Set(["strategic", "monopoly"]);

export interface CorpNationalizationStatus {
  hasStatus: boolean;
  pendingTaking: {
    turnsLeft: number;
    deadlineTurn: number;
    tier: string;
    method: string;
    triggers: string[];
    curableTriggers: string[];
    isSector: boolean;
  } | null;
  /** Active nationalization bills (still in voting) targeting this corp. */
  billsInVoting: {
    billId: string;
    title: string;
    whole: boolean;
    sectorCount: number;
  }[];
  isSpunOut: boolean;
  privatizedAtTurn: number | null;
  goldenSharePercent: number;
  auctionOpen: boolean;
  /** Present when an auction is open — drives the corp-profile bid CTA. */
  auction: {
    auctionId: string;
    countryId: string;
    reservePrice: number;
    currency: string;
    highestBid: number;
    bidCount: number;
    turnsLeft: number;
  } | null;
}

/** Aggregate the nationalization-relevant status of one (private) corporation. */
export async function buildCorpNationalizationStatus(
  db: Db,
  corp: Corporation,
  currentTurn: number
): Promise<CorpNationalizationStatus> {
  const sectorDocs = await db
    .collection<CorporateSector>("corporateSectors")
    .find({ corporationId: corp._id })
    .project<{ _id: ObjectId; sectorType: string }>({ _id: 1, sectorType: 1 })
    .toArray();
  const sectorIds = sectorDocs.map((s) => s._id);
  const sectorIdStr = new Set(sectorIds.map((id) => String(id)));
  const typeToSectorIds = new Map<string, ObjectId[]>();
  for (const s of sectorDocs) {
    const list = typeToSectorIds.get(s.sectorType) ?? [];
    list.push(s._id);
    typeToSectorIds.set(s.sectorType, list);
  }

  // Active nationalization bills (in voting) targeting this corp — same matcher
  // the hero "facing nationalization" chip uses, so the chip and card agree.
  const billsInVoting = (
    await matchActiveNationalizationBills(db, corp, sectorIdStr, typeToSectorIds)
  ).map((b) => ({
    billId: b.billId,
    title: b.title,
    whole: b.whole,
    sectorCount: b.sectorIds.length,
  }));

  const pending = await db
    .collection<PendingNationalization>("pendingNationalizations")
    .find({
      status: "pending",
      $or: [
        { targetCorporationId: corp._id },
        ...(sectorIds.length > 0 ? [{ targetSectorId: { $in: sectorIds } }] : []),
      ],
    })
    .toArray();
  // Soonest deadline first.
  pending.sort((a, b) => a.noticeDeadlineTurn - b.noticeDeadlineTurn);
  const p = pending[0] ?? null;

  const auction = await db
    .collection<NationalizationAuction>("nationalizationAuctions")
    .findOne({ corporationId: corp._id, status: "open" });

  const isSpunOut = corp.privatizedAtTurn != null;
  const goldenSharePercent = corp.goldenSharePercent ?? 0;
  const auctionOpen = !!auction;

  const pendingTaking = p
    ? {
        turnsLeft: Math.max(0, p.noticeDeadlineTurn - currentTurn),
        deadlineTurn: p.noticeDeadlineTurn,
        tier: p.tier,
        method: p.method,
        triggers: p.triggers,
        // Legislative takings complete regardless of the cited cause (a passed
        // bill is not curable), so they expose no curable triggers to the UI.
        curableTriggers: p.method === "legislative" ? [] : p.triggers.filter((t) => CURABLE.has(t)),
        isSector: p.targetSectorId != null,
      }
    : null;

  return {
    hasStatus:
      !!pendingTaking ||
      billsInVoting.length > 0 ||
      isSpunOut ||
      goldenSharePercent > 0 ||
      auctionOpen,
    pendingTaking,
    billsInVoting,
    isSpunOut,
    privatizedAtTurn: corp.privatizedAtTurn ?? null,
    goldenSharePercent,
    auctionOpen,
    auction: auction
      ? {
          auctionId: String(auction._id),
          countryId: auction.countryId,
          reservePrice: auction.reservePrice,
          currency: auction.reserveCurrency,
          highestBid: auction.bids.reduce((m, b) => Math.max(m, b.amount), 0),
          bidCount: auction.bids.length,
          turnsLeft: Math.max(0, auction.closesAtTurn - currentTurn),
        }
      : null,
  };
}
