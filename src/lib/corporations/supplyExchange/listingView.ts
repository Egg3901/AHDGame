import type { Db, Filter, ObjectId, Sort } from "mongodb";
import type { CommodityType } from "@/lib/constants/commodities";
import type { Character } from "@/lib/db/types/character";
import type { Corporation } from "@/lib/db/types/corporation";
import type { SupplyListing, SupplyListingView } from "@/lib/db/types/supplyListing";

export type PublisherFields = Pick<
  Corporation,
  "_id" | "name" | "userId" | "ceoVacant" | "countryId" | "creditRatingSnapshot" | "logoUrl"
> &
  Partial<Pick<Corporation, "ceoId" | "ceoType">>;

export type OfferKind = "player" | "npp" | "all";
export type OfferSort = "volume" | "premium" | "newest";

export interface CeoDisplay {
  name: string;
  avatarUrl?: string;
}

export const PUBLISHER_PROJECTION = {
  _id: 1,
  name: 1,
  userId: 1,
  ceoVacant: 1,
  countryId: 1,
  creditRatingSnapshot: 1,
  logoUrl: 1,
  ceoId: 1,
  ceoType: 1,
} as const;

/**
 * Public shape of a listing, or null when the offer is stale: its publisher is
 * gone, has no CEO, or the CEO who posted it no longer runs the corporation.
 * A viewer's own listing is always shown so they can withdraw it.
 */
export function toListingView(
  row: SupplyListing,
  publisher: PublisherFields | undefined,
  viewerCorpIds: ReadonlySet<string>,
  ceo?: CeoDisplay
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
    ...(publisher.logoUrl ? { corporationLogoUrl: publisher.logoUrl } : {}),
    ...(!ai && ceo ? { ceoName: ceo.name } : {}),
    ...(!ai && ceo?.avatarUrl ? { ceoAvatarUrl: ceo.avatarUrl } : {}),
    side: row.side,
    commodity: row.commodity,
    ...(row.stateId ? { stateId: row.stateId } : {}),
    volumeCap: row.volumeCap,
    pricePremium: row.pricePremium,
    ...(row.durationTurns != null ? { durationTurns: row.durationTurns } : {}),
    expiresAtTurn: row.expiresAtTurn,
  };
}

const SORTS: Record<OfferSort, Sort> = {
  volume: { volumeCap: -1, _id: 1 },
  premium: { pricePremium: 1, _id: 1 },
  newest: { updatedAt: -1, _id: 1 },
};

/** Players first when both kinds are listed (an absent `aiListed` sorts before `true`). */
export function offerSort(sort: OfferSort, kind: OfferKind): Sort {
  return kind === "all" ? { aiListed: 1, ...(SORTS[sort] as Record<string, 1 | -1>) } : SORTS[sort];
}

/** Mongo filter for open offers, shared by the page read and the count. */
export function openOffersFilter(args: {
  commodity?: CommodityType;
  commodities?: CommodityType[];
  kind?: OfferKind;
  side?: "buy" | "sell";
  turn: number;
}): Filter<SupplyListing> {
  const commodities = args.commodity ? [args.commodity] : (args.commodities ?? []);
  return {
    ...(commodities.length === 1
      ? { commodity: commodities[0] }
      : commodities.length > 1
        ? { commodity: { $in: commodities } }
        : {}),
    ...(args.side ? { side: args.side } : {}),
    ...(args.kind === "player"
      ? { aiListed: { $ne: true } }
      : args.kind === "npp"
        ? { aiListed: true }
        : {}),
    expiresAtTurn: { $gt: args.turn },
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
    commodities?: CommodityType[];
    kind?: OfferKind;
    side?: "buy" | "sell";
    sort?: OfferSort;
    turn: number;
    viewerCorpIds: ReadonlySet<string>;
    limit: number;
    page?: number;
  }
): Promise<OpenOffersPage> {
  const page = Math.max(1, args.page ?? 1);
  const kind = args.kind ?? "all";
  const found = await db
    .collection<SupplyListing>("supplyListings")
    .find(openOffersFilter(args))
    .sort(offerSort(args.sort ?? "newest", kind))
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
  const ceoIds = publishers
    .filter((c) => c.ceoId && (c.ceoType ?? "character") === "character")
    .map((c) => c.ceoId!);
  const characters =
    ceoIds.length === 0
      ? []
      : await db
          .collection<Character>("characters")
          .find({ _id: { $in: ceoIds } })
          .project<{ _id: ObjectId; name: string; avatarUrl?: string }>({
            name: 1,
            avatarUrl: 1,
          })
          .toArray();
  const ceoById = new Map(characters.map((c) => [c._id.toString(), c]));
  const offers = rows
    .map((row) => {
      const publisher = byId.get(row.corporationId.toString());
      const ceo = publisher?.ceoId ? ceoById.get(publisher.ceoId.toString()) : undefined;
      return toListingView(row, publisher, args.viewerCorpIds, ceo);
    })
    .filter((view): view is SupplyListingView => view !== null);
  return { offers, hasMore };
}
