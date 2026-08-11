/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RegionPartiesTab } from "./RegionPartiesTab";
import type { PartyOrgDisplay } from "@/components/state/StatePageTabsTypes";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/components/PartyLogo", () => ({
  PartyLogo: () => <span data-testid="party-logo" />,
}));

function makeParty(
  overrides: Partial<PartyOrgDisplay> & { _id: string; partyId: string }
): PartyOrgDisplay {
  return {
    stateId: "CA",
    countryId: "US",
    organization: 30,
    partyName: `Party ${overrides.partyId}`,
    partyAbbreviation: overrides.partyId.slice(0, 3).toUpperCase(),
    partyColor: "#3366ff",
    isDefault: false,
    ...overrides,
  } as PartyOrgDisplay;
}

describe("RegionPartiesTab", () => {
  it("renders the empty state with custom hint + link when partyOrg is empty", () => {
    render(
      <RegionPartiesTab
        countryId="UK"
        regionId="LON"
        regionName="London"
        partyOrg={[]}
        config={{
          regionNoun: "region",
          emptyStateHint: "Coming soon for UK",
          emptyStateLink: { href: "/country/uk", label: "Browse UK" },
        }}
      />
    );
    expect(screen.getByText("No party organizations in this region")).toBeTruthy();
    expect(screen.getByText("Coming soon for UK")).toBeTruthy();
    const link = screen.getByText("Browse UK") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/country/uk");
  });

  it("uses default heading when config.headingLabel is omitted", () => {
    render(
      <RegionPartiesTab
        countryId="UK"
        regionId="LON"
        regionName="London"
        partyOrg={[makeParty({ _id: "p1", partyId: "lab", organization: 50 })]}
      />
    );
    expect(screen.getByText("Party Organizations in London")).toBeTruthy();
  });

  it("uses custom heading when provided", () => {
    render(
      <RegionPartiesTab
        countryId="US"
        regionId="CA"
        regionName="California"
        partyOrg={[makeParty({ _id: "p1", partyId: "democrat", organization: 60 })]}
        config={{ headingLabel: "State Party Organizations in California" }}
      />
    );
    expect(screen.getByText("State Party Organizations in California")).toBeTruthy();
  });

  it("calls partyFlavor and renders the returned text on each top-3 card", () => {
    const flavor = vi
      .fn<(p: PartyOrgDisplay) => string | null>()
      .mockImplementation((p) => `Flavor for ${p.partyId}`);
    render(
      <RegionPartiesTab
        countryId="US"
        regionId="CA"
        regionName="California"
        partyOrg={[
          makeParty({ _id: "p1", partyId: "democrat", organization: 60 }),
          makeParty({ _id: "p2", partyId: "republican", organization: 40 }),
        ]}
        config={{ partyFlavor: flavor }}
      />
    );
    expect(flavor).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Flavor for democrat")).toBeTruthy();
    expect(screen.getByText("Flavor for republican")).toBeTruthy();
  });

  it("omits the flavor row when no partyFlavor is provided", () => {
    render(
      <RegionPartiesTab
        countryId="UK"
        regionId="LON"
        regionName="London"
        partyOrg={[makeParty({ _id: "p1", partyId: "lab", organization: 60 })]}
      />
    );
    expect(screen.getByText("60.0%")).toBeTruthy();
    expect(document.querySelector("p.italic")).toBeNull();
  });

  it("toggles the 'parties without active organization' accordion", () => {
    render(
      <RegionPartiesTab
        countryId="UK"
        regionId="LON"
        regionName="London"
        partyOrg={[
          makeParty({ _id: "p1", partyId: "lab", organization: 60 }),
          makeParty({ _id: "p2", partyId: "ind", organization: 0 }),
          makeParty({ _id: "p3", partyId: "fringe", organization: 0 }),
        ]}
      />
    );
    expect(screen.getByText("2 parties without active organization")).toBeTruthy();
    expect(screen.queryByText("Party ind")).toBeNull();
    fireEvent.click(screen.getByText("2 parties without active organization"));
    expect(screen.getByText("Party ind")).toBeTruthy();
    expect(screen.getByText("Party fringe")).toBeTruthy();
  });

  it("falls back to descending Org% sort when no comparator is provided", () => {
    render(
      <RegionPartiesTab
        countryId="UK"
        regionId="LON"
        regionName="London"
        partyOrg={[
          makeParty({ _id: "p1", partyId: "weak", organization: 20 }),
          makeParty({ _id: "p2", partyId: "strong", organization: 80 }),
          makeParty({ _id: "p3", partyId: "mid", organization: 50 }),
        ]}
      />
    );
    const headings = screen.getAllByText(/^(80\.0%|50\.0%|20\.0%)$/);
    expect(headings.map((h) => h.textContent)).toEqual(["80.0%", "50.0%", "20.0%"]);
  });
});
