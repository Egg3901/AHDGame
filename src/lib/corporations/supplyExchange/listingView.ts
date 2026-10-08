import type { Db } from "mongodb";
import type { CommodityType } from "@/lib/constants/commodities";
import type { Corporation } from "@/lib/db/types/corporation";
import type { SupplyListing, SupplyListingView } from "@/lib/db/types/supplyListing";

export type PublisherFields = Pick<
  Corporation,
  "_id" | "name" | "userId" | "ceoVacant" | "countryId" | "creditRatingSnapshot"
>;

export const PUBLISHER_PROJECTION = {
  _id: 1,
  name: 1,
  userId: 1,
  ceoVacant: 1,
  countryId: 1,
  creditRatingSnapshot: 1,
} as const;

/**
 * Public shape of a listing, or null when the offer is stale: its publisher is
 * gone, has no CEO, or the CEO who posted it no longer runs the corporation.
 * A viewer's own listing is always shown so they can withdraw it.
 */
export function toListingView(
  row: SupplyListing,
  publisher: PublisherFields | undefined,
  viewerCorpIds: ReadonlySet<string>
): SupplyListingView | null {
  const own = viewerCorpIds.has(row.corporationId.toString());
  if (!publisher) return null;
  const ai = row.aiListed === true;
  if (
    !own &&
    !ai &&
    (publisher.ceoVacant || publisher.userId?.toString() !== row.publishedByUserId)
  ) {
    return null;
  }
  return {
    id: row._id,
    corporationId: row.corporationId.toString(),
    corporationName: publisher.name,
    ...(publisher.countryId ? { corporationCountryId: publisher.countryId } : {}),
    ...(publisher.creditRatingSnapshot ? { creditRating: publisher.creditRatingSnapshot } : {}),
    slot: row.slot,
    own,
    ...(ai ? { ai: true } : {}),
    side: row.side,
    commodity: row.commodity,
    ...(row.stateId ? { stateId: row.stateId } : {}),
    volumeCap: row.volumeCap,
    pricePremium: row.pricePremium,
    ...(row.durationTurns != null ? { durationTurns: row.durationTurns } : {}),
    expiresAtTurn: row.expiresAtTurn,
  };
}

export interface OpenOffersPage {
  offers: SupplyListingView[];
  /** More rows exist past this page (before stale offers are dropped). */
  hasMore: boolean;
}

/**
 * Open, non-stale offers with publishers resolved in one batch read. Without a
 * commodity it spans every commodity. `page` is 1-based; stale offers are
 * dropped after the page is read, so a page can come back a little short.
 */
export async function loadOpenOffers(
  db: Db,
  args: {
    commodity?: CommodityType;
    turn: number;
    viewerCorpIds: ReadonlySet<string>;
    limit: number;
    page?: number;
  }
): Promise<OpenOffersPage> {
  const page = Math.max(1, args.page ?? 1);
  const found = await db
    .collection<SupplyListing>("supplyListings")
    .find({
      ...(args.commodity ? { commodity: args.commodity } : {}),
      expiresAtTurn: { $gt: args.turn },
    })
    .sort({ updatedAt: -1, _id: 1 })
    .skip((page - 1) * args.limit)
    .limit(args.limit + 1)
    .toArray();
  const hasMore = found.length > args.limit;
  const rows = hasMore ? found.slice(0, args.limit) : found;
  if (rows.length === 0) return { offers: [], hasMore: false };
  const publishers = await db
    .collection<Corporation>("corporations")
    .find({ _id: { $in: rows.map((r) => r.corporationId) } })
    .project<PublisherFields>(PUBLISHER_PROJECTION)
    .toArray();
  const byId = new Map(publishers.map((c) => [c._id.toString(), c]));
  const offers = rows
    .map((row) => toListingView(row, byId.get(row.corporationId.toString()), args.viewerCorpIds))
    .filter((view): view is SupplyListingView => view !== null);
  return { offers, hasMore };
}
