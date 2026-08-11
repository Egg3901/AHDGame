/** @vitest-environment happy-dom */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { BillCard } from "./BillCard";
import type { BillDisplay } from "@/lib/legislature/dto/billDisplay";

// Heavy / interactive children are irrelevant to the deadline-badge logic under test.
vi.mock("./BillVoteIndicator", () => ({ BillVoteIndicator: () => null }));
vi.mock("@/components/time/LocalTime", () => ({ LocalTime: () => null }));

// Drive the game clock: currentTurn lets us cross the override deadline turn.
let mockClock = { realNow: new Date("2026-07-10T15:46:00Z"), currentTurn: 996 };
vi.mock("@/contexts/useGameClock", () => ({
  useGameClock: () => mockClock,
}));

function overrideBill(overrides: Partial<BillDisplay> = {}): BillDisplay {
  return {
    id: "bill1",
    title: "Gun Freedom Act",
    summary: "KEEP GUNS IN EVERYBODYS HANDS",
    originChamber: "senate",
    currentChamber: "senate",
    sponsorId: null,
    sponsorName: "Mary Bishop",
    sponsorParty: "2",
    sponsorPartyName: "2",
    sponsorPartyColor: "#6b7280",
    status: "veto_override",
    votesFor: 21,
    votesAgainst: 17,
    votesAbstain: 0,
    totalVotes: 38,
    otherChamberVotesFor: 0,
    otherChamberVotesAgainst: 0,
    otherChamberVotesAbstain: 0,
    category: "",
    legislationTypeId: null,
    legislationTypeName: null,
    effectDirection: null,
    directionLabel: null,
    positionLabel: null,
    effectTargetLabel: null,
    provisions: undefined,
    proposedAt: "2026-07-08T11:00:13.788Z",
    votingStartedAt: "2026-07-08T11:00:13.788Z",
    // Mapped from the override deadline for state bills.
    votingEndsAt: "2026-07-10T15:18:38.325Z",
    votingEndsOnTurn: 996,
    otherChamberVotingEndsAt: null,
    otherChamberVotingEndsOnTurn: null,
    passedAt: null,
    enactedAt: null,
    myVote: null,
    myOtherChamberVote: null,
    canVoteOrigin: false,
    canVoteOther: false,
    requiresExecutiveAction: false,
    failedAt: null,
    ...overrides,
  } as BillDisplay;
}

afterEach(() => {
  cleanup();
  mockClock = { realNow: new Date("2026-07-10T15:46:00Z"), currentTurn: 996 };
});

describe("BillCard override deadline (ticket #936)", () => {
  it("shows a muted 'Voting Closed' pill once the state override deadline turn passes", () => {
    // currentTurn 996 >= votingEndsOnTurn 996 -> deadline passed, awaiting resolution turn.
    render(<BillCard bill={overrideBill()} timelineVariant="state" />);
    expect(screen.getByText("Voting Closed")).toBeTruthy();
    expect(screen.queryByText("Override Vote")).toBeNull();
  });

  it("still shows the live 'Override Vote' pill before the deadline turn", () => {
    mockClock = { realNow: new Date("2026-07-09T16:00:00Z"), currentTurn: 990 };
    render(<BillCard bill={overrideBill()} timelineVariant="state" />);
    expect(screen.getByText("Override Vote")).toBeTruthy();
    expect(screen.queryByText("Voting Closed")).toBeNull();
  });

  it("does not apply the state override deadline gate to national bills", () => {
    // National override bills do not expose the override deadline on votingEndsAt,
    // so the gate must not flip them to 'Voting Closed' off the origin-vote deadline.
    render(<BillCard bill={overrideBill()} timelineVariant="national" />);
    expect(screen.getByText("Override Vote")).toBeTruthy();
    expect(screen.queryByText("Voting Closed")).toBeNull();
  });
});

describe("BillCard sponsor profile link", () => {
  it("links the sponsor name to /character/{sequentialId} when available", () => {
    render(
      <BillCard
        bill={overrideBill({
          status: "signed",
          sponsorId: "aaaaaaaaaaaaaaaaaaaaaaaa",
          sponsorSequentialId: 42,
          sponsorName: "Kimberly Kowalski",
        })}
      />
    );
    const link = screen.getByRole("link", { name: "Kimberly Kowalski" });
    expect(link.getAttribute("href")).toBe("/character/42");
  });

  it("falls back to sponsor ObjectId when sequentialId is absent", () => {
    render(
      <BillCard
        bill={overrideBill({
          status: "signed",
          sponsorId: "bbbbbbbbbbbbbbbbbbbbbbbb",
          sponsorName: "Jane Doe",
        })}
      />
    );
    const link = screen.getByRole("link", { name: "Jane Doe" });
    expect(link.getAttribute("href")).toBe("/character/bbbbbbbbbbbbbbbbbbbbbbbb");
  });

  it("keeps the sponsor as plain text when there is no sponsorId", () => {
    render(<BillCard bill={overrideBill({ status: "signed", sponsorId: null })} />);
    expect(screen.queryByRole("link", { name: "Mary Bishop" })).toBeNull();
    expect(screen.getByText("Mary Bishop")).toBeTruthy();
  });
});
