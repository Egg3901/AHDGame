/** @vitest-environment happy-dom */
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { OrgDirectory } from "./OrgDirectory";
import { resolveOrgIdentity } from "@/lib/constants/orgIdentity";
import type { OrgSummary } from "../orgTypes";

afterEach(() => cleanup());

function org(id: string, name: string, category: string): OrgSummary {
  return {
    id,
    def: { id, name, shortName: id, category, foundingMembers: [], description: "" },
    members: [{ countryId: "DE" }],
    activeLegislation: [],
    pendingLegislation: [],
    identity: resolveOrgIdentity(id, false, name, category as never),
    derived: { members: [], worldEconomySharePct: 55, notionalBudgetMillions: 0, yourInfluence: 0 },
  } as unknown as OrgSummary;
}

describe("OrgDirectory", () => {
  it("renders cards grouped by category with lowercase links", () => {
    render(
      <OrgDirectory
        orgs={[org("EU", "European Union", "economic"), org("UN", "United Nations", "political")]}
        viewer={null}
      />
    );
    expect(screen.getByText("European Union")).toBeTruthy();
    expect(screen.getByText("United Nations")).toBeTruthy();
    expect(screen.getByText("Economic")).toBeTruthy(); // category heading
    expect(screen.getByText("European Union").closest("a")?.getAttribute("href")).toBe(
      "/world/international-organizations/eu"
    );
  });
});
