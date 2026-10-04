/** Deterministic mixed-board cadence qualification for issue #2318. No database access. */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { decideGovernance } from "../../src/lib/monetaryGovernance/rules/machine";
import type {
  JurisdictionState,
  MacroInputs,
  SeatState,
} from "../../src/lib/monetaryGovernance/rules/types";

const START_TURN = 100;
const TURNS = 240;
const START_MS = 1_700_000_000_000;
const MACRO: MacroInputs = {
  neutralRate: 5,
  inflationRate: 2,
  targetInflation: 2,
  gdpGrowth: 2,
};
type Machine = typeof decideGovernance;

function initialState(players: number, doves: number): JurisdictionState {
  const board: SeatState[] = Array.from({ length: 7 }, (_, index) => ({
    seatId: `seat-${index + 1}`,
    isChair: index === 0,
    occupantType: index < players ? "player" : "npp",
    characterId: index < players ? `fixture-player-${index}` : null,
    alignment: index >= 7 - doves ? "dove" : "hawk",
    termExpiresAtTurn: 5000,
  }));
  return {
    institutionId: "US",
    currency: "USD",
    memberCountryIds: ["US"],
    anchorCountryId: "US",
    committeeBank: true,
    governmentControlled: false,
    primeRate: 5,
    chairInfamy: 0,
    board,
    activeMeeting: null,
    rateChangesThisTerm: 0,
    termStartedAtTurn: START_TURN,
    lastMeetingTurn: START_TURN - 8,
    lastRateChangeTurn: null,
    chairCharacterId: players > 0 ? "fixture-player-0" : null,
    controlsLocked: false,
    chairSelectionPending: false,
    fxCommitment: null,
    commandEconomy: false,
    lastVacancyNoticeAtTurn: null,
  };
}

function simulate(machine: Machine, players: number, doves: number, chairVotes: boolean) {
  let state = initialState(players, doves);
  const openings: number[] = [];
  const resolutions: { latency: number; result: string }[] = [];
  let rateChanges = 0;
  const record: (decision: ReturnType<Machine>) => void = (decision) => {
    assert(decision.allowed, "Fixture governance command must succeed");
    if (decision.transition.set.lastFomcMeetingTurn !== undefined)
      openings.push(decision.transition.set.lastFomcMeetingTurn);
    const resolved = decision.transition.set.meetingHistoryAppend;
    if (resolved) {
      assert(resolved.resolvedAtTurn! > resolved.openedAtTurn);
      resolutions.push({
        latency: resolved.resolvedAtTurn! - resolved.openedAtTurn,
        result: resolved.result!,
      });
    }
    if (decision.transition.set.rateHistoryAppend) rateChanges++;
    state = decision.next;
  };
  for (let turn = START_TURN; turn < START_TURN + TURNS; turn++) {
    const now = START_MS + (turn - START_TURN) * 60 * 60 * 1000;
    const clock = { turn, now, currentYear: 1991 };
    record(
      machine(state, { type: "turn_start", turn, now, macro: MACRO }, { kind: "system" }, clock)
    );
    const meeting = state.activeMeeting;
    if (chairVotes && meeting && turn === meeting.openedAtTurn + 3) {
      record(
        machine(
          state,
          { type: "cast_ballot", seatId: "seat-1", vote: meeting.motion },
          { kind: "governor", seatId: "seat-1", characterId: "fixture-player-0" },
          clock
        )
      );
    }
  }
  return {
    openings: openings.length,
    meetingsPerYear: openings.length / (TURNS / 48),
    averageResolutionTurns:
      resolutions.reduce((sum, item) => sum + item.latency, 0) / resolutions.length,
    passed: resolutions.filter((item) => item.result === "passed").length,
    failed: resolutions.filter((item) => item.result === "failed").length,
    rateChanges,
    finalRate: state.primeRate,
  };
}

async function main() {
  const baselinePath = process.argv.find((arg) => arg.startsWith("--baseline="))?.slice(11);
  const baseline: Machine | undefined = baselinePath
    ? (await import(pathToFileURL(baselinePath).href)).decideGovernance
    : undefined;
  const scenarios = [
    { name: "six NPP hawks, one player no-show", players: 1, doves: 0, chairVotes: false },
    { name: "four NPP hawks, three player no-shows", players: 3, doves: 0, chairVotes: false },
    { name: "divided NPP board, pivotal player no-show", players: 1, doves: 3, chairVotes: false },
    {
      name: "divided NPP board, player votes after three turns",
      players: 1,
      doves: 3,
      chairVotes: true,
    },
    { name: "all NPP hawks", players: 0, doves: 0, chairVotes: false },
    { name: "all players absent", players: 7, doves: 0, chairVotes: false },
  ].map(({ name, players, doves, chairVotes }) => {
    const treatment = simulate(decideGovernance, players, doves, chairVotes);
    const control = baseline ? simulate(baseline, players, doves, chairVotes) : undefined;
    if (doves === 0 && players > 0 && players < 4) {
      assert.equal(treatment.meetingsPerYear, 6);
      assert.equal(treatment.averageResolutionTurns, 1);
      if (control) assert(treatment.meetingsPerYear > control.meetingsPerYear);
    } else if (control && chairVotes) {
      const { averageResolutionTurns: treatmentLatency, ...treatmentOutcomes } = treatment;
      const { averageResolutionTurns: controlLatency, ...controlOutcomes } = control;
      assert.deepEqual(treatmentOutcomes, controlOutcomes);
      assert(treatmentLatency <= controlLatency);
    } else if (control) {
      assert.deepEqual(
        treatment,
        control,
        "Pivotal and fully automatic boards must retain behavior"
      );
    }
    return { name, control, treatment };
  });
  process.stdout.write(JSON.stringify({ turns: TURNS, macro: MACRO, scenarios }, null, 2) + "\n");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
