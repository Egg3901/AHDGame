import type { Holder } from "./bondTypes";

export interface BondHolderPresentation {
  href: string | null;
  imageUrl?: string;
  typeLabel: string;
}

/** Pure presentation contract shared by the owners table and its regression test. */
export function getBondHolderPresentation(holder: Holder): BondHolderPresentation {
  if (holder.type === "character") {
    return {
      href: holder.sequentialId != null ? `/character/${holder.id}` : null,
      imageUrl: holder.avatarUrl,
      typeLabel: "Character",
    };
  }
  if (holder.type === "npp") {
    return {
      href: `/politicians/npp/${holder.sequentialId ?? holder.id}`,
      imageUrl: holder.avatarUrl,
      typeLabel: "Non-player investor",
    };
  }
  if (holder.type === "corporation") {
    return {
      href: holder.sequentialId != null ? `/corporation/${holder.sequentialId}` : null,
      imageUrl: holder.logoUrl,
      typeLabel: "Corporation",
    };
  }
  if (holder.type === "fund") {
    return {
      href: holder.slug
        ? holder.fundCountryId
          ? `/country/${holder.fundCountryId.toLowerCase()}/stockmarket/fund/${holder.slug}`
          : `/stockmarket/global/fund/${holder.slug}`
        : null,
      typeLabel: "Index fund",
    };
  }
  return { href: null, typeLabel: "Central bank" };
}
