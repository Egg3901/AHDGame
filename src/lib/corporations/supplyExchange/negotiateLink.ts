import { COMMODITY_TYPES, type CommodityType } from "@/lib/constants/commodities";
import type { SupplyListingView } from "@/lib/db/types/supplyListing";

/** The listing fields the proposal form needs to open a counter-offer on it. */
export type NegotiateDraft = Pick<
  SupplyListingView,
  | "corporationId"
  | "corporationName"
  | "side"
  | "commodity"
  | "stateId"
  | "volumeCap"
  | "pricePremium"
  | "durationTurns"
>;

/**
 * Link from a public offer to the taker's corporation page with the proposal
 * form filled in from the offer. Without the offer terms the form opens blank
 * in the supplier role, so a buyer answering a sell offer ends up proposing to
 * SELL the commodity and is refused for having no plants that make it.
 */
export function negotiateHref(corpId: string, offer: NegotiateDraft): string {
  const params = new URLSearchParams({
    tab: "commodities",
    respondCorp: offer.corporationId,
    respondName: offer.corporationName,
    respondSide: offer.side,
    respondCommodity: offer.commodity,
    respondVolume: String(offer.volumeCap),
    respondPremium: String(offer.pricePremium),
  });
  if (offer.stateId) params.set("respondState", offer.stateId);
  if (offer.durationTurns != null) params.set("respondTerm", String(offer.durationTurns));
  return `/corporation/${corpId}?${params.toString()}#supply-agreements`;
}

/** Inverse of `negotiateHref`; null when the query does not name a usable offer. */
export function negotiateDraftFromSearch(search: string): NegotiateDraft | null {
  const params = new URLSearchParams(search);
  const corporationId = params.get("respondCorp");
  const side = params.get("respondSide");
  const commodity = params.get("respondCommodity");
  const volumeCap = Number(params.get("respondVolume"));
  const pricePremium = Number(params.get("respondPremium"));
  if (!corporationId || (side !== "sell" && side !== "buy")) return null;
  if (!commodity || !(COMMODITY_TYPES as readonly string[]).includes(commodity)) return null;
  if (!Number.isFinite(volumeCap) || !Number.isFinite(pricePremium)) return null;
  const term = params.get("respondTerm");
  const durationTurns = term != null && Number.isFinite(Number(term)) ? Number(term) : undefined;
  const stateId = params.get("respondState") ?? undefined;
  return {
    corporationId,
    corporationName: params.get("respondName") ?? "",
    side,
    commodity: commodity as CommodityType,
    volumeCap,
    pricePremium,
    ...(stateId ? { stateId } : {}),
    ...(durationTurns !== undefined ? { durationTurns } : {}),
  };
}
