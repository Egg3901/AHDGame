/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { CountryId } from "@/lib/constants/countries";
import { FomcCommitteeTab } from "./FomcCommitteeTab";

vi.mock("@/components/PlayerSelector", () => ({
  PlayerSelector: () => <div data-testid="player-selector" />,
}));

function boardSeat(i: number, vacant: boolean): Record<string, unknown> {
  return {
    seatId: `seat-${i + 1}`,
    isChair: i === 0,
    occupantType: vacant ? "vacant" : i === 0 ? "player" : "npp",
    name: vacant ? "Vacant" : i === 0 ? "Poppy" : `Governor ${i + 1}`,
    alignment: "hawk",
    termExpiresAtTurn: vacant ? null : 900,
  };
}

function committeePayload(vacantCount: number): Record<string, unknown> {
  return {
    hasCommittee: true,
    primeRate: 4.65,
    rateChangesThisTerm: 3,
    rateChangesPerTerm: 16,
    currentTurn: 514,
    nextMeetingAtTurn: 518,
    termEndsAtTurn: 576,
    majorityNeeded: 4,
    meetingHistory: [],
    canNominate: false,
    viewerIsSenator: false,
    nominations: [],
    viewerSeatId: vacantCount === 6 ? "seat-1" : null,
    // Prod shape at ticket #1238: chair seated, the rest vacant.
    board: Array.from({ length: 7 }, (_, i) => boardSeat(i, i > 0 && i <= vacantCount)),
    meeting: null,
  };
}

function mockFetch(payload: Record<string, unknown>) {
  global.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  ) as unknown as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FomcCommitteeTab — understaffed board (ticket #1238)", () => {
  it("shows why motions cannot pass when most seats are vacant", async () => {
    mockFetch(committeePayload(6));

    render(<FomcCommitteeTab countryId={"US" as CountryId} />);

    await waitFor(() => expect(screen.getByText("Board understaffed")).toBeTruthy());
    expect(screen.getByText(/6 of 7 board seats are vacant/)).toBeTruthy();
    expect(screen.getByText(/no motion can carry/)).toBeTruthy();
    expect(screen.getByText(/presidential nomination and Senate confirmation/)).toBeTruthy();
  });

  it("stays quiet on a fully staffed board", async () => {
    mockFetch(committeePayload(0));

    render(<FomcCommitteeTab countryId={"US" as CountryId} />);

    await waitFor(() => expect(screen.getByText("Board of Governors")).toBeTruthy());
    expect(screen.queryByText("Board understaffed")).toBeNull();
  });
});
