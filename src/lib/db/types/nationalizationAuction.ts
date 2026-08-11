import type { ObjectId } from "mongodb";
import type { CountryId } from "../../constants/countries";
import type { CurrencyCode } from "../../constants/currencies";

/**
 * The current leading bid — the only standing escrow on the auction. Being outbid
 * refunds the prior leader, so `bids` holds at most one live entry; a raise by the
 * leader posts only the delta over their existing escrow.
 */
export interface AuctionBid {
  /** Character bidder (XOR `corporationId`). */
  characterId?: ObjectId;
  /** Corporation bidder (XOR `characterId`). */
  corporationId?: ObjectId;
  /** Bid amount in the auction (country) currency — also the escrowed amount. */
  amount: number;
  /** Currency the escrow was taken in (= the auction currency). */
  escrowCurrency: CurrencyCode;
  placedAtTurn: number;
}

/**
 * One immutable entry in the append-only bid history — every bid/raise is recorded
 * (unlike `bids`, which keeps only the current standing escrow per bidder). Array
 * order is chronological (oldest first). Display only; escrow logic uses `bids`.
 */
export interface AuctionBidHistoryEntry {
  characterId?: ObjectId;
  corporationId?: ObjectId;
  amount: number;
  placedAtTurn: number;
  placedAt: Date;
}

/**
 * A privatization auction on a spun-out corporation (spec §6.6/§13.3). The
 * `corporationId` is the carved-out new corp being auctioned (suspended + 100%
 * state-held until resolution), NOT the National Corporation.
 */
export interface NationalizationAuction {
  _id: ObjectId;
  corporationId: ObjectId;
  countryId: CountryId;
  /** Primary National Corporation holding the shares until sale (golden-share keeper). */
  primaryNationalCorporationId: ObjectId;
  openedAtTurn: number;
  closesAtTurn: number;
  /** Reserve in the auction (country) currency. */
  reservePrice: number;
  reserveCurrency: CurrencyCode;
  /** Golden-share fraction (0–1) the state retains after sale. */
  goldenSharePercent: number;
  status: "open" | "sold" | "passedIn" | "cancelled";
  bids: AuctionBid[];
  /** Append-only log of every bid/raise (display); absent on auctions opened before this existed. */
  bidHistory?: AuctionBidHistoryEntry[];
  winningBidderCharacterId?: ObjectId;
  winningBidderCorporationId?: ObjectId;
  winningAmount?: number;
  resolvedAtTurn?: number;
  createdAt: Date;
  updatedAt: Date;
}
