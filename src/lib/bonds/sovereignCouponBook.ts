/**
 * Loader shell for the per-country sovereign coupon book (issue #2089). The
 * service rule itself lives in `budget/rules/sovereignDebtService.ts`.
 */
import type { Db } from "mongodb";
import type { Bond } from "@/lib/db/types/bond";
import {
  sovereignCouponBook,
  type CouponBearingSovereignBond,
  type SovereignCouponBook,
} from "@/lib/budget/rules/sovereignDebtService";

/** Projection that carries everything the coupon book reads. */
export const SOVEREIGN_COUPON_BOOK_PROJECTION = {
  _id: 1,
  issuerType: 1,
  countryId: 1,
  couponRate: 1,
  totalIssued: 1,
  restructureHaircutPercent: 1,
  matured: 1,
  defaulted: 1,
} as const;

/** Group already-loaded sovereign bonds into one coupon book per issuing country. */
export function sovereignCouponBooksByCountry(
  bonds: readonly (CouponBearingSovereignBond & Pick<Bond, "countryId">)[]
): Map<string, SovereignCouponBook> {
  const grouped = new Map<string, CouponBearingSovereignBond[]>();
  for (const bond of bonds) {
    if (bond.issuerType !== "sovereign" || !bond.countryId) continue;
    const key = String(bond.countryId);
    const list = grouped.get(key) ?? [];
    list.push(bond);
    grouped.set(key, list);
  }
  const books = new Map<string, SovereignCouponBook>();
  for (const [countryId, list] of grouped) books.set(countryId, sovereignCouponBook(list));
  return books;
}

/** One projected read of the outstanding sovereign stock, grouped by country. */
export async function loadSovereignCouponBooks(
  db: Db,
  countryIds?: readonly string[]
): Promise<Map<string, SovereignCouponBook>> {
  const bonds = await db
    .collection<Bond>("bonds")
    .find(
      {
        issuerType: "sovereign",
        matured: { $ne: true },
        defaulted: { $ne: true },
        ...(countryIds ? { countryId: { $in: [...countryIds] as Bond["countryId"][] } } : {}),
      },
      { projection: SOVEREIGN_COUPON_BOOK_PROJECTION }
    )
    .toArray();
  return sovereignCouponBooksByCountry(bonds);
}
