import type { Corporation, ShareListing, ShareOrder } from "@/lib/db/types";

/**
 * Compute the number of shares accounted for in a corporation's books.
 *
 * Invariant: `corporation.totalShares === computeAccountedShares(corp, openListings, openSellOrders)`
 * at all times. Any drift indicates a bug in a share-mutation path or residual
 * data corruption from a past bug.
 *
 * Components:
 * - `shareholders.shares`: live positions (listings and debited sell orders already
 *   debited these at creation)
 * - `publicFloat`: unowned shares available on the public market
 * - open shareListings' `sharesRemaining`: shares debited from holders and
 *   reserved for private sale
 * - open shareOrders' `sharesRemaining`: shares debited from holders and
 *   reserved for limit sell (corporate orders or `sharesDebitedAtCreation: true`)
 *
 * Legacy character sell orders without `sharesDebitedAtCreation: true` keep
 * their shares in the shareholder entry and must not be counted twice.
 * Corporate sell reservations count even when the legacy row has no flag.
 */
export function computeAccountedShares(
  corp: Pick<Corporation, "_id" | "shareholders" | "publicFloat">,
  openListings: Pick<ShareListing, "corporationId" | "status" | "sharesRemaining">[],
  openSellOrders: Pick<
    ShareOrder,
    | "corporationId"
    | "type"
    | "status"
    | "sharesRemaining"
    | "placerCorporationId"
    | "sharesDebitedAtCreation"
  >[]
): number {
  const corpIdStr = corp._id.toString();

  const shareholderSum = (corp.shareholders ?? []).reduce((s, sh) => s + (sh.shares ?? 0), 0);
  const floatAmount = corp.publicFloat ?? 0;

  const listingSum = openListings
    .filter((l) => l.corporationId.toString() === corpIdStr && l.status === "open")
    .reduce((s, l) => s + (l.sharesRemaining ?? 0), 0);

  const sellReservationSum = openSellOrders
    .filter(
      (o) =>
        o.corporationId.toString() === corpIdStr &&
        o.type === "sell" &&
        o.status === "open" &&
        (!!o.placerCorporationId || o.sharesDebitedAtCreation === true)
    )
    .reduce((s, o) => s + (o.sharesRemaining ?? 0), 0);

  return shareholderSum + floatAmount + listingSum + sellReservationSum;
}
