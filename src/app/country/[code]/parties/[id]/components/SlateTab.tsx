"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useCountdownTimer } from "@/hooks/useCountdownTimer";
import { useGameClock } from "@/contexts/useGameClock";
import type { ElectionPhaseStatusSummary } from "@/lib/elections/electionPhaseStatus";
import type { ElectionDisplay, GameStateDisplay } from "@/lib/db/types";
import { ElectionPhaseStatusStrip } from "@/components/elections/ElectionPhaseStatusStrip";
import { SlateElectionResults } from "@/components/elections/SlateElectionResults";
import type { StateMapData } from "@/components/USAMapPaths";
import { SLATE_REFUSAL_LABEL, isSlateFilingFailure } from "@/lib/slate/refusalReasons";

const MapFallback = () => (
  <div className="h-full w-full animate-pulse rounded-md bg-card-elevated" />
);

const USAMapPaths = dynamic(
  () => import("@/components/USAMapPaths").then((m) => ({ default: m.USAMapPaths })),
  { loading: MapFallback, ssr: false }
);
const UKMapPaths = dynamic(
  () => import("@/components/UKMapPaths").then((m) => ({ default: m.UKMapPaths })),
  { loading: MapFallback, ssr: false }
);
const JapanMapPaths = dynamic(
  () => import("@/components/JapanMapPaths").then((m) => ({ default: m.JapanMapPaths })),
  { loading: MapFallback, ssr: false }
);
const GermanyMapPaths = dynamic(
  () => import("@/components/GermanyMapPaths").then((m) => ({ default: m.GermanyMapPaths })),
  { loading: MapFallback, ssr: false }
);
import type { PartyMember as PartyRosterMember } from "./types";
import {
  getStateMap,
  getStateMapRenderMode,
  type StateMapEntry,
  type StateMapRenderMode,
} from "./slate/stateMapData";

/**
 * National Recruitment Slate tab. Top half is the country-aware state map
 * (or list, for countries without a coord table); bottom half is the
 * detail panel for the currently-selected state, listing every slated
 * race plus chair-only invite/withdraw controls.
 *
 * Locked design variant for Phase 6: by-state national view + scoped (own-
 * state-only) view for state/regional party pages. The latter renders the
 * same race-list panel as the national selected-state pane, just without
 * the country map.
 */

interface CandidateCounts {
  invited: number;
  considering: number;
  accepted: number;
  declined: number;
  withdrawn: number;
  filed: number;
}

interface SlateOverviewItem {
  id: string | null;
  electionId: string;
  electionType: string;
  senateClass: number | null;
  chamberClass: number | null;
  electionStatus: string | null;
  electionCycle: number | null;
  electionPrimaryEndTime: string | null;
  state: string;
  priority: "high" | "defend" | "primary_threat" | "none";
  notes: string | null;
  candidateCounts: CandidateCounts;
  createdAt: string | null;
  updatedAt: string | null;
}

interface StateAggregate {
  state: string;
  slateCount: number;
  byStatus: { invited: number; accepted: number; declined: number; filed: number };
  highPriority: number;
  contested: number;
}

interface StatePresence {
  players: number;
  npps: number;
}

interface OverviewResponse {
  items: SlateOverviewItem[];
  stateAggregates: StateAggregate[];
}

interface SlateCandidateRow {
  id: string;
  candidateType: "npp" | "character";
  candidateId: string;
  candidateName: string;
  homeState: string;
  assignedByCharacterId: string | null;
  assignedByCharacterName: string | null;
  assignedByRole:
    "national_chair" | "national_vice_chair" | "state_chair" | "state_vice_chair" | null;
  assignedByRoleLabel: string | null;
  status: "invited" | "considering" | "accepted" | "declined" | "withdrawn" | "filed";
  fitScore: number;
  invitationNote: string | null;
  refusalReason:
    | "low_relationship"
    | "low_ambition"
    | "low_compliance"
    | "race_priority_mismatch"
    | "in_other_race"
    | "cooldown"
    | "retired"
    | "ineligible_region"
    | "slot_taken"
    | "party_restricted"
    | "npp_unavailable"
    | "already_slated_elsewhere"
    | null;
  autoFilled: boolean;
  invitedAt: string;
  respondedAt: string | null;
  filedAt: string | null;
}

interface SlateDetailResponse {
  slate: {
    id: string | null;
    electionId: string;
    electionType: string;
    state: string;
    priority: "high" | "defend" | "primary_threat" | "none";
    notes: string | null;
    archivedAt: string | null;
  };
  candidates: SlateCandidateRow[];
  election: {
    id: string;
    electionType: string;
    state: string;
    status: string;
    cycle: number;
    primaryEndTime: string | null;
    phaseStatus: ElectionPhaseStatusSummary;
  };
  electionDisplay: ElectionDisplay;
  stateAssignedCandidateIds: string[];
}

interface SlateTabProps {
  countryCode: string;
  countryId: string;
  partyId: string;
  partyColor: string;
  canManageSlate: boolean;
  partyMembers: PartyRosterMember[];
  /** When set, the tab renders in scoped (state/regional) mode and locks the state filter. */
  scopeState?: string | null;
  initialSelectedState?: string | null;
}

const STATUS_COLOR: Record<SlateCandidateRow["status"], string> = {
  invited: "bg-amber-500/15 border-amber-500/40 text-amber-300",
  considering: "bg-amber-500/15 border-amber-500/40 text-amber-300",
  accepted: "bg-emerald-500/15 border-emerald-500/40 text-emerald-300",
  declined: "bg-red-500/15 border-red-500/40 text-red-300",
  withdrawn: "bg-zinc-700/30 border-zinc-600 text-zinc-400",
  filed: "bg-sky-500/15 border-sky-500/40 text-sky-300",
};

const PENDING_ASSIGNMENT_STATUS_STYLE = "bg-primary/10 border-primary/40 text-primary";

const PRIORITY_COLOR: Record<SlateOverviewItem["priority"], string> = {
  high: "bg-primary/15 border-primary/40 text-primary",
  defend: "bg-emerald-500/15 border-emerald-500/40 text-emerald-300",
  primary_threat: "bg-red-500/15 border-red-500/40 text-red-300",
  none: "bg-card-border/30 border-card-border text-muted",
};

const REFUSAL_LABEL = SLATE_REFUSAL_LABEL;

const ACCEPTANCE_LIKELIHOOD_STYLES = {
  likely: "bg-emerald-500/15 border-emerald-500/40 text-emerald-300",
  unlikely: "bg-red-500/15 border-red-500/40 text-red-300",
} as const;

function getAcceptanceChip(
  candidate: Pick<
    SlateCandidateRow,
    "status" | "invitedAt" | "respondedAt" | "filedAt" | "refusalReason"
  >
): {
  label: string;
  className: string;
} {
  if (
    candidate.status === "invited" &&
    candidate.respondedAt === null &&
    candidate.filedAt === null
  ) {
    if (candidate.refusalReason) {
      return {
        label: "Likely to Decline",
        className: ACCEPTANCE_LIKELIHOOD_STYLES.unlikely,
      };
    }

    return {
      label: "Likely to Accept",
      className: ACCEPTANCE_LIKELIHOOD_STYLES.likely,
    };
  }

  if (candidate.status === "declined") {
    return {
      label: "Declined",
      className: ACCEPTANCE_LIKELIHOOD_STYLES.unlikely,
    };
  }

  if (candidate.status === "withdrawn") {
    return {
      label: "Could Not File",
      className: ACCEPTANCE_LIKELIHOOD_STYLES.unlikely,
    };
  }

  if (candidate.status === "filed" || candidate.filedAt !== null) {
    return {
      label: "Accepted",
      className: ACCEPTANCE_LIKELIHOOD_STYLES.likely,
    };
  }

  if (candidate.status === "accepted" && !isPreTurnSlateAssignment(candidate)) {
    return {
      label: "Accepted",
      className: ACCEPTANCE_LIKELIHOOD_STYLES.likely,
    };
  }

  return {
    label: "Likely to Accept",
    className: ACCEPTANCE_LIKELIHOOD_STYLES.likely,
  };
}

function formatSlateLabel(value: string | null | undefined): string {
  if (!value) return "-";
  return value
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatSlateRaceTitle(
  item: Pick<SlateOverviewItem, "electionType" | "senateClass" | "chamberClass">
): string {
  const baseLabel = formatSlateLabel(item.electionType);
  const chamberClass = item.senateClass ?? item.chamberClass;
  if (!chamberClass) {
    return `${baseLabel} Race`;
  }

  return `${baseLabel} Race · Class ${toRomanNumeral(chamberClass)}`;
}

function toRomanNumeral(value: number): string {
  switch (value) {
    case 1:
      return "I";
    case 2:
      return "II";
    case 3:
      return "III";
    default:
      return String(value);
  }
}

function isPreTurnSlateAssignment(
  candidate: Pick<SlateCandidateRow, "invitedAt" | "respondedAt" | "filedAt">
): boolean {
  return (
    candidate.filedAt === null &&
    candidate.respondedAt !== null &&
    candidate.respondedAt === candidate.invitedAt
  );
}

export function SlateTab({
  countryCode,
  countryId,
  partyId,
  partyColor,
  canManageSlate,
  partyMembers,
  scopeState,
  initialSelectedState,
}: SlateTabProps) {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [gameState, setGameState] = useState<GameStateDisplay | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [selectedState, setSelectedState] = useState<string | null>(scopeState ?? null);
  const [hoverState, setHoverState] = useState<string | null>(null);

  useCountdownTimer();

  const stateMap = getStateMap(countryId);
  const stateMapRenderMode = getStateMapRenderMode(countryId);

  const fetchOverview = useCallback(async () => {
    setOverviewLoading(true);
    setOverviewError(null);
    try {
      const [overviewRes, gameStateRes] = await Promise.all([
        fetch(`/api/country/${countryCode}/parties/${partyId}/slate`, {
          cache: "no-store",
        }),
        fetch("/api/game/turn/status", { cache: "no-store" }),
      ]);
      if (!overviewRes.ok) {
        const body = (await overviewRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Failed to load slate (${overviewRes.status})`);
      }
      setOverview((await overviewRes.json()) as OverviewResponse);

      if (gameStateRes.ok) {
        const body = (await gameStateRes.json()) as GameStateDisplay;
        setGameState({
          isActive: body.isActive,
          pausedAt: body.pausedAt ?? null,
          lastTurnProcessed: body.lastTurnProcessed ?? null,
          currentYear: body.currentYear,
          currentTurn: body.currentTurn,
        });
      }
    } catch (err) {
      setOverviewError(err instanceof Error ? err.message : "Failed to load slate");
    } finally {
      setOverviewLoading(false);
    }
  }, [countryCode, partyId]);

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  // Pre-pick a sensible default state when the overview lands without a
  // scope-locked state already selected.
  useEffect(() => {
    if (scopeState) {
      setSelectedState(scopeState);
      return;
    }
    if (initialSelectedState) {
      setSelectedState(initialSelectedState);
    }
  }, [initialSelectedState, scopeState]);

  useEffect(() => {
    if (selectedState || !overview) return;
    if (scopeState) return;
    const firstWithRace = overview.items[0];
    if (firstWithRace) setSelectedState(firstWithRace.state);
  }, [overview, scopeState, selectedState]);

  const aggregateByState = useMemo(() => {
    const map = new Map<string, StateAggregate>();
    if (overview) {
      for (const agg of overview.stateAggregates) map.set(agg.state, agg);
    }
    return map;
  }, [overview]);

  const itemsByState = useMemo(() => {
    const map = new Map<string, SlateOverviewItem[]>();
    if (overview) {
      for (const item of overview.items) {
        if (scopeState && item.state !== scopeState) continue;
        const list = map.get(item.state) ?? [];
        list.push(item);
        map.set(item.state, list);
      }
    }
    return map;
  }, [overview, scopeState]);

  const memberPresenceByState = useMemo(() => {
    const map = new Map<string, StatePresence>();
    for (const member of partyMembers) {
      if (!member.homeState) continue;
      const current = map.get(member.homeState) ?? { players: 0, npps: 0 };
      if (member.isNPP) current.npps += 1;
      else current.players += 1;
      map.set(member.homeState, current);
    }
    return map;
  }, [partyMembers]);

  const sortedStatesForList = useMemo(() => {
    if (!overview) return [] as string[];
    return Array.from(itemsByState.keys()).sort();
  }, [overview, itemsByState]);

  if (overviewLoading) {
    return <PanelStub>Loading Slates...</PanelStub>;
  }
  if (overviewError) {
    return <PanelStub error>{overviewError}</PanelStub>;
  }
  if (!overview) return null;

  const showMap = !scopeState && stateMap;

  return (
    <div className="space-y-4">
      {scopeState && (
        <div className="rounded-xl border border-card-border bg-card p-3 flex items-center gap-3 text-xs">
          <span className="rounded-full border border-card-border px-2 py-0.5 uppercase tracking-wider text-muted">
            Scope locked
          </span>
          <span className="text-muted">
            This party can only slate races within{" "}
            {stateMap?.[scopeState]?.name ?? scopeState.replace(/^.+_/, "")}.
          </span>
        </div>
      )}

      {showMap && stateMap && (
        <CountryMap
          renderMode={stateMapRenderMode}
          stateMap={stateMap}
          aggregateByState={aggregateByState}
          memberPresenceByState={memberPresenceByState}
          partyColor={partyColor}
          selectedState={selectedState}
          hoverState={hoverState}
          onSelect={setSelectedState}
          onHover={setHoverState}
        />
      )}

      {!showMap && !scopeState && (
        <StateListSelector
          states={sortedStatesForList}
          selectedState={selectedState}
          onSelect={setSelectedState}
          aggregateByState={aggregateByState}
        />
      )}

      <SelectedStatePane
        countryCode={countryCode}
        countryId={countryId}
        partyId={partyId}
        state={selectedState}
        items={itemsByState.get(selectedState ?? "") ?? []}
        pausedAt={gameState?.pausedAt ?? null}
        gameTimeRef={gameState?.lastTurnProcessed ?? null}
        canManageSlate={canManageSlate}
        partyMembers={partyMembers}
        onMutate={fetchOverview}
      />
    </div>
  );
}

// Subcomponents

function PanelStub({ children, error = false }: { children: React.ReactNode; error?: boolean }) {
  const cls = error
    ? "rounded-xl border border-error/30 bg-error/5 p-5 text-xs text-error"
    : "rounded-xl border border-card-border bg-card p-5 text-xs text-muted";
  return <div className={cls}>{children}</div>;
}

function CountryMap({
  renderMode,
  stateMap,
  aggregateByState,
  memberPresenceByState,
  partyColor,
  selectedState,
  hoverState,
  onSelect,
  onHover,
}: {
  renderMode: StateMapRenderMode;
  stateMap: Record<string, StateMapEntry>;
  aggregateByState: Map<string, StateAggregate>;
  memberPresenceByState: Map<string, StatePresence>;
  partyColor: string;
  selectedState: string | null;
  hoverState: string | null;
  onSelect: (state: string) => void;
  onHover: (state: string | null) => void;
}) {
  const hovered = hoverState ? aggregateByState.get(hoverState) : null;
  const hoveredPresence = hoverState ? memberPresenceByState.get(hoverState) : null;
  const hoveredEntry = hoverState ? stateMap[hoverState] : null;
  const regionMapData = useMemo(() => {
    return Object.fromEntries(
      Object.entries(stateMap).map(([code, entry]) => {
        const agg = aggregateByState.get(code);
        const presence = memberPresenceByState.get(code);
        const hasPresence = (presence?.players ?? 0) + (presence?.npps ?? 0) > 0;
        const color = hasPresence ? partyColor : "var(--card-border)";

        return [
          code,
          {
            color,
            label: entry.name,
            tooltip: [
              `Players: ${presence?.players ?? 0}`,
              `NPPs: ${presence?.npps ?? 0}`,
              `Slates: ${agg?.slateCount ?? 0}`,
              `Contested: ${agg?.contested ?? 0}`,
              `Filed: ${agg?.byStatus.filed ?? 0} / ${agg?.slateCount ?? 0}`,
            ],
          },
        ];
      })
    );
  }, [aggregateByState, memberPresenceByState, partyColor, stateMap]);

  const usStateData = useMemo<Record<string, StateMapData>>(
    () => (renderMode === "usa_paths" ? regionMapData : {}),
    [regionMapData, renderMode]
  );

  const highlightedRegions = selectedState ? [selectedState] : undefined;
  return (
    <div className="rounded-xl border border-card-border bg-card p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div>
          <h3 className="text-sm font-semibold">Slate by state</h3>
          <p className="text-[11px] text-muted mt-0.5">
            Hover for a breakdown; click to drill into races for that state.
          </p>
        </div>
      </div>
      <div className="relative overflow-hidden rounded-lg bg-card-elevated/40">
        {renderMode === "usa_paths" ? (
          <div className="w-full" style={{ aspectRatio: "960/600" }}>
            <USAMapPaths
              stateData={usStateData}
              highlightedStates={highlightedRegions}
              onStateClick={onSelect}
            />
          </div>
        ) : renderMode === "uk_paths" ? (
          <div className="mx-auto w-full max-w-[320px]" style={{ aspectRatio: "280/400" }}>
            <UKMapPaths
              regionData={regionMapData}
              highlightedRegions={highlightedRegions}
              onRegionClick={onSelect}
            />
          </div>
        ) : renderMode === "jp_paths" ? (
          <div className="mx-auto w-full max-w-[340px]" style={{ aspectRatio: "300/440" }}>
            <JapanMapPaths
              regionData={regionMapData}
              highlightedRegions={highlightedRegions}
              onRegionClick={onSelect}
            />
          </div>
        ) : renderMode === "de_paths" ? (
          <div className="mx-auto w-full max-w-[340px]" style={{ aspectRatio: "300/440" }}>
            <GermanyMapPaths
              regionData={regionMapData}
              highlightedRegions={highlightedRegions}
              onRegionClick={onSelect}
            />
          </div>
        ) : (
          <svg
            viewBox="0 0 700 420"
            className="relative z-10 w-full"
            style={{ background: "transparent" }}
          >
            {Object.entries(stateMap).map(([code, entry]) => {
              const agg = aggregateByState.get(code);
              const presence = memberPresenceByState.get(code);
              const isSelected = selectedState === code;
              const isHover = hoverState === code;
              const hasPresence = (presence?.players ?? 0) + (presence?.npps ?? 0) > 0;
              const tone = hasPresence ? partyColor : "var(--card-border)";
              const radius = 12 + Math.min(agg?.slateCount ?? 0, 5) * 2;
              return (
                <g key={code}>
                  <circle
                    cx={entry.cx}
                    cy={entry.cy}
                    r={radius}
                    fill={tone}
                    fillOpacity={isSelected ? 0.65 : isHover ? 0.45 : 0.22}
                    stroke={isSelected ? "var(--foreground)" : tone}
                    strokeWidth={isSelected ? 2 : 1}
                    style={{ cursor: "pointer", transition: "all 200ms" }}
                    onMouseEnter={() => onHover(code)}
                    onMouseLeave={() => onHover(null)}
                    onClick={() => onSelect(code)}
                  />
                  <text
                    x={entry.cx}
                    y={entry.cy + 4}
                    textAnchor="middle"
                    fontSize="9"
                    fontWeight="700"
                    fill="currentColor"
                    pointerEvents="none"
                  >
                    {entry.label}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
        {renderMode !== "usa_paths" && hovered && hoveredEntry && (
          <div className="absolute top-2 right-2 rounded-lg border border-card-border bg-card p-3 shadow-lg pointer-events-none min-w-[200px]">
            <div className="text-sm font-bold mb-1">{hoveredEntry.name}</div>
            <div className="space-y-0.5 text-[11px]">
              <RowKV k="Players" v={(hoveredPresence?.players ?? 0).toString()} />
              <RowKV k="NPPs" v={(hoveredPresence?.npps ?? 0).toString()} />
              <RowKV k="Slates" v={hovered.slateCount.toString()} />
              <RowKV k="Contested" v={hovered.contested.toString()} />
              <RowKV k="Filed" v={`${hovered.byStatus.filed} / ${hovered.slateCount}`} />
            </div>
            <div className="text-[10px] text-primary mt-2">Click to Slate Races -&gt;</div>
          </div>
        )}
      </div>
    </div>
  );
}

function StateListSelector({
  states,
  selectedState,
  onSelect,
  aggregateByState,
}: {
  states: string[];
  selectedState: string | null;
  onSelect: (s: string) => void;
  aggregateByState: Map<string, StateAggregate>;
}) {
  if (states.length === 0) {
    return <PanelStub>No slate-eligible races are open for this party right now.</PanelStub>;
  }
  return (
    <div className="rounded-xl border border-card-border bg-card p-4 space-y-2">
      <p className="text-[11px] uppercase tracking-widest text-muted">Select a state</p>
      <div className="flex flex-wrap gap-2">
        {states.map((s) => {
          const agg = aggregateByState.get(s);
          const isSelected = s === selectedState;
          return (
            <button
              type="button"
              key={s}
              onClick={() => onSelect(s)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                isSelected
                  ? "border-primary/60 bg-primary/10 text-foreground"
                  : "border-card-border bg-background text-muted hover:text-foreground"
              }`}
            >
              {s.replace(/^.+_/, "")}
              {agg && agg.slateCount > 0 && (
                <span className="ml-2 text-[10px] text-muted">{agg.slateCount}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SelectedStatePane({
  countryCode,
  countryId,
  partyId,
  state,
  items,
  pausedAt,
  gameTimeRef,
  canManageSlate,
  partyMembers,
  onMutate,
}: {
  countryCode: string;
  countryId: string;
  partyId: string;
  state: string | null;
  items: SlateOverviewItem[];
  pausedAt: string | null;
  gameTimeRef: string | null;
  canManageSlate: boolean;
  partyMembers: PartyRosterMember[];
  onMutate: () => Promise<void>;
}) {
  if (!state) {
    return <PanelStub>Select a state to see open races and current slate assignments.</PanelStub>;
  }
  if (items.length === 0) {
    const regionLabel = getStateMap(countryId)?.[state]?.name ?? state.replace(/^.+_/, "");
    return <PanelStub>No slate-eligible races are open for {regionLabel} this cycle.</PanelStub>;
  }
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <RaceSlatePanel
          key={item.electionId}
          countryCode={countryCode}
          countryId={countryId}
          partyId={partyId}
          item={item}
          pausedAt={pausedAt}
          gameTimeRef={gameTimeRef}
          canManageSlate={canManageSlate}
          partyMembers={partyMembers}
          onMutate={onMutate}
        />
      ))}
    </div>
  );
}

function RaceSlatePanel({
  countryCode,
  countryId,
  partyId,
  item,
  pausedAt: _pausedAt,
  gameTimeRef: _gameTimeRef,
  canManageSlate,
  partyMembers,
  onMutate,
}: {
  countryCode: string;
  countryId: string;
  partyId: string;
  item: SlateOverviewItem;
  pausedAt: string | null;
  gameTimeRef: string | null;
  canManageSlate: boolean;
  partyMembers: PartyRosterMember[];
  onMutate: () => Promise<void>;
}) {
  const clock = useGameClock();
  const [detail, setDetail] = useState<SlateDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/country/${countryCode}/parties/${partyId}/slate/${item.electionId}`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Failed to load slate (${res.status})`);
      }
      setDetail((await res.json()) as SlateDetailResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load slate");
    } finally {
      setLoading(false);
    }
  }, [countryCode, partyId, item.electionId]);

  useEffect(() => {
    void fetchDetail();
  }, [fetchDetail]);

  return (
    <div className="rounded-xl border border-card-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold">{formatSlateRaceTitle(item)}</span>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] tracking-wider ${PRIORITY_COLOR[item.priority]}`}
            >
              {formatSlateLabel(item.priority)}
            </span>
          </div>
          <p className="text-[11px] text-muted">
            {formatSlateLabel(item.electionStatus)} | Cycle {item.electionCycle ?? "-"}
            {item.electionPrimaryEndTime
              ? ` | Primary closes ${clock.formatAbsoluteDeadline(item.electionPrimaryEndTime)}`
              : ""}
          </p>
        </div>
        {canManageSlate && (
          <button
            type="button"
            onClick={() => setPickerOpen((open) => !open)}
            className="rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
          >
            {pickerOpen ? "Cancel" : "Assign Candidates"}
          </button>
        )}
      </div>

      {pickerOpen && detail && (
        <AssignmentPicker
          countryCode={countryCode}
          countryId={countryId}
          partyId={partyId}
          electionId={item.electionId}
          state={item.state}
          partyMembers={partyMembers}
          assignedCandidateIds={detail.stateAssignedCandidateIds}
          onDone={async () => {
            setPickerOpen(false);
            await fetchDetail();
            await onMutate();
          }}
        />
      )}

      {loading && <p className="text-xs text-muted">Loading Slate...</p>}
      {error && <p className="text-xs text-error">{error}</p>}

      {detail && detail.candidates.length === 0 && (
        <p className="text-xs text-muted">
          No one is assigned to this race yet. Party leaders can assign players or NPPs here; the
          assignments will persist into future cycles until manually changed.
        </p>
      )}

      {detail && detail.candidates.length > 0 && (
        <ul className="space-y-2">
          {detail.candidates.map((c) => {
            const isPendingAssignment = isPreTurnSlateAssignment(c);
            const isAwaitingTurnResponse =
              c.status === "invited" && c.respondedAt === null && c.filedAt === null;
            const isFilingFailure =
              c.status === "withdrawn" && isSlateFilingFailure(c.refusalReason);
            const statusLabel =
              isPendingAssignment || isAwaitingTurnResponse
                ? "Assigned"
                : isFilingFailure
                  ? "Not Filed"
                  : formatSlateLabel(c.status);
            const statusClass = isPendingAssignment
              ? PENDING_ASSIGNMENT_STATUS_STYLE
              : isAwaitingTurnResponse
                ? PENDING_ASSIGNMENT_STATUS_STYLE
                : STATUS_COLOR[c.status];
            const acceptanceChip = getAcceptanceChip(c);

            return (
              <li
                key={c.id}
                className="flex items-center gap-3 rounded-lg border border-card-border bg-background px-3 py-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Link
                      href={
                        c.candidateType === "npp"
                          ? `/politicians/npp/${c.candidateId}`
                          : `/character/${c.candidateId}`
                      }
                      className="text-sm font-medium hover:text-primary truncate"
                    >
                      {c.candidateName}
                    </Link>
                    <span className="rounded-full border border-card-border px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted">
                      {c.candidateType === "npp" ? "NPP" : "Player"}
                    </span>
                    <span className="text-[10px] text-muted">
                      {c.homeState.replace(/^.+_/, "")}
                    </span>
                    {c.autoFilled && (
                      <span className="rounded-full border border-card-border px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted">
                        Auto
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted flex flex-wrap items-center gap-2 mt-0.5">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wider ${acceptanceChip.className}`}
                    >
                      {acceptanceChip.label}
                    </span>
                    {c.assignedByCharacterName && (
                      <span>
                        | Assigned by {c.assignedByCharacterName}
                        {c.assignedByRoleLabel ? ` (${c.assignedByRoleLabel})` : ""}
                      </span>
                    )}
                    {c.refusalReason && (
                      <span className="text-red-300">- {REFUSAL_LABEL[c.refusalReason]}</span>
                    )}
                    {c.invitationNote && <span>| &quot;{c.invitationNote}&quot;</span>}
                  </div>
                </div>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wider ${statusClass}`}
                >
                  {statusLabel}
                </span>
                {/* A filing failure is visible but has no live candidacy; the
                    chair still needs a way to clear the row off the slate. The
                    DELETE route nulls the reason, which hides it again. */}
                {canManageSlate && (c.status !== "withdrawn" || isFilingFailure) && (
                  <WithdrawButton
                    countryCode={countryCode}
                    partyId={partyId}
                    electionId={item.electionId}
                    candidateRowId={c.id}
                    isFiled={c.status === "filed"}
                    candidateName={c.candidateName}
                    onDone={async () => {
                      await fetchDetail();
                      await onMutate();
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {detail && detail.candidates.some((c) => c.candidateType === "npp") && (
        <p className="text-[11px] text-muted">
          Compliant NPPs (loyal, not overly stubborn) file automatically on the next turn; others
          decline. Assign through a State / Regional Chair for a small compliance bonus.
        </p>
      )}

      {detail?.election.phaseStatus && (
        <ElectionPhaseStatusStrip phaseStatus={detail.election.phaseStatus} />
      )}

      {detail?.electionDisplay && <SlateElectionResults election={detail.electionDisplay} />}
    </div>
  );
}

function AssignmentPicker({
  countryCode,
  countryId,
  partyId,
  electionId,
  state,
  partyMembers,
  assignedCandidateIds,
  onDone,
}: {
  countryCode: string;
  countryId: string;
  partyId: string;
  electionId: string;
  state: string;
  partyMembers: PartyRosterMember[];
  assignedCandidateIds: string[];
  onDone: () => void | Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const assignedCandidateIdSet = useMemo(
    () => new Set(assignedCandidateIds),
    [assignedCandidateIds]
  );
  const sameStateNpps = useMemo(
    () => partyMembers.filter((member) => member.isNPP && member.homeState === state),
    [partyMembers, state]
  );
  const sameStatePlayers = useMemo(
    () => partyMembers.filter((member) => !member.isNPP && member.homeState === state),
    [partyMembers, state]
  );
  const eligiblePlayers = useMemo(
    () =>
      sameStatePlayers
        .filter((member) => !assignedCandidateIdSet.has(member.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [assignedCandidateIdSet, sameStatePlayers]
  );
  const eligibleNpps = useMemo(
    () =>
      sameStateNpps
        .filter((member) => !assignedCandidateIdSet.has(member.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [assignedCandidateIdSet, sameStateNpps]
  );
  const regionLabel = getStateMap(countryId)?.[state]?.name ?? state.replace(/^.+_/, "");
  const playersEmptyLabel =
    sameStatePlayers.length > 0
      ? `All same-party players based in ${regionLabel} are already slated to a race in this region. Withdraw an existing assignment to free one up.`
      : `No same-party players live in ${regionLabel}. Only candidates whose home is ${regionLabel} can be slated to this race.`;
  const nppsEmptyLabel =
    sameStateNpps.length > 0
      ? `All same-party NPPs based in ${regionLabel} are already slated to a race in this region. Withdraw an existing assignment to free one up.`
      : `No same-party NPPs live in ${regionLabel}. Only candidates whose home is ${regionLabel} can be slated to this race.`;

  async function assign(candidateType: "character" | "npp", candidateId: string) {
    const pending = `${candidateType}:${candidateId}`;
    setPendingKey(pending);
    setError(null);
    try {
      const res = await fetch(
        `/api/country/${countryCode}/parties/${partyId}/slate/${electionId}/invitations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            candidateType,
            candidateId,
            invitationNote: note.trim() || undefined,
          }),
        }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Assignment failed (${res.status})`);
      }
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Assignment failed");
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <div className="rounded-lg border border-card-border bg-background p-3 space-y-2">
      {error && <p className="text-xs text-error">{error}</p>}
      <textarea
        rows={2}
        placeholder="Optional note shown on the slate row"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="w-full rounded-md border border-card-border bg-card px-2 py-1 text-xs"
      />
      <div className="grid gap-3 md:grid-cols-2">
        <CandidateAssignmentList
          title="Players"
          emptyLabel={playersEmptyLabel}
          pendingKey={pendingKey}
          rows={eligiblePlayers.map((member) => ({
            key: `character:${member.id}`,
            id: member.id,
            type: "character" as const,
            name: member.name,
            officeLabel: member.currentOffice?.type ?? null,
          }))}
          onAssign={assign}
        />
        <CandidateAssignmentList
          title="NPPs"
          emptyLabel={nppsEmptyLabel}
          pendingKey={pendingKey}
          rows={eligibleNpps.map((member) => ({
            key: `npp:${member.id}`,
            id: member.id,
            type: "npp" as const,
            name: member.name,
            officeLabel: member.currentOffice?.type ?? null,
          }))}
          onAssign={assign}
        />
      </div>
    </div>
  );
}

function CandidateAssignmentList({
  title,
  emptyLabel,
  rows,
  pendingKey,
  onAssign,
}: {
  title: string;
  emptyLabel: string;
  rows: Array<{
    key: string;
    id: string;
    type: "character" | "npp";
    name: string;
    officeLabel: string | null;
  }>;
  pendingKey: string | null;
  onAssign: (candidateType: "character" | "npp", candidateId: string) => Promise<void>;
}) {
  return (
    <div className="rounded-lg border border-card-border bg-card p-2">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
        {title}
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted">{emptyLabel}</p>
      ) : (
        <ul className="max-h-64 overflow-y-auto divide-y divide-card-border/40">
          {rows.map((row) => (
            <li key={row.key} className="flex items-center justify-between gap-2 py-1.5">
              <div className="min-w-0">
                <div className="truncate text-xs">{row.name}</div>
                {row.officeLabel && (
                  <div className="text-[10px] text-muted">{formatSlateLabel(row.officeLabel)}</div>
                )}
              </div>
              <button
                type="button"
                disabled={pendingKey === row.key}
                onClick={() => void onAssign(row.type, row.id)}
                className="rounded-md border border-card-border bg-background px-2 py-1 text-[11px] text-muted hover:text-foreground disabled:opacity-50"
              >
                {pendingKey === row.key ? "..." : "Assign"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WithdrawButton({
  countryCode,
  partyId,
  electionId,
  candidateRowId,
  isFiled,
  candidateName,
  onDone,
}: {
  countryCode: string;
  partyId: string;
  electionId: string;
  candidateRowId: string;
  isFiled: boolean;
  candidateName: string;
  onDone: () => void | Promise<void>;
}) {
  const [pending, setPending] = useState(false);

  async function withdraw() {
    if (
      isFiled &&
      !confirm(
        `${candidateName} has already filed for this race. Withdrawing now will pull them off the ballot. Continue?`
      )
    ) {
      return;
    }
    setPending(true);
    try {
      const res = await fetch(
        `/api/country/${countryCode}/parties/${partyId}/slate/${electionId}/invitations/${candidateRowId}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        // Silent; the surrounding error pane will surface failures on next fetch.
        return;
      }
      await onDone();
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={withdraw}
      className="rounded-md border border-card-border bg-background px-2 py-1 text-[10px] text-muted hover:text-foreground disabled:opacity-50"
    >
      {pending ? "..." : "Withdraw"}
    </button>
  );
}

function RowKV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">{k}</span>
      <span className="tabular-nums">{v}</span>
    </div>
  );
}
