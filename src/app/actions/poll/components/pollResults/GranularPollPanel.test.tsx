/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GranularPollPanel } from "./GranularPollPanel";
import {
  buildGranularPollPayload,
  buildGranularPollPayloadForState,
} from "@/lib/actions/granularPollPayload";
import { stateCensusData } from "@/lib/seeds/stateCensusData";
import { DEMOGRAPHIC_TURNOUT_RATES } from "@/lib/seeds/demographicCategories";
import type { PollData, StoredPoll } from "../../types";

const mockPollData: PollData = {
  pollType: "large",
  homeState: "CT",
  stateName: "Connecticut",
  statePopulation: 3_600_000,
  character: {
    economicPosition: -1,
    socialPosition: -1,
    favorability: 50,
    politicalInfluence: 30,
  },
  fundCost: 75000,
  actionCost: 6,
  canAffordSmall: true,
  canAffordLarge: true,
  hasActionsSmall: true,
  hasActionsLarge: true,
  storedPoll: null,
  electionContext: null,
  demographicTurnout: null,
};

function buildUsMockPoll(): StoredPoll {
  const granular = buildGranularPollPayload({
    config: stateCensusData.CT,
    era: "2019",
    character: {
      economicPosition: -1,
      socialPosition: -1,
      favorability: 50,
      politicalInfluence: 30,
    },
    opponents: [
      {
        candidateId: "opp-1",
        name: "Opponent One",
        economicPosition: 1,
        socialPosition: 1,
        favorability: 50,
        politicalInfluence: 25,
      },
    ],
    turnoutRates: DEMOGRAPHIC_TURNOUT_RATES,
  });

  return {
    takenAt: new Date().toISOString(),
    overallAppeal: 25,
    totalEstimatedVoters: 1_000_000,
    totalPotentialVoters: 1_200_000,
    topGroups: [],
    bottomGroups: [],
    categories: [],
    granular,
  };
}

function buildDdMockPoll(): StoredPoll {
  const granular = buildGranularPollPayloadForState({
    countryId: "DD",
    stateId: "SN",
    preset: "1953-default",
    character: {
      economicPosition: -1,
      socialPosition: -1,
      favorability: 50,
      politicalInfluence: 30,
    },
    opponents: [],
  });

  return {
    takenAt: new Date().toISOString(),
    overallAppeal: 25,
    totalEstimatedVoters: 3_310_000,
    totalPotentialVoters: 3_500_000,
    topGroups: [],
    bottomGroups: [],
    categories: [],
    granular,
  };
}

function buildDeMockPoll(): StoredPoll {
  const granular = buildGranularPollPayloadForState({
    countryId: "DE",
    stateId: "BW",
    preset: "2019-default",
    character: {
      economicPosition: -1,
      socialPosition: -1,
      favorability: 50,
      politicalInfluence: 30,
    },
    opponents: [
      {
        candidateId: "opp-1",
        name: "Opponent One",
        economicPosition: 1,
        socialPosition: 1,
        favorability: 50,
        politicalInfluence: 25,
      },
    ],
  });

  return {
    takenAt: new Date().toISOString(),
    overallAppeal: 25,
    totalEstimatedVoters: 1_000_000,
    totalPotentialVoters: 1_200_000,
    topGroups: [],
    bottomGroups: [],
    categories: [],
    granular,
  };
}

describe("GranularPollPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the header with the segment count", () => {
    const poll = buildUsMockPoll();
    render(<GranularPollPanel poll={poll} pollData={mockPollData} />);
    expect(screen.getByText("Granular electorate")).toBeTruthy();
    expect(screen.getByText(`${poll.granular!.cells.length} segments`)).toBeTruthy();
  });

  it("toggles the full segment table", () => {
    const poll = buildUsMockPoll();
    render(<GranularPollPanel poll={poll} pollData={mockPollData} />);
    const tableButton = screen.getByLabelText("Toggle full segment table");
    fireEvent.click(tableButton);
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getAllByText("Race").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Education").length).toBeGreaterThanOrEqual(1);
  });

  it("sorts the table by share by default and allows changing sort", () => {
    const poll = buildUsMockPoll();
    render(<GranularPollPanel poll={poll} pollData={mockPollData} />);
    fireEvent.click(screen.getByLabelText("Toggle full segment table"));
    const shareHeader = screen.getByRole("button", { name: /% of electorate/ });
    fireEvent.click(shareHeader);
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("exports CSV when the export button is clicked", () => {
    const poll = buildUsMockPoll();
    const createObjectURL = vi.fn(() => "blob:url");
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    render(<GranularPollPanel poll={poll} pollData={mockPollData} />);
    const exportButton = screen.getByLabelText("Export granular poll data as CSV");
    fireEvent.click(exportButton);

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledOnce();
  });

  it("renders segment explorer chips and shows a segment card on selection", () => {
    const poll = buildUsMockPoll();
    render(<GranularPollPanel poll={poll} pollData={mockPollData} />);
    const whiteChip = screen.getByRole("button", { name: /White/ });
    fireEvent.click(whiteChip);
    expect(screen.getByText(/Widened margin of error/)).toBeTruthy();
  });

  it("renders non-US dimension labels for a DE payload", () => {
    const poll = buildDeMockPoll();
    render(<GranularPollPanel poll={poll} pollData={mockPollData} />);
    expect(screen.getByRole("tab", { name: "Ethnicity" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Urbanization" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Income" })).toBeTruthy();
  });

  it("toggles the DE segment table with dynamic columns", () => {
    const poll = buildDeMockPoll();
    render(<GranularPollPanel poll={poll} pollData={mockPollData} />);
    fireEvent.click(screen.getByLabelText("Toggle full segment table"));
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getAllByText("Ethnicity").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Income").length).toBeGreaterThanOrEqual(1);
  });

  it("does not inject US education levels onto a DD poll (ticket #1121)", () => {
    const poll = buildDdMockPoll();
    render(<GranularPollPanel poll={poll} pollData={mockPollData} />);
    fireEvent.click(screen.getByRole("tab", { name: "Education" }));
    expect(screen.queryByText("College Degree")).toBeNull();
    expect(screen.queryByText("No College")).toBeNull();
    expect(screen.queryByText("Graduate Degree")).toBeNull();
    expect(screen.getAllByText("Primary or below").length).toBeGreaterThan(0);
  });

  it("shows per-group turnout on DD education marginals (ticket #1121)", () => {
    const poll = buildDdMockPoll();
    render(<GranularPollPanel poll={poll} pollData={mockPollData} />);
    fireEvent.click(screen.getByRole("tab", { name: "Education" }));
    expect(screen.getAllByText(/turnout/).length).toBeGreaterThan(0);
  });
});
