/**
 * View model for the Blend results screen (Proposal D, screen 4).
 *
 * The design's `isD` block sits outside both the "concluded" and "live results"
 * branches, so one screen serves both routes; only the chip and two rail labels
 * differ. This model is built over the live-results payload, which carries the
 * called flags, per-state margins and EV threshold the screen needs.
 */

import type { ElectionResultsResponse, ResultsUnit } from "@/lib/elections/liveResults/types";
import { shadeColorForTier } from "@/components/elections/general/BattlegroundMap";
import { classifyMarginTier } from "@/lib/elections/generalViewModel";
import { BLEND } from "@/components/blend/tokens";

export type ResultsRoute = "concluded" | "dashboard";
export type ResultsRail = "overview" | "college" | "board" | "states";
export type StateSortKey = "state" | "ev" | "margin";

export interface ResultsBlendInput {
  data: ElectionResultsResponse;
  route: ResultsRoute;
  rail: ResultsRail;
  sortBy: StateSortKey;
  sortDesc: boolean;
}

export interface ResultsTicketVM {
  id: string;
  name: string;
  party: string;
  ev: number;
  pct: string;
  votes: string;
  color: string;
  isWinner: boolean;
  sharePct: number;
}

export interface ResultsStateRowVM {
  id: string;
  name: string;
  ev: number;
  winner: string;
  winnerColor: string;
  marginPct: string;
  votes: string;
  called: boolean;
  statusText: string;
  dot: string;
  marginColor: string;
}

export interface ResultsTileVM {
  stateId: string;
  ev: number;
  background: string;
  ink: string;
  title: string;
}

export interface ResultsBlendVM {
  routeChip: string;
  railItems: { id: ResultsRail; label: string; badge?: string }[];
  showCollege: boolean;
  showStates: boolean;
  eyebrow: string;
  winnerName: string | null;
  winnerLine: string;
  headerReadout: string;
  certifiedText: string;
  vitals: { label: string; value: string; sub?: string; color?: string }[];
  tickets: ResultsTicketVM[];
  evSegments: { id: string; widthPct: number; label: string; color: string }[];
  thresholdPct: number;
  threshold: number;
  totalEv: number;
  tiles: ResultsTileVM[];
  states: ResultsStateRowVM[];
  closest: { name: string; margin: string; color: string }[];
  sortLabels: { state: string; ev: string; margin: string };
}

function compactVotes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(Math.round(n));
}

function grouped(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** Leading candidate of a unit, or null when nothing has reported. */
function unitLeader(u: ResultsUnit): string | null {
  return u.leaderId ?? null;
}

export function buildResultsBlendViewModel(inp: ResultsBlendInput): ResultsBlendVM {
  const { data, route, rail, sortBy, sortDesc } = inp;
  const { election, candidates, units, summary } = data;

  const byId = new Map(candidates.map((c) => [c.id, c]));

  // ── Tickets ───────────────────────────────────────────────────────────────
  const totalVotes = summary.totalVotes || candidates.reduce((s, c) => s + c.totalVotes, 0);
  const tickets: ResultsTicketVM[] = candidates
    .map((c) => ({
      id: c.id,
      name: c.name,
      party: c.partyName,
      ev: c.electoralVotes ?? 0,
      pct: c.voteSharePct.toFixed(1),
      votes: compactVotes(c.totalVotes),
      color: c.partyColor,
      isWinner: summary.projectedWinner === c.id,
      sharePct: c.voteSharePct,
    }))
    .sort((a, b) => b.ev - a.ev || b.sharePct - a.sharePct);

  const winner = tickets.find((t) => t.isWinner) ?? null;
  const runnerUp = tickets.find((t) => t.id !== winner?.id) ?? null;

  // ── Electoral college ─────────────────────────────────────────────────────
  const totalEv = election.totalEv ?? units.reduce((s, u) => s + u.weight, 0) ?? 0;
  const threshold = election.evNeeded ?? (totalEv > 0 ? Math.floor(totalEv / 2) + 1 : 0);

  const evSegments = tickets
    .filter((t) => t.ev > 0)
    .map((t) => {
      const widthPct = totalEv > 0 ? (t.ev / totalEv) * 100 : 0;
      return { id: t.id, widthPct, label: widthPct > 8 ? String(t.ev) : "", color: t.color };
    });

  // ── Tiles and state rows ──────────────────────────────────────────────────
  const tiles: ResultsTileVM[] = units
    .map((u) => {
      const leaderId = unitLeader(u);
      const leader = leaderId ? byId.get(leaderId) : undefined;
      const color = leader?.partyColor ?? BLEND.mutedDimmer;
      const tier = classifyMarginTier(u.leaderMarginPct);
      const background = u.totalVotes === 0 ? BLEND.track : shadeColorForTier(color, tier);
      const ink =
        u.totalVotes === 0 || tier === "lean" || tier === "tossup" ? "#14141c" : "#ffffff";
      return {
        stateId: u.id,
        ev: u.weight,
        background,
        ink: u.totalVotes === 0 ? BLEND.muted : ink,
        title: leader
          ? `${u.name}: ${leader.name} +${u.leaderMarginPct.toFixed(1)}pp`
          : `${u.name}: not reporting`,
      };
    })
    .sort((a, b) => a.stateId.localeCompare(b.stateId));

  const rows: ResultsStateRowVM[] = units.map((u) => {
    const leaderId = unitLeader(u);
    const leader = leaderId ? byId.get(leaderId) : undefined;
    const color = leader?.partyColor ?? BLEND.mutedDimmer;
    return {
      id: u.id,
      name: u.name,
      ev: u.weight,
      winner: leader?.name ?? "Not reporting",
      winnerColor: color,
      marginPct: u.leaderMarginPct.toFixed(1),
      votes: compactVotes(u.totalVotes),
      called: u.called,
      statusText:
        u.totalVotes === 0 ? "Not reporting" : u.tied ? "Tied" : u.called ? "Called" : "Too close",
      dot: color,
      marginColor: u.called ? color : BLEND.caution,
    };
  });

  const states = [...rows].sort((a, b) => {
    let cmp = 0;
    if (sortBy === "state") cmp = a.name.localeCompare(b.name);
    else if (sortBy === "ev") cmp = a.ev - b.ev;
    else cmp = Number(a.marginPct) - Number(b.marginPct);
    return sortDesc ? -cmp : cmp;
  });

  const closest = [...rows]
    .filter((r) => r.winner !== "Not reporting")
    .sort((a, b) => Number(a.marginPct) - Number(b.marginPct))
    .slice(0, 4)
    .map((r) => ({
      name: r.name,
      margin: `${r.winner} +${r.marginPct}`,
      color: r.winnerColor,
    }));

  // ── Header ────────────────────────────────────────────────────────────────
  const called = summary.unitsCalled;
  const totalUnits = summary.totalUnits || units.length;
  const certifiedText = `${called}/${totalUnits} CALLED`;

  const popularMargin = winner && runnerUp ? Math.abs(winner.sharePct - runnerUp.sharePct) : 0;
  const statesWon = rows.filter((r) => r.winner === winner?.name).length;

  const winnerLine = winner
    ? `${winner.ev} electoral votes, ${winner.pct} per cent of the vote`
    : "No ticket has been projected yet";

  const arrow = (col: StateSortKey) => (sortBy === col ? (sortDesc ? " ↓" : " ↑") : "");

  return {
    routeChip: route === "concluded" ? "Concluded" : "Live results",
    railItems: [
      { id: "overview", label: "Overview" },
      { id: "college", label: "Electoral college", badge: winner ? String(winner.ev) : "" },
      {
        id: "board",
        label: route === "concluded" ? "Final board" : "Results board",
        badge: String(totalUnits),
      },
      {
        id: "states",
        label: route === "concluded" ? "State by state" : "Returns",
        badge: String(totalUnits),
      },
    ],
    showCollege: rail === "overview" || rail === "college" || rail === "board",
    showStates: rail === "overview" || rail === "states",
    eyebrow: route === "concluded" ? "President-elect" : "Leading",
    winnerName: winner?.name ?? null,
    winnerLine,
    headerReadout: [
      `TURN ${grouped(election.currentTurn)}`,
      totalVotes > 0 ? `${grouped(totalVotes)} BALLOTS` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    certifiedText,
    vitals: [
      {
        label: "Electoral votes",
        value: winner ? String(winner.ev) : "—",
        sub: `${threshold} to win`,
      },
      {
        label: "Popular vote",
        value: winner ? `${winner.pct}%` : "—",
        sub: popularMargin > 0 ? `+${popularMargin.toFixed(1)} margin` : undefined,
        color: BLEND.positive,
      },
      { label: "Ballots cast", value: compactVotes(totalVotes), sub: `${called} called` },
      {
        label: "States won",
        value: winner ? String(statesWon) : "—",
        sub: `of ${totalUnits}`,
      },
    ],
    tickets,
    evSegments,
    thresholdPct: totalEv > 0 ? (threshold / totalEv) * 100 : 50,
    threshold,
    totalEv,
    tiles,
    states,
    closest,
    sortLabels: {
      state: `State${arrow("state")}`,
      ev: `EV${arrow("ev")}`,
      margin: `Margin${arrow("margin")}`,
    },
  };
}
