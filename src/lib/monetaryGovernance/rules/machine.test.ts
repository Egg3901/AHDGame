/**
 * Behaviour tests for the monetary governance state machine.
 *
 * These capture the CURRENT intended behaviour (mirroring fomcMeetingTurn,
 * updatePrimeRate and the rate/fomc route tests) before any production code
 * is routed through the machine. The machine must satisfy every case here.
 */

import { describe, expect, it } from "vitest";
import { RATE_CHANGES_PER_TERM } from "@/lib/db/types/centralBank";
import { decideGovernance, normalizedRateChoices } from "./machine";
import { allowedActionsFor } from "./allowedActions";
import type {
  GovernanceActor,
  GovernanceClock,
  JurisdictionState,
  MacroInputs,
  MeetingState,
  SeatState,
} from "./types";

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const MACRO: MacroInputs = {
  neutralRate: 3,
  inflationRate: 5,
  targetInflation: 2,
  gdpGrowth: 2,
};

const SYSTEM: GovernanceActor = { kind: "system" };
const CHAIR: GovernanceActor = { kind: "chair", characterId: "char-chair", countryId: "US" };
const GOVERNMENT: GovernanceActor = {
  kind: "government",
  characterId: "char-gov",
  countryId: "UK",
};
const ADMIN: GovernanceActor = { kind: "admin", characterId: "char-admin" };

function clock(turn: number, now: number = NOW): GovernanceClock {
  return { turn, now, currentYear: 1960 };
}

function seat(seatId: string, overrides: Partial<SeatState> = {}): SeatState {
  return {
    seatId,
    isChair: false,
    occupantType: "npp",
    characterId: null,
    alignment: "hawk",
    termExpiresAtTurn: 900,
    ...overrides,
  };
}

function playerChair(): SeatState {
  return seat("seat-1", {
    isChair: true,
    occupantType: "player",
    characterId: "char-chair",
  });
}

function usBoard(): SeatState[] {
  return [
    playerChair(),
    seat("seat-2"),
    seat("seat-3"),
    seat("seat-4"),
    seat("seat-5"),
    seat("seat-6"),
    seat("seat-7"),
  ];
}

function vacantSeat(seatId: string): SeatState {
  return seat(seatId, { occupantType: "vacant", characterId: null, termExpiresAtTurn: null });
}

/** A voting meeting with all 6 NPP seats agreeing on a hike. */
function nppMajorityMeeting(openedTurn: number): MeetingState {
  return {
    meetingId: `US-m${openedTurn}`,
    openedAtTurn: openedTurn,
    motion: "hike",
    proposedDelta: 0.5,
    status: "voting",
    ballots: ["seat-2", "seat-3", "seat-4", "seat-5", "seat-6", "seat-7"].map((seatId) => ({
      seatId,
      vote: "hike" as const,
      auto: true,
    })),
    resolvesOnTurn: openedTurn + 24,
    playerVoteDeadlineMs: NOW + DAY,
  };
}

function baseState(overrides: Partial<JurisdictionState> = {}): JurisdictionState {
  return {
    institutionId: "US",
    currency: "USD",
    memberCountryIds: ["US"],
    anchorCountryId: "US",
    committeeBank: true,
    governmentControlled: false,
    primeRate: 5,
    chairInfamy: 0,
    board: usBoard(),
    activeMeeting: null,
    rateChangesThisTerm: 0,
    termStartedAtTurn: 100,
    lastMeetingTurn: 100,
    lastRateChangeTurn: null,
    chairCharacterId: "char-chair",
    controlsLocked: false,
    chairSelectionPending: false,
    fxCommitment: null,
    commandEconomy: false,
    lastVacancyNoticeAtTurn: null,
    ...overrides,
  };
}

function turnStart(state: JurisdictionState, turn: number, macro: MacroInputs | undefined = MACRO) {
  return decideGovernance(
    state,
    { type: "turn_start", turn, now: NOW, macro, countryId: "US" },
    SYSTEM,
    clock(turn)
  );
}

describe("cadence", () => {
  it("opens a meeting when due and the board can carry a motion", () => {
    const decision = turnStart(baseState(), 108);
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) return;
    expect(decision.next.activeMeeting?.status).toBe("voting");
    expect(decision.next.activeMeeting?.openedAtTurn).toBe(108);
    expect(decision.next.activeMeeting?.resolvesOnTurn).toBe(132);
    expect(decision.next.lastMeetingTurn).toBe(108);
    expect(decision.transition.set.lastFomcMeetingTurn).toBe(108);
    const kinds = decision.transition.events.map((e) => `${e.kind}:${e.command}`);
    expect(kinds).toContain("meeting.transitioned:monetary.meeting.open");
  });

  it("does not open before the interval elapses", () => {
    const decision = turnStart(baseState(), 104);
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) return;
    expect(decision.next.activeMeeting).toBeNull();
    expect(decision.transition.set.activeFomcMeeting).toBeUndefined();
  });

  it("never resolves a meeting on the turn it opened", () => {
    const decision = turnStart(baseState({ lastMeetingTurn: 100 }), 108);
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) return;
    expect(decision.next.activeMeeting?.status).toBe("voting");
    expect(decision.transition.set.meetingHistoryAppend).toBeUndefined();
    expect(decision.transition.set.primeRate).toBeUndefined();
  });
});

describe("vote window and deadlines", () => {
  it("keeps a decided meeting open while a player ballot is pending", () => {
    const state = baseState({ activeMeeting: nppMajorityMeeting(108), lastMeetingTurn: 108 });
    const decision = turnStart(state, 109);
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) return;
    expect(decision.next.activeMeeting?.status).toBe("voting");
    expect(decision.transition.set.meetingHistoryAppend).toBeUndefined();
    expect(decision.transition.set.primeRate).toBeUndefined();
  });

  it("force-resolves at the deadline with the no-show abstaining", () => {
    const state = baseState({ activeMeeting: nppMajorityMeeting(108), lastMeetingTurn: 108 });
    const decision = turnStart(state, 132);
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) return;
    expect(decision.next.activeMeeting).toBeNull();
    expect(decision.transition.set.activeFomcMeeting).toBeNull();
    expect(decision.next.primeRate).toBe(5.5);
    expect(decision.next.rateChangesThisTerm).toBe(1);
    const kinds = decision.transition.events.map((e) => e.kind);
    expect(kinds).toContain("meeting.transitioned");
    expect(kinds).toContain("policy.rate_changed");
  });

  it("refuses a resolve command on the opening turn", () => {
    const state = baseState({ activeMeeting: nppMajorityMeeting(108), lastMeetingTurn: 108 });
    const decision = decideGovernance(
      state,
      { type: "resolve_meeting", countryId: "US" },
      SYSTEM,
      clock(108)
    );
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.reason).toBe("too-early");
  });

  it("refuses a ballot after the deadline", () => {
    const state = baseState({ activeMeeting: nppMajorityMeeting(100), lastMeetingTurn: 100 });
    const decision = decideGovernance(
      state,
      { type: "cast_ballot", seatId: "seat-1", vote: "hike", countryId: "US" },
      { kind: "governor", seatId: "seat-1", characterId: "char-chair", countryId: "US" },
      clock(125)
    );
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.reason).toBe("deadline-passed");
  });

  it("resolves when the last pending player ballots", () => {
    const state = baseState({ activeMeeting: nppMajorityMeeting(108), lastMeetingTurn: 108 });
    const decision = decideGovernance(
      state,
      { type: "cast_ballot", seatId: "seat-1", vote: "cut", countryId: "US" },
      { kind: "governor", seatId: "seat-1", characterId: "char-chair", countryId: "US" },
      clock(109)
    );
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) return;
    expect(decision.next.activeMeeting).toBeNull();
    expect(decision.next.primeRate).toBe(5.5);
    const voted = decision.transition.events.find((e) => e.kind === "meeting.voted");
    expect(voted?.outcome).toBe("ok");
  });

  it("keeps the meeting open while another player seat is still pending", () => {
    const board = [
      ...usBoard(),
      seat("seat-8", { occupantType: "player", characterId: "char-other" }),
    ];
    const state = baseState({
      board,
      activeMeeting: nppMajorityMeeting(108),
      lastMeetingTurn: 108,
    });
    const decision = decideGovernance(
      state,
      { type: "cast_ballot", seatId: "seat-1", vote: "hike", countryId: "US" },
      { kind: "governor", seatId: "seat-1", characterId: "char-chair", countryId: "US" },
      clock(109)
    );
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) return;
    expect(decision.next.activeMeeting?.status).toBe("voting");
    expect(decision.transition.set.primeRate).toBeUndefined();
  });
});

describe("dead board", () => {
  function deadBoardState(): JurisdictionState {
    return baseState({
      board: [
        playerChair(),
        vacantSeat("seat-2"),
        vacantSeat("seat-3"),
        vacantSeat("seat-4"),
        vacantSeat("seat-5"),
        vacantSeat("seat-6"),
        vacantSeat("seat-7"),
      ],
    });
  }

  it("opens no meeting when the board cannot carry a motion", () => {
    const decision = turnStart(deadBoardState(), 108);
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) return;
    expect(decision.next.activeMeeting).toBeNull();
    expect(decision.transition.set.lastFomcMeetingTurn).toBeUndefined();
  });

  it("gives the chair fallback authority on a dead board", () => {
    const decision = decideGovernance(
      deadBoardState(),
      { type: "set_rate", rate: 4.75, countryId: "US" },
      CHAIR,
      clock(108)
    );
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) return;
    expect(decision.next.primeRate).toBe(4.75);
    expect(decision.next.rateChangesThisTerm).toBe(1);
  });
});

describe("term rollover and caps", () => {
  it("resets the per-term budget when the term elapses", () => {
    const decision = turnStart(
      baseState({ termStartedAtTurn: 100, rateChangesThisTerm: 16, lastMeetingTurn: 300 }),
      292
    );
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) return;
    expect(decision.next.termStartedAtTurn).toBe(292);
    expect(decision.next.rateChangesThisTerm).toBe(0);
  });

  it("refuses a direct set once the term budget is spent", () => {
    const decision = decideGovernance(
      baseState({ board: [], rateChangesThisTerm: 16 }),
      { type: "set_rate", rate: 5.25, countryId: "US" },
      CHAIR,
      clock(108)
    );
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.reason).toBe("term-cap");
  });

  it("refuses a direct set on cooldown", () => {
    const decision = decideGovernance(
      baseState({ board: [], lastRateChangeTurn: 105 }),
      { type: "set_rate", rate: 5.25, countryId: "US" },
      CHAIR,
      clock(108)
    );
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.reason).toBe("cooldown");
  });

  it("refuses hikes beyond the delta cap and cuts beyond the cut cap", () => {
    const hike = decideGovernance(
      baseState({ board: [] }),
      { type: "set_rate", rate: 6, countryId: "US" },
      CHAIR,
      clock(108)
    );
    expect(hike.allowed).toBe(false);
    if (hike.allowed) return;
    expect(hike.reason).toBe("delta-hike");

    const cut = decideGovernance(
      baseState({ board: [] }),
      { type: "set_rate", rate: 3, countryId: "US" },
      CHAIR,
      clock(108)
    );
    expect(cut.allowed).toBe(false);
    if (cut.allowed) return;
    expect(cut.reason).toBe("delta-cut");
  });

  it("applies aggressive-cut scrutiny to an oversized cut", () => {
    const decision = decideGovernance(
      baseState({ board: [], chairInfamy: 5 }),
      { type: "set_rate", rate: 3.5, countryId: "US" },
      CHAIR,
      clock(108)
    );
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) return;
    expect(decision.next.primeRate).toBe(3.5);
    expect(decision.next.chairInfamy).toBe(15);
    const event = decision.transition.events.find((e) => e.kind === "policy.rate_changed");
    expect(event?.meta?.scrutinyApplied).toBe(true);
  });
});

describe("authority", () => {
  it("refuses a chair direct set while a functional committee sits", () => {
    const decision = decideGovernance(
      baseState(),
      { type: "set_rate", rate: 5.25, countryId: "US" },
      CHAIR,
      clock(108)
    );
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.reason).toBe("committee-decides");
  });

  it("lets the government set the rate on a government-controlled bank", () => {
    const state = baseState({
      institutionId: "UK",
      memberCountryIds: ["UK", "SCO", "WAL"],
      anchorCountryId: "UK",
      committeeBank: false,
      governmentControlled: true,
      board: [],
    });
    const gov = decideGovernance(
      state,
      { type: "set_rate", rate: 4.75, countryId: "UK" },
      GOVERNMENT,
      clock(108)
    );
    expect(gov.allowed).toBe(true);
    if (!gov.allowed) return;
    expect(gov.next.primeRate).toBe(4.75);
    const event = gov.transition.events.find((e) => e.kind === "policy.rate_changed");
    expect(event?.meta?.interferenceApplied).toBe(true);

    const chair = decideGovernance(
      state,
      { type: "set_rate", rate: 4.75, countryId: "UK" },
      CHAIR,
      clock(108)
    );
    expect(chair.allowed).toBe(false);
    if (chair.allowed) return;
    expect(chair.reason).toBe("not-authorized");
  });

  it("holds no meetings on a government-controlled bank", () => {
    const decision = turnStart(
      baseState({ governmentControlled: true, lastMeetingTurn: 100 }),
      108
    );
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) return;
    expect(decision.next.activeMeeting).toBeNull();
  });

  it.each(["cast_ballot", "resolve_meeting", "meeting_deadline"] as const)(
    "refuses %s on an existing meeting after independence is revoked",
    (type) => {
      const state = baseState({
        governmentControlled: true,
        activeMeeting: nppMajorityMeeting(100),
      });
      const command =
        type === "cast_ballot"
          ? { type, seatId: "seat-1", vote: "hike" as const, countryId: "US" }
          : type === "resolve_meeting"
            ? { type, force: true, countryId: "US" }
            : { type, turn: 124, now: NOW + DAY, countryId: "US" };

      const decision = decideGovernance(state, command, CHAIR, clock(108));

      expect(decision).toMatchObject({ allowed: false, reason: "government-controlled" });
      expect(state.primeRate).toBe(5);
    }
  );

  it("lets an admin override a seated committee, spending a term move", () => {
    const decision = decideGovernance(
      baseState({ rateChangesThisTerm: 3 }),
      { type: "set_rate", rate: 5.25, countryId: "US" },
      ADMIN,
      clock(108)
    );
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) return;
    expect(decision.next.primeRate).toBe(5.25);
    expect(decision.next.rateChangesThisTerm).toBe(4);
  });

  it("refuses commands from outside the jurisdiction membership", () => {
    const decision = decideGovernance(
      baseState(),
      { type: "set_rate", rate: 5.25, countryId: "DE" },
      CHAIR,
      clock(108)
    );
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.reason).toBe("not-member");
  });

  it("refuses committee actions for non-committee institutions", () => {
    const state = baseState({ institutionId: "ECB", committeeBank: false, board: [] });
    const open = decideGovernance(
      state,
      { type: "open_meeting", macro: MACRO },
      SYSTEM,
      clock(108)
    );
    expect(open.allowed).toBe(false);
    if (open.allowed) return;
    expect(open.reason).toBe("no-committee");

    const ballot = decideGovernance(
      state,
      { type: "cast_ballot", seatId: "seat-1", vote: "hike" },
      SYSTEM,
      clock(108)
    );
    expect(ballot.allowed).toBe(false);
    if (ballot.allowed) return;
    expect(ballot.reason).toBe("no-committee");
  });
});

describe("seats and vacancies", () => {
  it("vacates expired seats with no auto-seating and flags a chair vacancy", () => {
    const board = [
      seat("seat-1", { isChair: true, termExpiresAtTurn: 109 }),
      seat("seat-2", { termExpiresAtTurn: 900 }),
    ];
    const decision = turnStart(baseState({ board, lastMeetingTurn: 108 }), 109);
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) return;
    const chair = decision.next.board.find((s) => s.isChair);
    expect(chair?.occupantType).toBe("vacant");
    expect(chair?.termExpiresAtTurn).toBeNull();
    expect(decision.transition.set.vacancyAwaitingAutomaticSelection).toBe(true);
    expect(decision.transition.set.chairCharacterId).toBeNull();
  });

  it("does not re-flag a vacancy while a player offer is pending", () => {
    const board = [
      seat("seat-1", { isChair: true, termExpiresAtTurn: 109 }),
      seat("seat-2", { termExpiresAtTurn: 900 }),
    ];
    const decision = turnStart(
      baseState({ board, lastMeetingTurn: 108, chairSelectionPending: true }),
      109
    );
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) return;
    expect(decision.transition.set.vacancyAwaitingAutomaticSelection).toBeUndefined();
  });

  it("notifies once on new vacancies and throttles repeats", () => {
    const board = [playerChair(), vacantSeat("seat-2")];
    const first = turnStart(baseState({ board, lastMeetingTurn: 108 }), 109);
    expect(first.allowed).toBe(true);
    if (!first.allowed) return;
    expect(first.transition.notifications).toHaveLength(1);
    expect(first.transition.notifications[0].kind).toBe("vacancy_notice");
    expect(first.transition.set.lastFomcVacancyNoticeAtTurn).toBe(109);

    const second = turnStart({ ...first.next, lastMeetingTurn: 109, activeMeeting: null }, 110);
    expect(second.allowed).toBe(true);
    if (!second.allowed) return;
    expect(second.transition.notifications).toHaveLength(0);
  });

  it("waits while a nomination is before the Senate", () => {
    const board = [playerChair(), vacantSeat("seat-2")];
    const state = baseState({ board, lastMeetingTurn: 108 });
    const decision = decideGovernance(
      state,
      { type: "turn_start", turn: 109, now: NOW, macro: MACRO, hasActiveNomination: true },
      SYSTEM,
      clock(109)
    );
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) return;
    expect(decision.transition.notifications).toHaveLength(0);
  });
});

describe("replay and grid", () => {
  it("refuses the same ballot twice with an already reason", () => {
    const state = baseState({ activeMeeting: nppMajorityMeeting(108), lastMeetingTurn: 108 });
    const actor = {
      kind: "governor",
      seatId: "seat-1",
      characterId: "char-chair",
      countryId: "US",
    } as const;
    const first = decideGovernance(
      {
        ...state,
        board: [
          ...state.board,
          seat("seat-8", { occupantType: "player", characterId: "char-other" }),
        ],
      },
      { type: "cast_ballot", seatId: "seat-1", vote: "hike", countryId: "US" },
      actor,
      clock(109)
    );
    expect(first.allowed).toBe(true);
    if (!first.allowed) return;
    const second = decideGovernance(
      first.next,
      { type: "cast_ballot", seatId: "seat-1", vote: "hike", countryId: "US" },
      actor,
      clock(109)
    );
    expect(second.allowed).toBe(false);
    if (second.allowed) return;
    expect(second.reason).toContain("already");
  });

  it("refuses a repeat set at the current rate with an already reason", () => {
    const state = baseState({ board: [] });
    const first = decideGovernance(
      state,
      { type: "set_rate", rate: 5.25, countryId: "US" },
      CHAIR,
      clock(108)
    );
    expect(first.allowed).toBe(true);
    if (!first.allowed) return;
    const second = decideGovernance(
      first.next,
      { type: "set_rate", rate: 5.25, countryId: "US" },
      CHAIR,
      clock(114)
    );
    expect(second.allowed).toBe(false);
    if (second.allowed) return;
    expect(second.reason).toContain("already");
  });

  it("refuses a second resolve with an already reason", () => {
    const state = baseState({ activeMeeting: nppMajorityMeeting(100), lastMeetingTurn: 100 });
    const atDeadline = turnStart(state, 124);
    expect(atDeadline.allowed).toBe(true);
    if (!atDeadline.allowed) return;
    expect(atDeadline.next.activeMeeting).toBeNull();
    const again = decideGovernance(
      atDeadline.next,
      { type: "resolve_meeting", countryId: "US" },
      SYSTEM,
      clock(125)
    );
    expect(again.allowed).toBe(false);
    if (again.allowed) return;
    expect(again.reason).toContain("already");
  });

  it("accepts a valid on-grid action on a bank with an off-grid stored rate", () => {
    const decision = decideGovernance(
      baseState({ board: [], primeRate: 4.1 }),
      { type: "set_rate", rate: 4.25, countryId: "US" },
      CHAIR,
      clock(108)
    );
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) return;
    expect(decision.next.primeRate).toBe(4.25);
  });

  it("snaps committee moves onto the grid", () => {
    const state = baseState({
      primeRate: 4.13,
      activeMeeting: nppMajorityMeeting(100),
      lastMeetingTurn: 100,
    });
    const decision = turnStart(state, 124);
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) return;
    expect(decision.next.primeRate).toBe(4.75);
  });
});

describe("allowedActionsFor", () => {
  it.each([
    { lastRateChangeTurn: 107 },
    { rateChangesThisTerm: RATE_CHANGES_PER_TERM },
    { commandEconomy: true },
    { fxCommitment: { regime: "peg" as const, capitalControls: false } },
  ])("applies rate restrictions to the government: %j", (restriction) => {
    const state = baseState({
      institutionId: "UK",
      memberCountryIds: ["UK"],
      anchorCountryId: "UK",
      governmentControlled: true,
      ...restriction,
    });
    const view = allowedActionsFor(state, GOVERNMENT, clock(108));
    expect(view.actions.find((action) => action.action === "set_rate")?.allowed).toBe(false);
    expect(
      decideGovernance(state, { type: "set_rate", rate: 5.25 }, GOVERNMENT, clock(108)).allowed
    ).toBe(false);
  });

  it("hides ballot and resolution actions when an existing committee becomes dormant", () => {
    const view = allowedActionsFor(
      baseState({ governmentControlled: true, activeMeeting: nppMajorityMeeting(100) }),
      { ...CHAIR, seatId: "seat-1" },
      clock(108)
    );
    for (const action of ["open_meeting", "cast_ballot", "resolve_meeting"]) {
      expect(view.actions.find((item) => item.action === action)).toMatchObject({
        allowed: false,
        reason: expect.stringMatching(/government/),
      });
    }
  });

  it("lists every action with reasons, the next deadline and rate choices", () => {
    const state = baseState({ activeMeeting: nppMajorityMeeting(108), lastMeetingTurn: 108 });
    const view = allowedActionsFor(
      state,
      { kind: "governor", seatId: "seat-1", characterId: "char-chair", countryId: "US" },
      clock(109)
    );
    expect(view.actions.map((a) => a.action).sort()).toEqual(
      ["cast_ballot", "open_meeting", "resolve_meeting", "set_rate"].sort()
    );
    const ballot = view.actions.find((a) => a.action === "cast_ballot");
    expect(ballot?.allowed).toBe(true);
    expect(ballot?.deadlineTurn).toBe(132);
    const setRate = view.actions.find((a) => a.action === "set_rate");
    expect(setRate?.allowed).toBe(false);
    expect(setRate?.reason).toBeTruthy();
    expect(view.nextDeadline).toEqual({ turn: 132, kind: "meeting_deadline" });
    expect(view.normalizedRateChoices.length).toBeGreaterThan(0);
    expect(view.primeRateOnGrid).toBe(5);
  });

  it("reports the cadence deadline when no meeting is active", () => {
    const view = allowedActionsFor(baseState({ lastMeetingTurn: 100 }), CHAIR, clock(104));
    expect(view.nextDeadline).toEqual({ turn: 108, kind: "cadence" });
  });

  it("refuses everything for a non-member viewpoint", () => {
    const view = allowedActionsFor(baseState(), { kind: "chair", countryId: "DE" }, clock(108));
    expect(view.actions.every((a) => !a.allowed)).toBe(true);
  });

  it("builds rate choices from the snapped stored rate", () => {
    const choices = normalizedRateChoices(baseState({ primeRate: 4.13 }));
    expect(choices).toContain(4.25);
    expect(choices.every((r) => Math.abs(r - 4.25) <= 1.75 + 1e-9)).toBe(true);
  });
});

describe("policy constraints at committee execution", () => {
  it.each([
    ["fx-committed", { fxCommitment: { regime: "peg", capitalControls: false } }],
    ["command-economy", { commandEconomy: true }],
    ["term-cap", { rateChangesThisTerm: RATE_CHANGES_PER_TERM }],
    ["cooldown", { lastRateChangeTurn: 123 }],
  ] as const)(
    "records a carried motion blocked by %s without changing the rate",
    (reason, policy) => {
      const meeting = nppMajorityMeeting(100);
      const state = baseState({ ...policy, activeMeeting: meeting });
      const decision = decideGovernance(
        state,
        { type: "resolve_meeting", force: true },
        SYSTEM,
        clock(124)
      );
      expect(decision.allowed).toBe(true);
      if (!decision.allowed) return;
      expect(decision.next.primeRate).toBe(5);
      expect(decision.transition.set.rateHistoryAppend).toBeUndefined();
      expect(decision.transition.set.meetingHistoryAppend).toMatchObject({
        result: "passed",
        executionOutcome: "blocked",
        executionBlockedReason: reason,
        ballots: meeting.ballots,
      });
      expect(decision.next.activeMeeting).toBeNull();
    }
  );
});

it("normalizes a carried move from an off-grid stored rate", () => {
  const decision = decideGovernance(
    baseState({
      primeRate: 4.1,
      activeMeeting: { ...nppMajorityMeeting(100), proposedDelta: 0.25 },
    }),
    { type: "resolve_meeting", force: true },
    SYSTEM,
    clock(124)
  );
  expect(decision.allowed).toBe(true);
  if (decision.allowed) expect(decision.next.primeRate).toBe(4.25);
});

it("uses the reset term budget when a meeting resolves on term rollover", () => {
  const decision = turnStart(
    baseState({
      termStartedAtTurn: 0,
      rateChangesThisTerm: RATE_CHANGES_PER_TERM,
      activeMeeting: nppMajorityMeeting(100),
    }),
    600
  );
  expect(decision.allowed).toBe(true);
  if (!decision.allowed) return;
  expect(decision.next.rateChangesThisTerm).toBe(1);
  expect(decision.next.primeRate).toBe(5.5);
});

it("allows a carried hold under an exchange-rate commitment", () => {
  const meeting = nppMajorityMeeting(100);
  meeting.motion = "hold";
  meeting.proposedDelta = 0;
  meeting.ballots = meeting.ballots.map((ballot) => ({ ...ballot, vote: "hold" }));
  const decision = decideGovernance(
    baseState({ activeMeeting: meeting, fxCommitment: { regime: "peg", capitalControls: false } }),
    { type: "resolve_meeting", force: true },
    SYSTEM,
    clock(124)
  );
  expect(decision.allowed).toBe(true);
  if (!decision.allowed) return;
  expect(decision.transition.set.meetingHistoryAppend).toMatchObject({
    result: "passed",
    executionOutcome: "not-required",
  });
  expect(decision.next.primeRate).toBe(5);
});

it.each([
  ["out-of-range", 25, 0.5],
  ["delta-hike", 5, 1],
  ["delta-cut", 5, -3],
] as const)("blocks a carried proposal violating %s", (reason, primeRate, proposedDelta) => {
  const meeting = nppMajorityMeeting(100);
  meeting.proposedDelta = proposedDelta;
  const decision = decideGovernance(
    baseState({ primeRate, activeMeeting: meeting }),
    { type: "resolve_meeting", force: true },
    SYSTEM,
    clock(124)
  );
  expect(decision.allowed).toBe(true);
  if (!decision.allowed) return;
  expect(decision.next.primeRate).toBe(primeRate);
  expect(decision.transition.set.meetingHistoryAppend).toMatchObject({
    executionOutcome: "blocked",
    executionBlockedReason: reason,
  });
});
