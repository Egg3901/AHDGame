/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AuctionTable } from "./AuctionTable";
import type { AuctionListing } from "@/lib/nationalization/auctionListing";

vi.mock("@/contexts/RegisteredCountriesContext", () => ({
  useActivePreset: () => "modern",
}));

afterEach(cleanup);

const listing: AuctionListing = {
  auctionId: "a1",
  corporationId: "c1",
  corpSequentialId: 7,
  corpName: "State Rail",
  countryId: "US",
  leadSectorType: "logistics",
  sectors: [{ sectorType: "logistics", stateId: "OH", stateName: "Ohio", revenuePerTurn: 10 }],
  totalRevenuePerTurn: 10,
  hqStateId: "OH",
  hqStateName: "Ohio",
  valuationLocal: 1000,
  reservePrice: 800,
  currency: "USD",
  highestBid: 0,
  bidCount: 0,
  leadingBidderCharacterId: null,
  leadingBidderCorporationId: null,
  bidHistory: [],
  goldenSharePercent: 0.25,
  closesAtTurn: 100,
  turnsLeft: 12,
};

describe("AuctionTable", () => {
  it("explains why the list is empty and how auctions open", () => {
    render(<AuctionTable auctions={[]} viewerCountryId={null} showFlag={false} />);
    expect(screen.getByText("No open auctions")).toBeTruthy();
    const body = screen.getByText(/finance minister, or a passed privatization bill/);
    expect(body.textContent).toContain("runs for 48 turns");
  });

  it("shows the stored golden-share fraction as a whole percent", () => {
    render(<AuctionTable auctions={[listing]} viewerCountryId="US" showFlag={false} />);
    expect(screen.getByText("Golden share 25%")).toBeTruthy();
  });
});
