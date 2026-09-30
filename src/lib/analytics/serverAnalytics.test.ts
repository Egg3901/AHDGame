import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ captureServerGameEvent: vi.fn().mockResolvedValue(undefined) }));

vi.mock("./serverPosthog", () => ({ captureServerGameEvent: state.captureServerGameEvent }));
vi.mock("@/lib/constants/countries", () => ({ COUNTRY_CONFIGS: { US: { officeTypes: [] } } }));

describe("server game analytics", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("emits aggregate election phases with scalar, system-identified fields", async () => {
    const { captureElectionResolved } = await import("./electionAnalytics");
    await captureElectionResolved({
      db: {} as never,
      electionId: "0123456789abcdef01234567",
      electionType: "president",
      phase: "primary",
      scope: "national",
      candidateCount: 6,
      playerCandidateCount: 3,
      turnoutPct: "unknown",
      seatsAvailable: 2,
      nationId: "US",
      turn: 12,
    });

    expect(state.captureServerGameEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "election_resolved",
        distinctId: "system:election-outcomes",
        insertId: "election-resolved:0123456789abcdef01234567:primary",
        properties: expect.objectContaining({
          election_id: "0123456789abcdef01234567",
          election_type: "president",
          phase: "primary",
          scope: "national",
          candidate_count: 6,
          player_candidate_count: 3,
          turnout_pct: "unknown",
          seats_available: 2,
        }),
      })
    );
  });

  it("enriches server election wins using an opaque account identity", async () => {
    const { captureElectionWon } = await import("./electionAnalytics");
    await captureElectionWon({
      db: {} as never,
      accountId: "opaque-account-id",
      electionId: "0123456789abcdef01234567",
      electionType: "house",
      partyId: "4",
      seatCount: 2,
      voteSharePct: 42.123,
      marginPct: 8.456,
      incumbent: true,
      nationId: "US",
      turn: 12,
    });

    expect(state.captureServerGameEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "election_won",
        distinctId: "opaque-account-id",
        properties: expect.objectContaining({
          election_id: "0123456789abcdef01234567",
          election_type: "house",
          party_id: "4",
          seat_count: 2,
          vote_share_pct: 42.12,
          margin_pct: 8.46,
          incumbent: true,
        }),
      })
    );
  });

  it("does not report an unknown completed tenure as zero turns", async () => {
    const { captureOfficeTransition } = await import("./officeTransitionAnalytics");
    await captureOfficeTransition({
      db: {} as never,
      officeType: "president",
      transitionType: "left",
      selectionMethod: "resignation",
      tenureTurns: 0,
      turn: 12,
    });
    expect(state.captureServerGameEvent).toHaveBeenCalledWith(
      expect.objectContaining({ properties: expect.objectContaining({ tenure_turns: "unknown" }) })
    );
  });

  it("reduces office types and bill taxonomies to controlled values", async () => {
    const { captureOfficeTransition } = await import("./officeTransitionAnalytics");
    const { captureBillStatusChanged } = await import("./billStatusAnalytics");

    await captureOfficeTransition({
      db: {} as never,
      officeType: "player supplied title",
      transitionType: "gained",
      selectionMethod: "appointment",
      turn: 12,
    });
    await captureBillStatusChanged({
      db: {} as never,
      billId: "0123456789abcdef01234567",
      fromStatus: "vote_closing",
      toStatus: "enacted",
      scope: "national",
      chamber: "private chamber text",
      category: "private category text",
      provisionFamily: "free form provision",
      voteMargin: 3,
      turn: 12,
    });

    expect(state.captureServerGameEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        event: "office_transition",
        properties: expect.objectContaining({
          office_type: "other",
          transition_type: "gained",
          party_id: "unknown",
          selection_method: "appointment",
          tenure_turns: 0,
          career_stage: 0,
        }),
      })
    );
    expect(state.captureServerGameEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        event: "bill_status_changed",
        properties: expect.objectContaining({
          bill_id: "0123456789abcdef01234567",
          from_status: "vote_closing",
          to_status: "enacted",
          scope: "national",
          chamber: "other",
          category: "other",
          provision_family: "other",
          vote_margin: 3,
        }),
      })
    );
    expect(JSON.stringify(state.captureServerGameEvent.mock.calls)).not.toContain("private");
    expect(JSON.stringify(state.captureServerGameEvent.mock.calls)).not.toContain("free form");
  });

  it("emits bill_passed from the enactment path with a stable dedupe key", async () => {
    const { captureBillPassed } = await import("./billStatusAnalytics");
    await captureBillPassed({
      db: {} as never,
      billId: "0123456789abcdef01234567",
      scope: "regional",
      nationId: "UK",
      turn: 12,
    });

    expect(state.captureServerGameEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "bill_passed",
        distinctId: "system:bill-lifecycle",
        insertId: "bill-passed:0123456789abcdef01234567",
        nationId: "UK",
        properties: {
          bill_id: "0123456789abcdef01234567",
          scope: "regional",
        },
      })
    );
  });
});
