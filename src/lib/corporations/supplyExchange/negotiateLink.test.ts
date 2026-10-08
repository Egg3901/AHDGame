import { describe, expect, it } from "vitest";
import { negotiateDraftFromSearch, negotiateHref } from "./negotiateLink";

describe("negotiateHref", () => {
  // Ticket 1418: the offers page Negotiate link dropped the offer, so the form
  // opened blank in the supplier role and a buyer was refused for having no
  // plants making the commodity.
  it("carries a sell offer's terms so the form opens in the buyer role", () => {
    const offer = {
      corporationId: "6ac3cb42f6b04c52a00864c3",
      corporationName: "Copperline Urban Holdings",
      side: "sell" as const,
      commodity: "real_estate_services" as const,
      stateId: "DC",
      volumeCap: 18.81,
      pricePremium: 0.2,
    };
    const href = negotiateHref("buyer-corp", offer);
    expect(href.startsWith("/corporation/buyer-corp?tab=commodities&")).toBe(true);
    expect(href.endsWith("#supply-agreements")).toBe(true);
    const search = href.slice(href.indexOf("?"), href.indexOf("#"));
    expect(negotiateDraftFromSearch(search)).toEqual(offer);
  });

  it("keeps the term and ignores a query without a usable offer", () => {
    const href = negotiateHref("c", {
      corporationId: "p",
      corporationName: "P",
      side: "buy",
      commodity: "steel",
      volumeCap: 5,
      pricePremium: -0.1,
      durationTurns: 24,
    });
    expect(
      negotiateDraftFromSearch(href.slice(href.indexOf("?"), href.indexOf("#")))
    ).toMatchObject({ side: "buy", durationTurns: 24 });
    expect(negotiateDraftFromSearch("?tab=commodities")).toBeNull();
    expect(
      negotiateDraftFromSearch(
        "?respondCorp=p&respondSide=sell&respondCommodity=nope&respondVolume=1&respondPremium=0"
      )
    ).toBeNull();
  });
});
