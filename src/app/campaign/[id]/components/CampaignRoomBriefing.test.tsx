/** @vitest-environment happy-dom */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CampaignRoomBriefing } from "./CampaignRoomBriefing";
import type { CampaignBriefing, CampaignData } from "@/lib/campaigns/dto/campaignView";

function campaignWith(briefing: CampaignBriefing | undefined): CampaignData {
  return {
    id: "c1",
    electionId: "e1",
    candidateId: "cand1",
    candidateName: "Nominee",
    candidateIsNPP: false,
    party: "1",
    accessLevel: "owner",
    isArchived: false,
    isRunningMate: false,
    currencyCode: "USD",
    fxRate: 1,
    levels: { fundraising: 1, oppositionResearch: 0, groundGame: 0, mediaSpending: 0 },
    managerId: null,
    managerName: null,
    managers: [],
    canAppointManagers: false,
    oppositionTargetId: null,
    oppositionTargetName: null,
    electionInfo: null,
    funds: 500_000,
    actions: 40,
    ...(briefing ? { briefing } : {}),
  } as CampaignData;
}

const delegateBriefing: CampaignBriefing = {
  path: {
    kind: "delegate",
    won: 120,
    needed: 200,
    remaining: 80,
    leaders: [
      { candidateId: "cand1", name: "Nominee", delegates: 120 },
      { candidateId: "cand2", name: "Rival", delegates: 80 },
    ],
  },
  cashRunway: { funds: 500_000, netPerTurn: -25_000, turnsOfRunway: 20 },
  coalitionWeakness: [
    { bucket: "race:black", appealShare: 0.1, demoEP: -0.3, demoSP: -0.2 },
    { bucket: "race:white", appealShare: 0.5, demoEP: 0.1, demoSP: 0.2 },
  ],
};

describe("CampaignRoomBriefing", () => {
  it("renders the delegate path, runway and weakest bucket", () => {
    render(<CampaignRoomBriefing campaign={campaignWith(delegateBriefing)} />);
    expect(screen.getByText(/Campaign Room/i)).toBeTruthy();
    expect(screen.getByText(/Path to victory: delegates/i)).toBeTruthy();
    expect(screen.getAllByText("120").length).toBeGreaterThan(0);
    expect(screen.getByText(/80 more to clinch/i)).toBeTruthy();
    expect(screen.getByText("Rival")).toBeTruthy();
    // Weakest bucket leads the coalition card.
    expect(screen.getByText(/Black · Race/i)).toBeTruthy();
    // Runway with a burn shows a turn count.
    expect(screen.getByText(/of runway at the current burn/i)).toBeTruthy();
    // The levers themselves are not repeated here: Strategic operations above
    // renders them interactively, with the next tier's price on the row.
    expect(screen.queryByText(/Operations saturation/i)).toBeNull();
    expect(screen.queryByText(/Action tradeoffs/i)).toBeNull();
  });

  it("renders the tipping path with electoral votes and closest states", () => {
    const tipping: CampaignBriefing = {
      ...delegateBriefing,
      path: {
        kind: "tipping",
        evHave: 210,
        evNeeded: 270,
        tippingStates: [
          { stateId: "CA", name: "California", marginPp: 5.3 },
          { stateId: "TX", name: "Texas", marginPp: 42.9 },
        ],
      },
    };
    render(<CampaignRoomBriefing campaign={campaignWith(tipping)} />);
    expect(screen.getByText(/Path to victory: electoral votes/i)).toBeTruthy();
    expect(screen.getByText("210")).toBeTruthy();
    expect(screen.getByText(/California/i)).toBeTruthy();
  });

  it("renders nothing when there is no briefing (non-owner fog of war)", () => {
    const { container } = render(<CampaignRoomBriefing campaign={campaignWith(undefined)} />);
    expect(container.firstChild).toBeNull();
  });
});
