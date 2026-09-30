/**
 * Replay Yugoslavia's authored outcomes and recovery across 480 subsystem turns.
 * This is an offline rules simulation, not full-world or real-system evidence.
 * Run: npx tsx scripts/sim/yugoslaviaResolution.ts
 */
import { execFileSync } from "node:child_process";
import { YUGOSLAVIA_DEF as def } from "../../src/lib/livingConflict/defs/yugoslavia";
import {
  applyConflictOutcome,
  applyTrackDeltas,
  evaluateConflictTransitions,
  normalizeConflictState,
  phaseFor,
  scheduledPressureDeltas,
  tickConflict,
} from "../../src/lib/livingConflict/engine";
import { advanceCampaignTurn, applyCampaignOutcome } from "../../src/lib/livingConflict/campaign";

interface Scenario {
  name: string;
  phase: string;
  tracks?: Record<string, number>;
  firstOutcome?: string;
  expectedPath: string[];
}

const scenarios: Scenario[] = [
  {
    name: "escalation and refugee recovery",
    phase: "declarations",
    tracks: { violence: 30 },
    firstOutcome: "military_escalation",
    expectedPath: ["armed_conflict", "settlement", "reconstruction"],
  },
  {
    name: "peaceful federation",
    phase: "federal_crisis",
    expectedPath: ["settlement", "reconstruction"],
  },
  {
    name: "peaceful separation",
    phase: "declarations",
    expectedPath: ["settlement", "reconstruction"],
  },
  {
    name: "negotiated war settlement",
    phase: "armed_conflict",
    tracks: { violence: 60, displacement: 50 },
    expectedPath: ["settlement", "reconstruction"],
  },
  {
    name: "supported intervention",
    phase: "armed_conflict",
    tracks: { violence: 90, displacement: 50 },
    firstOutcome: "international_intervention",
    expectedPath: ["international_intervention", "settlement", "reconstruction"],
  },
  {
    name: "settlement relapse",
    phase: "settlement",
    tracks: { violence: 70, settlementMomentum: 50 },
    expectedPath: ["armed_conflict", "settlement", "reconstruction"],
  },
  {
    name: "reconstruction relapse",
    phase: "reconstruction",
    tracks: { violence: 70, settlementMomentum: 50 },
    expectedPath: ["armed_conflict", "settlement", "reconstruction"],
  },
];

const results = scenarios.map((scenario) => {
  const opening = def.phases.find((phase) => phase.key === scenario.phase);
  if (!opening) throw new Error(`Unknown opening: ${scenario.phase}`);
  let state = normalizeConflictState(def, {
    defKey: def.key,
    hasOpened: true,
    openedYear: 1991,
    phaseLevel: opening.level,
    tracks: scenario.tracks,
  });
  const path = [{ turn: 0, phase: opening.key }];
  const violations: string[] = [];
  let firstSettledTurn: number | null = null;
  let peakDisplacement = 0;
  let peakRefugees = 0;
  for (let turn = 1; turn <= 480; turn += 1) {
    const year = 1991 + Math.floor((turn - 1) / 48);
    state = tickConflict(state);
    state.campaign = advanceCampaignTurn(state.campaign);
    state = applyTrackDeltas(def, state, scheduledPressureDeltas(def, state, year));
    // A response window resolves every 24 turns. Relapse is evaluated on
    // earlier turns rather than being erased by an immediate peace response.
    if (turn % 24 === 0) {
      const id =
        turn === 24 && scenario.firstOutcome ? scenario.firstOutcome : "negotiated_restructuring";
      const outcome = phaseFor(def, state.phaseLevel)?.events[0].response?.outcomes.find(
        (candidate) => candidate.outcomeId === id
      );
      if (!outcome) throw new Error(`Missing outcome: ${id}`);
      state = applyConflictOutcome(def, state, outcome);
      state.campaign = applyCampaignOutcome(state.campaign, {
        resolutionId: `${scenario.name}:${turn}`,
        outcomeId: id,
        delta: outcome.campaignDelta,
        nextStage: outcome.nextCampaignStage,
      }).state;
    }
    state = evaluateConflictTransitions(def, state, year).state;
    const phase = phaseFor(def, state.phaseLevel);
    if (!phase) throw new Error(`Unknown phase level: ${state.phaseLevel}`);
    if (path[path.length - 1].phase !== phase.key) path.push({ turn, phase: phase.key });
    if (state.status === "settled" && firstSettledTurn === null) firstSettledTurn = turn;
    const values = { ...state.tracks, ...state.campaign?.consequences };
    for (const [key, value] of Object.entries(values)) {
      if (!Number.isFinite(value) || value < 0 || value > 100)
        violations.push(`${turn}:${key}:${value}`);
    }
    peakDisplacement = Math.max(peakDisplacement, state.tracks?.displacement ?? 0);
    peakRefugees = Math.max(peakRefugees, state.campaign?.consequences.refugees ?? 0);
  }
  let nextExpected = 0;
  for (const entry of path.slice(1)) {
    if (entry.phase === scenario.expectedPath[nextExpected]) nextExpected += 1;
  }
  const passed =
    violations.length === 0 &&
    firstSettledTurn !== null &&
    state.status === "settled" &&
    nextExpected === scenario.expectedPath.length;
  return {
    name: scenario.name,
    passed,
    path,
    firstSettledTurn,
    finalStatus: state.status,
    peakDisplacement,
    finalDisplacement: state.tracks?.displacement,
    peakRefugees,
    finalRefugees: state.campaign?.consequences.refugees,
    violations,
  };
});

console.log(
  JSON.stringify(
    {
      scope: "offline subsystem rules only; no full-world or real-system qualification",
      sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      sourceDirty:
        execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
          encoding: "utf8",
        }).trim().length > 0,
      turnsPerScenario: 480,
      results,
    },
    null,
    2
  )
);
if (results.some((result) => !result.passed)) process.exitCode = 1;
