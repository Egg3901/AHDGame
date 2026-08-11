import type { Corporation, ShareListing, ShareOrder } from "@/lib/db/types";

/**
 * Compute the number of shares accounted for in a corporation's books.
 *
 * Invariant: `corporation.totalShares === computeAccountedShares(corp, openListings, openCorpSellOrders)`
 * at all times. Any drift indicates a bug in a share-mutation path or residual
 * data corruption from a past bug.
 *
 * Components:
 * - `shareholders.shares`: live positions (listings and corp sell orders already
 *   debited these at creation)
 * - `publicFloat`: unowned shares available on the public market
 * - open shareListings' `sharesRemaining`: shares debited from holders and
 *   reserved for private sale
 * - open corp-placed shareOrders' `sharesRemaining`: shares debited from corp
 *   holders and reserved for limit sell
 *
 * Character-placed sell orders (no `placerCorporationId`) do NOT debit shares
 * at creation — those shares stay in the shareholder entry, so they must not
 * be counted here (would double-count).
 */
export function computeAccountedShares(
  corp: Pick<Corporation, "_id" | "shareholders" | "publicFloat">,
  openListings: Pick<ShareListing, "corporationId" | "status" | "sharesRemaining">[],
  openSellOrders: Pick<
    ShareOrder,
    "corporationId" | "type" | "status" | "sharesRemaining" | "placerCorporationId"
  >[]
): number {
  const corpIdStr = corp._id.toString();

  const shareholderSum = (corp.shareholders ?? []).reduce((s, sh) => s + (sh.shares ?? 0), 0);
  const floatAmount = corp.publicFloat ?? 0;

  const listingSum = openListings
    .filter((l) => l.corporationId.toString() === corpIdStr && l.status === "open")
    .reduce((s, l) => s + (l.sharesRemaining ?? 0), 0);

  const corpSellSum = openSellOrders
    .filter(
      (o) =>
        o.corporationId.toString() === corpIdStr &&
        o.type === "sell" &&
        o.status === "open" &&
        !!o.placerCorporationId
    )
    .reduce((s, o) => s + (o.sharesRemaining ?? 0), 0);

  return shareholderSum + floatAmount + listingSum + corpSellSum;
}
