import type { Db, ObjectId } from "mongodb";
import type {
  Character,
  Corporation,
  CorporateSector,
  NationalizationAuction,
} from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CorporationType } from "@/lib/constants/corporations";

/**
 * Enriched, display-ready view of one open privatization auction (spec §13.3).
 * Built once by {@link buildAuctionListings} and consumed identically by every
 * surface (the nationalization bid page, the Stock Market Auctions tab, the corp
 * profile) so the asset detail can never drift between them.
 */
export interface AuctionListing {
  auctionId: string;
  /** ObjectId string of the shell corp — the bid route keys off this. */
  corporationId: string;
  /** Sequential id for the corp profile link. */
  corpSequentialId: number;
  corpName: string;
  countryId: CountryId;
  leadSectorType: CorporationType;
  sectors: {
    sectorType: CorporationType;
    stateId: string;
    stateName: string;
    revenuePerTurn: number;
  }[];
  /** Sum of the carved sectors' revenue, in the corp's local currency. */
  totalRevenuePerTurn: number;
  hqStateId: string;
  hqStateName: string;
  /** Carve valuation = sharePrice × totalShares, local currency. */
  valuationLocal: number;
  reservePrice: number;
  currency: CurrencyCode;
  highestBid: number;
  /** Number of bidders with a live standing escrow. */
  bidCount: number;
  /**
   * The current leader's identity (only the leader holds escrow). Lets a viewer
   * credit their own escrowed amount toward a raise's affordability. Null if no bids.
   */
  leadingBidderCharacterId: string | null;
  leadingBidderCorporationId: string | null;
  /**
   * Full append-only bid history, newest first — every bid/raise, not just the
   * current standing escrow. Falls back to the standing bids for auctions opened
   * before the history log existed. The current leader is the entry whose amount
   * equals `highestBid`.
   */
  bidHistory: {
    bidderName: string;
    bidderType: "character" | "corporation";
    amount: number;
    placedAtTurn: number;
  }[];
  goldenSharePercent: number;
  closesAtTurn: number;
  /** max(0, closesAtTurn − currentTurn). */
  turnsLeft: number;
}

interface ShellProjection {
  _id: Corporation["_id"];
  name: string;
  sequentialId: number;
  type: CorporationType;
  countryId?: CountryId;
  headquartersState: string;
  totalShares: number;
  sharePrice: number;
}

/**
 * Enrich the country's (or globally, all countries') open privatization auctions
 * with their asset detail. Omitting `countryId` returns every open auction (the
 * global Stock Market view); passing it scopes to one country. Pure read — does
 * not mutate. Sorted by `closesAtTurn` (soonest first).
 */
export async function buildAuctionListings(
  db: Db,
  opts: { currentTurn: number; countryId?: CountryId }
): Promise<AuctionListing[]> {
  const filter: Record<string, unknown> = { status: "open" };
  if (opts.countryId) filter.countryId = opts.countryId;

  const auctions = await db
    .collection<NationalizationAuction>("nationalizationAuctions")
    .find(filter)
    .toArray();
  if (auctions.length === 0) return [];

  const corpIds = auctions.map((a) => a.corporationId);

  const [shells, sectors] = await Promise.all([
    db
      .collection<Corporation>("corporations")
      .find({ _id: { $in: corpIds } })
      .project<ShellProjection>({
        _id: 1,
        name: 1,
        sequentialId: 1,
        type: 1,
        countryId: 1,
        headquartersState: 1,
        totalShares: 1,
        sharePrice: 1,
      })
      .toArray(),
    db
      .collection<CorporateSector>("corporateSectors")
      .find({ corporationId: { $in: corpIds } })
      .toArray(),
  ]);

  const shellById = new Map(shells.map((s) => [String(s._id), s]));
  const sectorsByCorp = new Map<string, CorporateSector[]>();
  for (const sec of sectors) {
    const key = String(sec.corporationId);
    sectorsByCorp.set(key, [...(sectorsByCorp.get(key) ?? []), sec]);
  }

  // Region-name map for every region referenced by a shell HQ or carved sector.
  const stateIds = new Set<string>();
  for (const sh of shells) if (sh.headquartersState) stateIds.add(sh.headquartersState);
  for (const sec of sectors) if (sec.stateId) stateIds.add(sec.stateId);
  const stateDocs =
    stateIds.size > 0
      ? await db
          .collection<{ _id: string; name: string }>("states")
          .find({ _id: { $in: [...stateIds] } })
          .toArray()
      : [];
  const stateNameById = new Map(stateDocs.map((s) => [String(s._id), s.name]));
  const regionName = (id: string | undefined): string => (id && stateNameById.get(id)) || id || "—";

  // The displayed roster is the full append-only history when present, else the
  // standing bids (pre-history auctions). Both entry shapes carry the same
  // bidder/amount/turn fields the roster needs.
  const historyOf = (a: NationalizationAuction) =>
    a.bidHistory && a.bidHistory.length > 0 ? a.bidHistory : a.bids;

  // Resolve bidder identities (character or corporation) for the bid roster.
  const bidderCharIds: ObjectId[] = [];
  const bidderCorpIds: ObjectId[] = [];
  const seenChar = new Set<string>();
  const seenCorp = new Set<string>();
  for (const a of auctions) {
    for (const b of historyOf(a)) {
      if (b.characterId && !seenChar.has(String(b.characterId))) {
        seenChar.add(String(b.characterId));
        bidderCharIds.push(b.characterId);
      } else if (b.corporationId && !seenCorp.has(String(b.corporationId))) {
        seenCorp.add(String(b.corporationId));
        bidderCorpIds.push(b.corporationId);
      }
    }
  }
  const [bidderChars, bidderCorps] = await Promise.all([
    bidderCharIds.length > 0
      ? db
          .collection<Character>("characters")
          .find({ _id: { $in: bidderCharIds } })
          .project<{ _id: ObjectId; name: string }>({ _id: 1, name: 1 })
          .toArray()
      : Promise.resolve([]),
    bidderCorpIds.length > 0
      ? db
          .collection<Corporation>("corporations")
          .find({ _id: { $in: bidderCorpIds } })
          .project<{ _id: ObjectId; name: string }>({ _id: 1, name: 1 })
          .toArray()
      : Promise.resolve([]),
  ]);
  const bidderCharName = new Map(bidderChars.map((c) => [String(c._id), c.name]));
  const bidderCorpName = new Map(bidderCorps.map((c) => [String(c._id), c.name]));

  const listings: AuctionListing[] = [];
  for (const a of auctions) {
    const shell = shellById.get(String(a.corporationId));
    if (!shell) continue; // shell vanished; skip rather than render a ghost row
    const corpSectors = sectorsByCorp.get(String(a.corporationId)) ?? [];
    const totalRevenuePerTurn = corpSectors.reduce((sum, s) => sum + Math.round(s.revenue ?? 0), 0);
    const highestBid = a.bids.reduce((m, b) => Math.max(m, b.amount), 0);
    // The leader (only escrow holder) = the standing bid matching the high amount.
    const leader = a.bids.find((b) => b.amount === highestBid) ?? null;

    listings.push({
      auctionId: String(a._id),
      corporationId: String(a.corporationId),
      corpSequentialId: shell.sequentialId,
      corpName: shell.name,
      countryId: a.countryId,
      leadSectorType: shell.type,
      sectors: corpSectors.map((s) => ({
        sectorType: s.sectorType,
        stateId: s.stateId,
        stateName: regionName(s.stateId),
        revenuePerTurn: Math.round(s.revenue ?? 0),
      })),
      totalRevenuePerTurn,
      hqStateId: shell.headquartersState,
      hqStateName: regionName(shell.headquartersState),
      valuationLocal: Math.round((shell.sharePrice ?? 0) * (shell.totalShares ?? 0)),
      reservePrice: a.reservePrice,
      currency: a.reserveCurrency as CurrencyCode,
      highestBid,
      bidCount: a.bids.length,
      leadingBidderCharacterId: leader?.characterId ? String(leader.characterId) : null,
      leadingBidderCorporationId: leader?.corporationId ? String(leader.corporationId) : null,
      // Newest first (history is appended chronologically; the standing-bid
      // fallback is reversed too for a stable recent-first order).
      bidHistory: [...historyOf(a)].reverse().map((b) => ({
        bidderName: b.characterId
          ? (bidderCharName.get(String(b.characterId)) ?? "Unknown bidder")
          : b.corporationId
            ? (bidderCorpName.get(String(b.corporationId)) ?? "Unknown corporation")
            : "Unknown bidder",
        bidderType: (b.corporationId ? "corporation" : "character") as "character" | "corporation",
        amount: b.amount,
        placedAtTurn: b.placedAtTurn,
      })),
      goldenSharePercent: a.goldenSharePercent,
      closesAtTurn: a.closesAtTurn,
      turnsLeft: Math.max(0, a.closesAtTurn - opts.currentTurn),
    });
  }

  return listings.sort((x, y) => x.closesAtTurn - y.closesAtTurn);
}
