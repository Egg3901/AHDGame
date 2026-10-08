/**
 * Paints the presidential map for election night: grey before polls close,
 * fog while the first returns come in, a hatched lean tint for an uncalled
 * leader, stripes for a race too close to call, and the candidate's full
 * colour once the state is projected.
 */

import { BLEND } from "@/components/blend/tokens";
import { readableInk, shadeColorForTier } from "@/lib/elections/marginTierShade";
import type { ElectionResultsResponse, ResultsUnit } from "@/lib/elections/liveResults/types";
import type {
  PresMapCandidate,
  PresMapModel,
  PresMapOverlay,
  PresMapState,
} from "../blend/presMap/presMapModel";
import { STATE_NAMES } from "../blend/presMap/usStates";
import {
  candidateColor,
  nightStatusStyle,
  pollCloseLabel,
  unitNightStatus,
  type NightPaint,
} from "./nightModel";

/** Before the polls close. */
export const GREY_FILL = "#262633";
/** Polls closed, nothing meaningful counted. */
export const FOG_NIGHT_FILL = "#2f2f3e";
const GREY_HATCH = "#3a3a4d";

export interface NightMapOptions {
  /** State id the latest call alert is for; replays the highlight outline. */
  pulseStateId?: string | null;
  /** Changes with each alert so the outline replays. */
  pulseToken?: string;
}

interface Paint {
  fill: string;
  overlay?: PresMapOverlay;
}

/** Fill and pattern for a state at `paint`; pure so tests can pin the mapping. */
export function paintFor(
  paint: NightPaint,
  leaderColor: string,
  runnerUpColor: string | null
): Paint {
  switch (paint) {
    case "grey":
      return { fill: GREY_FILL };
    case "fog":
      return {
        fill: FOG_NIGHT_FILL,
        overlay: { kind: "hatch", base: FOG_NIGHT_FILL, colors: [GREY_HATCH] },
      };
    case "lean": {
      const tint = shadeColorForTier(leaderColor, "lean", BLEND.page);
      return { fill: tint, overlay: { kind: "hatch", base: tint, colors: [leaderColor] } };
    }
    case "stripe": {
      const colors = [leaderColor, runnerUpColor ?? GREY_HATCH];
      return {
        fill: shadeColorForTier(leaderColor, "tossup", BLEND.page),
        overlay: { kind: "stripe", base: leaderColor, colors },
      };
    }
    case "called":
      return { fill: leaderColor };
  }
}

function unitToState(
  unit: ResultsUnit,
  data: ElectionResultsResponse,
  candidates: Map<string, PresMapCandidate>,
  settled: boolean,
  opts: NightMapOptions
): PresMapState {
  const status = unitNightStatus(unit);
  const style = nightStatusStyle(status);
  const resolved = settled || unit.called;
  const showNumbers = style.showNumbers && unit.candidates.length > 0;

  const lookup = (id: string | undefined): PresMapCandidate | undefined =>
    id ? candidates.get(id) : undefined;
  const leader = showNumbers ? lookup(unit.calledFor ?? unit.leaderId) : undefined;
  const runnerUp = showNumbers
    ? lookup(unit.candidates.find((c) => c.candidateId !== (leader?.id ?? ""))?.candidateId)
    : undefined;

  const painted = paintFor(style.paint, leader?.color ?? "#9CA3AF", runnerUp?.color ?? null);
  const name = unit.name || STATE_NAMES[unit.id] || unit.id;
  const reporting = Math.round(unit.reportingPct * 10) / 10;
  const closed = status !== "polls_open";
  const caption = !closed
    ? `Polls close ${pollCloseLabel(unit.id)}`
    : `${style.label}, ${reporting}% reporting`;

  return {
    id: unit.id,
    name,
    ev: unit.weight,
    leaderId: leader?.id ?? "",
    leaderName: showNumbers ? (leader?.name ?? "") : "",
    leaderColor: leader?.color ?? "#9CA3AF",
    margin: showNumbers ? unit.leaderMarginPct : 0,
    tier: "tossup",
    fill: painted.fill,
    ink: readableInk(painted.fill),
    overlay: painted.overlay,
    shares: showNumbers
      ? unit.candidates.map((c) => {
          const cand = lookup(c.candidateId);
          return {
            id: c.candidateId,
            name: cand?.name ?? "Unknown",
            color: cand?.color ?? "#9CA3AF",
            votes: c.votes,
            pct: c.voteShare,
            ev: 0,
            changePp: null,
          };
        })
      : [],
    totalVotes: showNumbers ? unit.totalVotes : 0,
    trend: {
      status: "none",
      candidateId: null,
      name: null,
      color: null,
      shiftPp: 0,
      windowTurns: 0,
      series: [],
    },
    sinceTurn: null,
    turnsAgo: null,
    caption,
    broadcast: {
      statusLabel: style.label,
      reportingPct: reporting,
      closeLabel: pollCloseLabel(unit.id),
      closed,
      showNumbers,
      called: unit.called || status === "called",
      countiesOpen: resolved,
    },
    pulse: opts.pulseStateId === unit.id ? opts.pulseToken : undefined,
  };
}

/** Map model for the broadcast. Only map states (not district units) are included. */
export function buildNightMapModel(
  data: ElectionResultsResponse,
  settled: boolean,
  opts: NightMapOptions = {}
): PresMapModel {
  const candidates = new Map<string, PresMapCandidate>(
    data.candidates.map((c) => [c.id, { id: c.id, name: c.name, color: candidateColor(c) }])
  );
  const states: Record<string, PresMapState> = {};
  for (const unit of data.units) {
    if (!(unit.id in STATE_NAMES)) continue;
    states[unit.id] = unitToState(unit, data, candidates, settled, opts);
  }
  const legendSource = [...data.candidates]
    .sort(
      (a, b) => (b.electoralVotes ?? 0) - (a.electoralVotes ?? 0) || b.totalVotes - a.totalVotes
    )
    .slice(0, 2);
  return {
    states,
    candidates: Object.fromEntries(candidates),
    legendCandidates: legendSource.map((c) => candidates.get(c.id)!),
  };
}
