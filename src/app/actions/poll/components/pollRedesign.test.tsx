/** @vitest-environment happy-dom */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ElectionComparisonPanel } from "./ElectionComparisonPanel";
import { PollTrendChart } from "./PollTrendChart";
import { StatCards } from "./pollResults/StatCards";
import type { ElectionContext, StoredPoll } from "../types";

const entry = (appeal: number, takenAt: string) => ({
  takenAt,
  tier: "small" as const,
  stateName: "Ohio",
  overallAppeal: appeal,
  totalEstimatedVoters: 1000,
});

const context: ElectionContext = {
  electionId: "e1",
  electionType: "governor",
  state: "Ohio",
  opponents: [
    {
      candidateId: "c1",
      name: "Rival One",
      party: "7",
      isNPP: false,
      economicPosition: 1,
      socialPosition: -1,
      favorability: 55,
      politicalInfluence: 30,
      overallAppeal: 22,
      totalPotentialVoters: 40_000,
      totalEstimatedVoters: 60_000,
    },
  ],
};

describe("ElectionComparisonPanel", () => {
  it("colors each candidate by its party and reports the lead", () => {
    render(
      <ElectionComparisonPanel
        electionContext={context}
        myPotentialVoters={60_000}
        myAppeal={30}
        myParty="3"
        partyColors={{ "3": "#112233", "7": "#aabbcc" }}
      />
    );
    expect(screen.getByText(/You lead Rival One/)).toBeTruthy();
    expect(screen.getByText(/by 20K votes/)).toBeTruthy();
    const pool = screen.getByRole("img", { name: /Combined pool/ });
    const widths = Array.from(pool.children).map((c) => (c as HTMLElement).style.backgroundColor);
    expect(widths).toEqual(["#112233", "#aabbcc"]);
  });

  it("says trailing when the rival is ahead", () => {
    render(
      <ElectionComparisonPanel
        electionContext={context}
        myPotentialVoters={10_000}
        myAppeal={10}
        myParty="3"
      />
    );
    expect(screen.getByText(/You trail Rival One/)).toBeTruthy();
  });
});

describe("PollTrendChart", () => {
  it("asks for a second poll before drawing", () => {
    render(<PollTrendChart polls={[entry(20, "2026-01-01T00:00:00Z")]} />);
    expect(screen.getByText(/Commission another poll/)).toBeTruthy();
  });

  it("plots oldest to newest with labeled axes and the net change", () => {
    render(
      <PollTrendChart
        polls={[entry(30, "2026-01-03T00:00:00Z"), entry(20, "2026-01-02T00:00:00Z")]}
      />
    );
    const chart = screen.getByRole("img", { name: /from 20.0 to 30.0/ });
    expect(
      within(chart as unknown as HTMLElement).getByText("Poll number, oldest to newest")
    ).toBeTruthy();
    expect(screen.getByText(/Up 10.0 since the oldest/)).toBeTruthy();
    expect(screen.getByText("Overall appeal (0 to 50)")).toBeTruthy();
  });
});

describe("StatCards", () => {
  it("leads with appeal and its band, then the voter counts", () => {
    const poll = {
      takenAt: "2026-01-01T00:00:00Z",
      overallAppeal: 36.2,
      totalEstimatedVoters: 200_000,
      totalPotentialVoters: 50_000,
      topGroups: [],
      bottomGroups: [],
    } as StoredPoll;
    render(<StatCards poll={poll} />);
    expect(screen.getByText("36.2")).toBeTruthy();
    expect(screen.getByText("Strong")).toBeTruthy();
    expect(screen.getByText("25.0% of estimated voters")).toBeTruthy();
  });
});
