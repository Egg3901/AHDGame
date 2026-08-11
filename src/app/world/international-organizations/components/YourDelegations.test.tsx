/** @vitest-environment happy-dom */
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { YourDelegations } from "./YourDelegations";
import { resolveOrgIdentity } from "@/lib/constants/orgIdentity";
import type { OrgSummary, OrgViewerInfo } from "../orgTypes";

afterEach(() => cleanup());
const viewer = { foreignMinisterOf: "DE", headOfGovernmentOf: null } as unknown as OrgViewerInfo;

function org(id: string, name: string, members: string[]): OrgSummary {
  return {
    id,
    def: { id, name, shortName: id, category: "economic" },
    members: members.map((c) => ({ countryId: c, status: "founding" })),
    activeLegislation: [],
    pendingMembershipProposals: [],
    identity: resolveOrgIdentity(id, false, name, "economic"),
    derived: { members: [], worldEconomySharePct: 50, notionalBudgetMillions: 0, yourInfluence: 0 },
  } as unknown as OrgSummary;
}

describe("YourDelegations", () => {
  it("shows only orgs the viewer belongs to (or has applied to), linked", () => {
    render(
      <YourDelegations
        orgs={[org("EU", "European Union", ["DE"]), org("UN", "United Nations", ["US"])]}
        viewer={viewer}
      />
    );
    expect(screen.getByText("European Union")).toBeTruthy();
    expect(screen.queryByText("United Nations")).toBeNull();
    expect(screen.getByText("European Union").closest("a")?.getAttribute("href")).toBe(
      "/world/international-organizations/eu"
    );
  });
});
