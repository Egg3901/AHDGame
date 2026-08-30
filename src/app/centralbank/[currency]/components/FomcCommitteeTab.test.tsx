/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FomcCommitteeTab } from "./FomcCommitteeTab";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("FomcCommitteeTab active meeting", () => {
  it("shows when an undecided vote will force-resolve", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          hasCommittee: true,
          primeRate: 5,
          rateChangesThisTerm: 0,
          rateChangesPerTerm: 16,
          currentTurn: 486,
          nextMeetingAtTurn: null,
          termEndsAtTurn: 600,
          meetingHistory: [],
          canNominate: false,
          viewerIsSenator: false,
          nominations: [],
          viewerSeatId: "seat-1",
          board: [],
          meeting: {
            motion: "cut",
            proposedDelta: -0.75,
            playerVoteDeadline: "2026-08-30T22:00:00.000Z",
            resolvesOnTurn: 509,
            agree: 0,
            disagree: 1,
            needed: 4,
            viewerHasVoted: true,
            viewerCanVote: false,
          },
        }),
      })
    );

    render(<FomcCommitteeTab countryId="US" />);

    await waitFor(() =>
      expect(
        screen.getByText(/closes by turn 509 or 30 Aug 2026, 22:00 UTC, whichever comes first/i)
      ).toBeTruthy()
    );
  });
});
