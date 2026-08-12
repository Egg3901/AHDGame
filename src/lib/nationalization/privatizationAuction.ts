import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type {
  AuctionBid,
  AuctionBidHistoryEntry,
  Character,
  Corporation,
  CorporateSector,
  NationalizationAuction,
  Shareholder,
} from "@/lib/db/types";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import {
  atomicallyDebitCharacterCash,
  refundCharacterCash,
  atomicallyDebitCorpLiquidCapital,
  refundCorpLiquidCapital,
} from "@/lib/financialTxLog/atomicCashGuard";
import { cleanupShareMarketActivityForCorporations } from "@/lib/corporations/cleanupShareMarketActivity";
import { releaseCorporationHeldBondsToFloat } from "@/lib/corporations/releaseHeldBondsToFloat";
import { stampSubjectDeleted } from "@/lib/financialTxLog/stampDeleted";
import { createNotification } from "@/lib/notifications";
import { logWireEvent, wireHeadlineCorpPrivatized } from "@/lib/wireEvent";
import { resolveNationalCorporationForSector } from "./nationalCorporation";
import { creditTreasuryProceeds } from "./treasury";
import { applyPrivatizationConsequences } from "./consequences/apply";
import { recordNationalizationLedger } from "./ledger";
import { notifyCountryResidents } from "./privatizationNotifications";

export interface PlaceBidParams {
  auctionId: ObjectId;
  /** The acting character (bidder, or the CEO placing a corp bid). */
  characterId: ObjectId;
  /** When set, bid on behalf of this corporation (the character must be its CEO). */
  asCorporationId?: ObjectId;
  amount: number;
  turn: number;
}

/**
 * Place or raise an escrowed bid on an open privatization auction (spec §13.3,
 * escrow-at-bid). Validates the ascending-auction rules (≥ reserve, strictly above
 * the current high), debits the new amount from the bidder (personal cash or corp
 * liquidCapital) atomically, then refunds the bidder's prior standing bid. One live
 * escrow per bidder. Throws on any rejection (the route maps it to a 400).
 */
export async function placeAuctionBid(db: Db, params: PlaceBidParams): Promise<void> {
  const auctions = db.collection<NationalizationAuction>("nationalizationAuctions");
  const auction = await auctions.findOne({ _id: params.auctionId });
  if (!auction || auction.status !== "open") throw new Error("Auction is not open");
  if (params.turn > auction.closesAtTurn) throw new Error("Auction has closed");

  // Residency gate (spec §13.3): only residents of the auction's country may bid.
  // The acting character must be a resident — this covers personal bids and
  // CEO-on-behalf corp bids alike (the corp currency match is checked below).
  const actor = await db.collection<Character>("characters").findOne({ _id: params.characterId });
  if (!actor || actor.countryId !== auction.countryId) {
    throw new Error(`Only residents of ${auction.countryId} may bid on this auction.`);
  }

  const amount = Math.round(params.amount);
  if (amount < auction.reservePrice) throw new Error("Bid is below the reserve price");
  const highest = auction.bids.reduce((m, b) => Math.max(m, b.amount), 0);
  if (amount <= highest) throw new Error("Bid must exceed the current highest bid");

  const currency = auction.reserveCurrency;
  const forexEnabled = await isForexEnabled();
  const isCorp = params.asCorporationId != null;

  if (isCorp) {
    const corp = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: params.asCorporationId });
    if (!corp) throw new Error("Bidding corporation not found");
    if (corp.ceoVacant || corp.ceoId?.toString() !== params.characterId.toString()) {
      throw new Error("Only the CEO may bid on behalf of a corporation");
    }
    if ((corp.liquidCurrencyCode ?? "USD") !== currency) {
      throw new Error("Corporation currency does not match the auction currency");
    }
  }

  const isMine = (b: AuctionBid): boolean =>
    isCorp
      ? b.corporationId?.toString() === params.asCorporationId!.toString()
      : b.characterId?.toString() === params.characterId.toString();

  // Only the LEADING bid stays escrowed (spec §13.3): being outbid returns your
  // escrow immediately, so at most one bidder has money on the table. The bidder
  // posts only the *added* commitment — the full amount for a new bidder, or just
  // the delta over their own standing escrow when the current leader raises — so a
  // raise never requires re-funding money the bidder already has in escrow.
  const myPrior = auction.bids.filter(isMine).reduce((sum, b) => sum + b.amount, 0);
  const outbid = auction.bids.filter((b) => !isMine(b));
  const additional = amount - myPrior;

  // Debit the added commitment FIRST (atomic, gated). If it fails the bid is
  // rejected and every standing escrow is left untouched.
  const refundSelf = async (): Promise<void> => {
    if (isCorp) await refundCorpLiquidCapital(db, params.asCorporationId!, additional);
    else await refundCharacterCash(db, params.characterId, currency, additional, forexEnabled);
  };
  if (isCorp) {
    const r = await atomicallyDebitCorpLiquidCapital(db, params.asCorporationId!, additional);
    if (!r.ok) throw new Error(r.error);
  } else {
    const r = await atomicallyDebitCharacterCash(
      db,
      params.characterId,
      currency,
      additional,
      forexEnabled
    );
    if (!r.ok) throw new Error(r.error);
  }

  const newBid: AuctionBid = {
    ...(isCorp ? { corporationId: params.asCorporationId } : { characterId: params.characterId }),
    amount,
    escrowCurrency: currency,
    placedAtTurn: params.turn,
  };
  const now = new Date();
  // Append-only history records every bid/raise (the `bids` array only keeps the
  // current leading escrow); display-only, escrow logic uses `bids`.
  const historyEntry: AuctionBidHistoryEntry = {
    ...(isCorp ? { corporationId: params.asCorporationId } : { characterId: params.characterId }),
    amount,
    placedAtTurn: params.turn,
    placedAt: now,
  };
  // Only the new leader holds escrow now.
  const baseSet = { bids: [newBid], updatedAt: now };

  // Claim leadership ATOMICALLY, gated on the exact `bids` array our refund and
  // leadership decision was computed against. Two concurrent bids both read the
  // same snapshot; without this guard both would $set `bids:[newBid]` (the later
  // write clobbering the earlier bidder's escrow record — that debited cash is
  // then never returned at resolution = burn) and both would refund the displaced
  // leader below (= mint). The array-equality filter lets exactly one writer flip
  // the standing bids; a racer that read a now-stale snapshot misses, so we roll
  // back our own debit and reject. Only the winner reaches the outbid refunds.
  const claimFilter = { _id: auction._id, status: "open" as const, bids: auction.bids };
  let claim;
  if (auction.bidHistory) {
    claim = await auctions.updateOne(claimFilter, {
      $set: baseSet,
      $push: { bidHistory: historyEntry },
    });
  } else {
    // First append on an auction opened before the history log existed: seed it
    // from the current standing bids so no prior bid is lost, then add this one.
    const seeded: AuctionBidHistoryEntry[] = auction.bids.map((b) => ({
      ...(b.corporationId ? { corporationId: b.corporationId } : { characterId: b.characterId }),
      amount: b.amount,
      placedAtTurn: b.placedAtTurn,
      placedAt: now,
    }));
    claim = await auctions.updateOne(claimFilter, {
      $set: { ...baseSet, bidHistory: [...seeded, historyEntry] },
    });
  }
  if (claim.modifiedCount === 0) {
    // Lost the race (or the auction just closed): undo our debit, return nobody
    // else's escrow, and let the caller retry against the new standing bid.
    await refundSelf();
    throw new Error("Another bid landed first. Please try again.");
  }

  // We won the leadership transition → release every displaced escrow, exactly
  // once (only the writer that flipped `bids` reaches here). Uses each bid's
  // stored escrowCurrency so a refund can't drift from how it was taken.
  for (const o of outbid) {
    if (o.corporationId) await refundCorpLiquidCapital(db, o.corporationId, o.amount);
    else if (o.characterId)
      await refundCharacterCash(db, o.characterId, o.escrowCurrency, o.amount, forexEnabled);
  }
}

/**
 * Reverse an unsold carve-out (spec §13.3 pass-in): move the shell's sectors back
 * into the country's National Corporation(s) (routed per type, re-stamping
 * `absorbedAtTurn` so the re-privatization cooldown reattaches), move any residual
 * `liquidCapital` to the primary NatCorp, then dissolve the empty shell. No
 * shareholder payout — the shell is wholly state-held and bidders are escrow-only
 * (refunded separately by the resolver).
 */
export async function reabsorbSpunOutCorp(
  db: Db,
  shell: Corporation,
  primaryNationalCorporationId: ObjectId,
  turn: number
): Promise<void> {
  const now = new Date();
  const sectors = db.collection<CorporateSector>("corporateSectors");
  const shellSectors = await sectors.find({ corporationId: shell._id }).toArray();

  // Route each sector back to the NatCorp that owns its type.
  const destByType = new Map<string, ObjectId>();
  for (const s of shellSectors) {
    if (!destByType.has(s.sectorType)) {
      const dest = await resolveNationalCorporationForSector(db, shell.countryId, s.sectorType);
      destByType.set(s.sectorType, dest._id);
    }
  }
  const idsByDest = new Map<string, ObjectId[]>();
  for (const s of shellSectors) {
    const key = destByType.get(s.sectorType)!.toString();
    idsByDest.set(key, [...(idsByDest.get(key) ?? []), s._id]);
  }
  for (const [destKey, ids] of idsByDest) {
    await sectors.updateMany(
      { _id: { $in: ids } },
      { $set: { corporationId: new ObjectId(destKey), absorbedAtTurn: turn, updatedAt: now } }
    );
  }

  // Residual cash → the primary NatCorp (money conservation).
  if ((shell.liquidCapital ?? 0) > 0) {
    await db
      .collection<Corporation>("corporations")
      .updateOne(
        { _id: primaryNationalCorporationId },
        { $inc: { liquidCapital: shell.liquidCapital }, $set: { updatedAt: now } }
      );
  }

  // Dissolve the empty shell (no payout).
  const forexEnabled = await isForexEnabled();
  await cleanupShareMarketActivityForCorporations(db, [shell._id], now, forexEnabled);
  // Return any corporate bonds the shell held as a creditor to issuer float so
  // no surviving issuer is left with a holder entry pointing at the deleted shell.
  await releaseCorporationHeldBondsToFloat(db, shell._id, now);
  await stampSubjectDeleted(db, shell._id, { sequentialId: shell.sequentialId, deletedAt: now });
  await db.collection<Corporation>("corporations").deleteOne({ _id: shell._id });
}

/**
 * Resolve one due auction (spec §13.3). An atomic status claim (`open` → terminal)
 * prevents double settlement. **Sold** (highest bid ≥ reserve): refund losers,
 * credit the treasury the winning amount (the winner's escrow already left the
 * bidder), transfer the non-golden share block to the winner (character → CEO;
 * corporation → controlling shareholder), un-suspend, stamp `privatizedAtTurn`.
 * **Passed-in** (no qualifying bid): refund all bids and re-absorb the carve-out.
 */
export async function resolveNationalizationAuction(
  db: Db,
  auction: NationalizationAuction,
  turn: number
): Promise<"sold" | "passedIn"> {
  const auctions = db.collection<NationalizationAuction>("nationalizationAuctions");
  const corps = db.collection<Corporation>("corporations");
  const now = new Date();
  const forexEnabled = await isForexEnabled();

  const winner =
    [...auction.bids]
      .sort((a, b) => b.amount - a.amount)
      .find((b) => b.amount >= auction.reservePrice) ?? null;
  const finalStatus: "sold" | "passedIn" = winner ? "sold" : "passedIn";

  // Atomic claim — only the resolver that flips open→terminal runs the effects.
  const claim = await auctions.updateOne(
    { _id: auction._id, status: "open" },
    {
      $set: {
        status: finalStatus,
        resolvedAtTurn: turn,
        updatedAt: now,
        ...(winner
          ? {
              winningAmount: winner.amount,
              ...(winner.characterId ? { winningBidderCharacterId: winner.characterId } : {}),
              ...(winner.corporationId ? { winningBidderCorporationId: winner.corporationId } : {}),
            }
          : {}),
      },
    }
  );
  if (claim.matchedCount === 0) return finalStatus; // a concurrent sweep already settled it

  const refund = async (b: AuctionBid): Promise<void> => {
    if (b.corporationId) await refundCorpLiquidCapital(db, b.corporationId, b.amount);
    else if (b.characterId)
      await refundCharacterCash(db, b.characterId, b.escrowCurrency, b.amount, forexEnabled);
  };

  const shell = await corps.findOne({ _id: auction.corporationId });

  if (!winner || !shell) {
    // Pass-in (or the shell vanished): refund everyone; re-absorb if it still exists.
    for (const b of auction.bids) await refund(b);
    if (shell) {
      await reabsorbSpunOutCorp(db, shell, auction.primaryNationalCorporationId, turn);
      await notifyCountryResidents(db, auction.countryId, {
        type: "corp_privatization_resolved",
        title: "Auction passed in",
        message: `${shell.name} did not sell at auction — it returned to state ownership.`,
        metadata: { href: `/country/${auction.countryId.toLowerCase()}/nationalization` },
      });
    }
    return "passedIn";
  }

  // ── Sold: refund losers, credit the treasury, transfer ownership. ──
  const isWinningBid = (b: AuctionBid): boolean =>
    (winner.characterId != null && b.characterId?.toString() === winner.characterId.toString()) ||
    (winner.corporationId != null &&
      b.corporationId?.toString() === winner.corporationId.toString());
  for (const b of auction.bids) {
    if (!isWinningBid(b)) await refund(b);
  }

  // The winner's escrow already left the bidder → credit the treasury that amount.
  await creditTreasuryProceeds(db, auction.countryId, winner.amount, now);

  // Transfer the non-golden block from the state to the winner.
  const goldenShares = Math.round(shell.totalShares * auction.goldenSharePercent);
  const saleBlock = shell.totalShares - goldenShares;
  const winnerEntry: Shareholder = winner.corporationId
    ? { corporationId: winner.corporationId, shares: saleBlock }
    : { characterId: winner.characterId!, shares: saleBlock };
  const shareholders: Shareholder[] = [
    ...(goldenShares > 0
      ? [{ corporationId: auction.primaryNationalCorporationId, shares: goldenShares }]
      : []),
    winnerEntry,
  ];

  let ceoFields: Partial<Corporation> = { ceoVacant: true };
  let winnerUserId: ObjectId | undefined;
  // HQ relocates to the buyer's home region on sale (spec §13.3): a character
  // winner → their homeState; a corporation winner → the buying corp's HQ. Both
  // are guaranteed in-country by the residency gate. Falls back to the shell's
  // existing HQ when the buyer's region is somehow absent (data-safe).
  let hqState: string | undefined;
  if (winner.characterId) {
    const winnerChar = await db
      .collection<Character>("characters")
      .findOne({ _id: winner.characterId });
    winnerUserId = winnerChar?.userId;
    hqState = winnerChar?.homeState;
    // `ceoType` is stamped, not inherited: a state shell may carry ceoType:"npp"
    // (privatizeAsset sets it for NPP-run assets), and corporationDetail resolves
    // the CEO from the collection that field names — a stale "npp" would render
    // the newly-sold corp as "CEO Vacant" despite a live character in `ceoId`.
    ceoFields = {
      ceoId: winner.characterId,
      ceoType: "character",
      ceoVacant: false,
      ...(winnerChar?.userId ? { userId: winnerChar.userId } : {}),
    };
  } else if (winner.corporationId) {
    const buyer = await corps.findOne({ _id: winner.corporationId });
    hqState = buyer?.headquartersState;
  }

  await corps.updateOne(
    { _id: shell._id },
    {
      $set: {
        shareholders,
        suspended: false,
        hiddenFromExchange: false,
        isPrivate: true,
        privatizedAtTurn: turn,
        ...ceoFields,
        ...(hqState ? { headquartersState: hqState } : {}),
        updatedAt: now,
      },
    }
  );

  // Privatization politics (spec §12.1) — the auction completes (privatizes) at sale.
  const consequence = await applyPrivatizationConsequences(db, {
    countryId: auction.countryId,
    turn,
  });

  // Public State Ownership Register row (best-effort — never abort the sale).
  try {
    const soldSectors = await db
      .collection<CorporateSector>("corporateSectors")
      .find({ corporationId: shell._id }, { projection: { sectorType: 1 } })
      .toArray();
    await recordNationalizationLedger(db, {
      countryId: auction.countryId,
      nationalCorporationId: auction.primaryNationalCorporationId,
      kind: "privatize_auction",
      triggers: [],
      valuationAnchor: 0, // proceeds settle in local currency; no ₳ value recorded
      compensationAnchor: 0,
      sectorTypes: [...new Set(soldSectors.map((s) => s.sectorType))],
      newCorpName: shell.name,
      foreignOwnerCountryId: null,
      confidenceBefore: consequence?.confidenceBefore,
      confidenceAfter: consequence?.confidenceAfter,
      legitimacyDelta: consequence?.legitimacyDelta,
      turn,
    });
  } catch (err) {
    console.error("[nationalizationLedger] auction privatization ledger write failed:", err);
  }

  logWireEvent("corporation_privatized", wireHeadlineCorpPrivatized(shell.name), {
    href: `/corporation/${shell.sequentialId ?? shell._id}`,
  });
  // Tell the country's residents the auction settled.
  await notifyCountryResidents(db, auction.countryId, {
    type: "corp_privatization_resolved",
    title: "Auction sold",
    message: `${shell.name} was sold at auction and is now privately held.`,
    metadata: { href: `/corporation/${shell.sequentialId ?? shell._id}` },
  });
  if (winnerUserId) {
    await createNotification({
      userId: winnerUserId,
      type: "ceo_vote_offer",
      title: "Auction won",
      message: `You won the privatization auction for ${shell.name}.`,
      metadata: { corporationId: shell._id.toString(), corporationName: shell.name },
    });
  }
  return "sold";
}

/** Corp-turn sweep: resolve every due auction with per-item error isolation. */
export async function processNationalizationAuctions(
  db: Db,
  currentTurn: number
): Promise<{ sold: number; passedIn: number }> {
  const due = await db
    .collection<NationalizationAuction>("nationalizationAuctions")
    .find({ status: "open", closesAtTurn: { $lte: currentTurn } })
    .toArray();
  let sold = 0;
  let passedIn = 0;
  for (const auction of due) {
    try {
      const r = await resolveNationalizationAuction(db, auction, currentTurn);
      if (r === "sold") sold++;
      else passedIn++;
    } catch (err) {
      console.error(
        `[nationalizationAuction] failed to resolve ${auction._id.toString()}:`,
        err instanceof Error ? err.message : err
      );
    }
  }
  return { sold, passedIn };
}
