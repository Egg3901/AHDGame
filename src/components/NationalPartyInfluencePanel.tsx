"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { partyApiUrl } from "@/lib/urls";
import { useToast } from "@/contexts/ToastContext";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { formatLocalFunds } from "@/lib/actions";
import { useInfluencePanelState } from "./influence/useInfluencePanelState";
import {
  InfluencePanelLoading,
  InfluencePanelError,
  InfluenceResultMessage,
  InfluenceErrorMessage,
  CostAndChanceSummary,
} from "./influence/InfluencePanelShared";
import {
  useInfluenceQueue,
  InfluenceQueueDisplay,
  type QueueResult,
} from "./influence/InfluenceQueue";
import {
  getStatCapOverride,
  type ElectionContext,
  type CandidateContext,
  type NPPCandidacy,
  type NPPOption,
  type ActionOption,
} from "./influence/types";
import { UK_REGIONS } from "@/lib/constants/uk";
import { ELECTION_STATE_NAMES } from "@/app/elections/electionsHelpers";
import { buildRaceBuckets } from "./influence/raceBuckets";
import { getRelocationBlockReason } from "./influence/relocationBlockReason";
import { NppRosterPanel } from "./influence/NppRosterPanel";

/** Stat-management actions the at-a-glance roster handles (the rest stay in Advanced). */
const ROSTER_ACTION_TYPES: ActionOption["type"][] = [
  "boost_loyalty",
  "boost_favorability",
  "boost_influence",
  "reduce_stubbornness",
];

function formatStateName(stateId: string): string {
  const ukRegion = UK_REGIONS.find((r) => r.id === stateId);
  if (ukRegion) return ukRegion.name;
  return ELECTION_STATE_NAMES[stateId] ?? stateId;
}

function getStateDisplayName(stateId: string, stateNames?: Record<string, string>): string {
  return stateNames?.[stateId] ?? formatStateName(stateId);
}

function formatNationalNppStat(value: number) {
  return value.toFixed(1);
}

interface InfluenceData {
  partyId: string;
  partyName: string;
  politicalStrength: number;
  treasury: number;
  nppActionPoints: number;
  nppActionPointCap: number;
  nppActionPointRegen: number;
  actions: ActionOption[];
  availableStates: string[];
  stateNames: Record<string, string>;
  targetStates: Array<{
    id: string;
    name: string;
    actionCost: number;
    fundCost: number;
    currentNPPs: number;
    maxSlots: number;
    full: boolean;
  }>;
  nppsByState: Record<string, NPPOption[]>;
  context: {
    activeElections: ElectionContext[];
    nppCandidacies: NPPCandidacy[];
    candidates: CandidateContext[];
  };
}

interface NationalPartyInfluencePanelProps {
  partyId: string;
  partyColor: string;
  country: string;
  onPartyRefresh?: () => void | Promise<void>;
}

export function NationalPartyInfluencePanel({
  partyId,
  partyColor,
  country,
  onPartyRefresh,
}: NationalPartyInfluencePanelProps) {
  const { showToast } = useToast();
  const countryUpper = country.toUpperCase() as CountryId;
  const regionLabel = COUNTRY_CONFIGS[countryUpper]?.regionLabel ?? "State";
  const currencyCode = COUNTRY_CONFIGS[countryUpper]?.currencyCode ?? "USD";
  const regionLabelLower = regionLabel.toLowerCase();

  const [data, setData] = useState<InfluenceData | null>(null);
  const [selectedState, setSelectedState] = useState("");
  const [selectedRace, setSelectedRace] = useState("");
  const [selectedNPP, setSelectedNPP] = useState("");
  const {
    loading,
    setLoading,
    error,
    setError,
    selectedAction,
    setSelectedAction,
    selectedElection,
    setSelectedElection,
    selectedCandidate,
    setSelectedCandidate,
    selectedTargetState,
    setSelectedTargetState,
    executing,
    setExecuting,
    result,
    setResult,
  } = useInfluencePanelState();

  const {
    queue,
    results: queueResults,
    setResults: setQueueResults,
    addToQueue,
    removeFromQueue,
    clearQueue,
    getTotalCost,
  } = useInfluenceQueue();

  const fetchData = useCallback(
    async ({ background = false }: { background?: boolean } = {}) => {
      try {
        // Background refreshes (after an action) skip the full-panel loading swap so
        // the roster stays mounted and the NPP selection is preserved.
        if (!background) setLoading(true);
        setError("");
        const res = await fetch(`${partyApiUrl(country, partyId)}/influence`);
        if (res.ok) {
          setData(await res.json());
        } else if (res.status === 401 || res.status === 403) {
          setData(null);
        } else {
          const json = await res.json();
          setError(json.error || "Failed to load influence options");
        }
      } catch {
        setError("Network error");
      } finally {
        if (!background) setLoading(false);
      }
    },
    [country, partyId, setError, setLoading]
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const racesInSelectedState = useMemo(() => {
    if (!selectedState || !data) return [];
    return buildRaceBuckets({
      state: selectedState,
      npps: data.nppsByState[selectedState] ?? [],
      activeElections: data.context.activeElections,
      nppCandidacies: data.context.nppCandidacies,
    });
  }, [selectedState, data]);

  const handleAddToQueue = () => {
    if (!selectedNPP || !selectedAction || !data) return;

    const actionConfig = data.actions.find((a) => a.type === selectedAction);
    const nppData = (data.nppsByState[selectedState] || []).find((n) => n.id === selectedNPP);
    if (!actionConfig || !nppData) return;
    const selectedTargetStateData = data.targetStates.find(
      (state) => state.id === selectedTargetState
    );

    let effectiveActionCost = actionConfig.actionCost;
    let effectiveFundCost = actionConfig.baseFundCost;
    let contextLabel = "";

    if (selectedAction === "relocate_state") {
      if (!selectedTargetStateData) {
        setError(`Please select a target ${regionLabelLower}`);
        return;
      }
      effectiveActionCost = selectedTargetStateData.actionCost;
      effectiveFundCost = selectedTargetStateData.fundCost;
      contextLabel = `to ${selectedTargetStateData.name}`;
    }

    if (selectedAction === "oppose_candidate" && (!selectedElection || !selectedCandidate)) {
      setError("Please select an election and candidate");
      return;
    }
    if (selectedAction === "relocate_state" && !selectedTargetState) {
      setError(`Please select a target ${regionLabelLower}`);
      return;
    }

    addToQueue({
      nppId: selectedNPP,
      nppName: nppData.name,
      influenceType: selectedAction,
      actionName: actionConfig.name,
      actionCost: effectiveActionCost,
      baseFundCost: effectiveFundCost,
      context: {
        electionId: selectedElection || undefined,
        candidateId: selectedCandidate || undefined,
        targetStateId: selectedTargetState || undefined,
      },
      contextLabel,
    });
    setError("");
  };

  const handleExecute = async () => {
    if (!selectedNPP || !selectedAction || !data) return;

    const actionConfig = data.actions.find((a) => a.type === selectedAction);
    if (!actionConfig) return;

    if (selectedAction === "oppose_candidate" && (!selectedElection || !selectedCandidate)) {
      setError("Please select an election and candidate");
      return;
    }
    if (selectedAction === "relocate_state" && !selectedTargetState) {
      setError(`Please select a target ${regionLabelLower}`);
      return;
    }

    setExecuting(true);
    setError("");
    setResult(null);

    try {
      const res = await fetch(`${partyApiUrl(country, partyId)}/influence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nppId: selectedNPP,
          influenceType: selectedAction,
          fundAmount: 0,
          context: {
            electionId: selectedElection || undefined,
            candidateId: selectedCandidate || undefined,
            targetStateId: selectedTargetState || undefined,
          },
        }),
      });

      const json = await res.json();
      if (res.ok) {
        setResult({
          success: json.success,
          message: json.message,
          outcome: json.outcome,
        });
        await fetchData({ background: true });
        await onPartyRefresh?.();
      } else {
        setError(json.error || "Failed to execute influence");
      }
    } catch {
      setError("Network error");
    } finally {
      setExecuting(false);
    }
  };

  const handleExecuteQueue = async () => {
    if (queue.length === 0 || !data) return;

    setExecuting(true);
    setError("");

    try {
      const res = await fetch(`${partyApiUrl(country, partyId)}/influence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queue: queue.map((item) => ({
            nppId: item.nppId,
            influenceType: item.influenceType,
            fundAmount: 0,
            context: item.context,
          })),
        }),
      });

      const json = await res.json();
      if (res.ok) {
        setQueueResults(json.results as QueueResult[]);
        await fetchData({ background: true });
        await onPartyRefresh?.();
      } else {
        setError(json.error || "Failed to execute queue");
      }
    } catch {
      setError("Network error");
    } finally {
      setExecuting(false);
    }
  };

  const handleStatExecute = async (nppId: string, type: ActionOption["type"]) => {
    try {
      const res = await fetch(`${partyApiUrl(country, partyId)}/influence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nppId, influenceType: type, fundAmount: 0, context: {} }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        if (json.message) showToast(json.message, json.success ? "success" : "info");
        await fetchData({ background: true });
        await onPartyRefresh?.();
        return { ok: true };
      }
      setError(json.error || "Failed to execute influence");
      return { ok: false };
    } catch {
      setError("Network error");
      return { ok: false };
    }
  };

  if (!loading && !data && !error) return null;
  if (loading) return <InfluencePanelLoading />;
  if (error && !data) return <InfluencePanelError message={error} />;
  if (!data) return null;

  const rosterNpps = Object.entries(data.nppsByState).flatMap(([st, list]) =>
    list.map((n) => ({ ...n, homeState: st }))
  );
  const rosterActions = data.actions.filter((a) => ROSTER_ACTION_TYPES.includes(a.type));

  const statesWithNPPs = Object.keys(data.nppsByState).sort();
  const nppsInSelectedState = selectedRace
    ? (racesInSelectedState.find((r) => r.key === selectedRace)?.npps ?? [])
    : [];
  const selectedNPPData = nppsInSelectedState.find((n) => n.id === selectedNPP);
  const actionsForSelectedTarget: ActionOption[] = data.actions.map((action) => {
    const override = getStatCapOverride(action.type, selectedNPPData?.stats ?? null);
    return override ? { ...action, ...override } : action;
  });
  const selectedActionConfig = actionsForSelectedTarget.find((a) => a.type === selectedAction);
  const selectedTargetStateData = data.targetStates.find(
    (state) => state.id === selectedTargetState
  );
  const targetStateOptions =
    selectedNPPData && selectedState
      ? data.targetStates.filter((state) => state.id !== selectedState)
      : [];
  // A refused relocation used to look like a dead button: the picker disabled
  // full targets with no explanation. Name the wall before the click.
  const relocationBlockReason =
    selectedAction === "relocate_state"
      ? getRelocationBlockReason({
          targetOptions: targetStateOptions,
          selectedTargetId: selectedTargetState,
          regionLabelLower,
        })
      : null;
  const filteredCandidates = selectedElection
    ? data.context.candidates.filter((c) => c.electionId === selectedElection)
    : [];
  const electionsInState = selectedState
    ? data.context.activeElections.filter((e) => e.state === selectedState)
    : [];

  const totalActionCost =
    selectedAction === "relocate_state"
      ? selectedTargetStateData?.actionCost || 0
      : selectedActionConfig?.actionCost || 0;
  const totalFundCost =
    selectedAction === "relocate_state"
      ? selectedTargetStateData?.fundCost || 0
      : selectedActionConfig?.baseFundCost || 0;
  const estimatedChance = selectedNPPData?.estimatedChance ?? 0;
  const successLabel =
    selectedAction === "boost_favorability" || selectedAction === "boost_influence"
      ? "Likely to Accept"
      : estimatedChance >= 50
        ? "Likely to Accept"
        : "Likely to Decline";

  const totalNPPs = Object.values(data.nppsByState).reduce((sum, npps) => sum + npps.length, 0);
  const queueTotalCost = getTotalCost();

  return (
    <div
      className="rounded-xl border p-6"
      style={{
        borderColor: `${partyColor}50`,
        backgroundColor: `${partyColor}10`,
      }}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">National Party NPP Influence</h2>
        <div className="flex items-center gap-4 text-sm">
          <span>
            <span className="text-muted">Action Points: </span>
            <span className="font-medium">
              {data.nppActionPoints ?? 0} / {data.nppActionPointCap ?? 0}
            </span>
            <span className="ml-1 text-xs text-muted">(+{data.nppActionPointRegen ?? 0}/turn)</span>
          </span>
        </div>
      </div>

      <div className="mb-4 rounded-lg bg-blue-500/10 p-3 text-sm text-blue-400">
        National party leadership can influence same-party NPPs in any {regionLabelLower} and
        coordinate relocations when the party needs to shift talent around the map.
      </div>

      {result && <InfluenceResultMessage result={result} />}
      {error && <InfluenceErrorMessage message={error} />}

      {totalNPPs === 0 ? (
        <div className="py-4 text-center text-muted">
          No same-party NPPs are currently available for national party management.
        </div>
      ) : (
        <>
          <NppRosterPanel
            scope="national"
            npps={rosterNpps}
            actions={rosterActions}
            currency={currencyCode}
            onExecute={handleStatExecute}
          />

          <details className="mt-4 rounded-lg border border-card-border">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-muted">
              Advanced actions: relocate, oppose a candidate, or queue
            </summary>
            <div className="space-y-1 p-3">
              <div className="mb-4">
                <label className="mb-2 block text-sm font-medium">Select {regionLabel}</label>
                <select
                  aria-label="Advanced: select state"
                  value={selectedState}
                  onChange={(e) => {
                    setSelectedState(e.target.value);
                    setSelectedRace("");
                    setSelectedNPP("");
                    setSelectedAction(null);
                    setSelectedElection("");
                    setSelectedCandidate("");
                    setSelectedTargetState("");
                  }}
                  className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm"
                >
                  <option value="">-- Select a {regionLabelLower} --</option>
                  {statesWithNPPs.map((state) => (
                    <option key={state} value={state}>
                      {getStateDisplayName(state, data.stateNames)} (
                      {data.nppsByState[state].length} NPP
                      {data.nppsByState[state].length !== 1 ? "s" : ""})
                    </option>
                  ))}
                </select>
              </div>

              {selectedState && racesInSelectedState.length > 0 && (
                <div className="mb-4">
                  <label className="mb-2 block text-sm font-medium">Select Race</label>
                  <select
                    aria-label="Advanced: select race"
                    value={selectedRace}
                    onChange={(e) => {
                      setSelectedRace(e.target.value);
                      setSelectedNPP("");
                      setSelectedAction(null);
                      setSelectedElection("");
                      setSelectedCandidate("");
                      setSelectedTargetState("");
                    }}
                    className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm"
                  >
                    <option value="">-- Select a race --</option>
                    {racesInSelectedState.map((race) => (
                      <option key={race.key} value={race.key}>
                        {race.label} ({race.npps.length} NPP{race.npps.length !== 1 ? "s" : ""})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {selectedState && selectedRace && nppsInSelectedState.length > 0 && (
                <>
                  <div className="mb-4">
                    <label className="mb-2 block text-sm font-medium">
                      Select NPP to Influence
                    </label>
                    <select
                      aria-label="Advanced: select NPP"
                      value={selectedNPP}
                      onChange={(e) => {
                        setSelectedNPP(e.target.value);
                        setSelectedAction(null);
                        setSelectedElection("");
                        setSelectedCandidate("");
                        setSelectedTargetState("");
                      }}
                      className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm"
                    >
                      <option value="">-- Select an NPP --</option>
                      {nppsInSelectedState.map((npp) => (
                        <option key={npp.id} value={npp.id}>
                          {npp.name} ({npp.party})
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedNPP && selectedNPPData && (
                    <>
                      <div className="mb-4 rounded-lg bg-background p-4 text-sm">
                        <div className="mb-3 flex items-center justify-between">
                          <Link
                            href={`/politicians/npp/${selectedNPP}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {selectedNPPData.name}
                          </Link>
                          <span
                            className={
                              selectedNPPData.party === partyId ? "text-green-400" : "text-muted"
                            }
                          >
                            {selectedNPPData.party === partyId
                              ? "Same Party"
                              : selectedNPPData.party}
                          </span>
                        </div>
                        {selectedNPPData.stats && (
                          <div className="grid grid-cols-2 gap-3 border-t border-card-border pt-3 sm:grid-cols-3">
                            <div className="flex flex-col">
                              <span className="text-xs text-muted">Favorability</span>
                              <span className="font-medium">
                                {formatNationalNppStat(selectedNPPData.stats.favorability)}/100
                              </span>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-xs text-muted">Political Influence</span>
                              <span className="font-medium">
                                {formatNationalNppStat(selectedNPPData.stats.politicalInfluence)}
                                /100
                              </span>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-xs text-muted">Loyalty</span>
                              <span className="font-medium">
                                {formatNationalNppStat(selectedNPPData.stats.loyalty)}/100
                              </span>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-xs text-muted">Ambition</span>
                              <span className="font-medium">
                                {formatNationalNppStat(selectedNPPData.stats.ambition)}/100
                              </span>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-xs text-muted">Stubbornness</span>
                              <span className="font-medium">
                                {formatNationalNppStat(selectedNPPData.stats.stubbornness)}/100
                              </span>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="mb-4">
                        <label className="mb-2 block text-sm font-medium">Select Action</label>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {actionsForSelectedTarget.map((action) => (
                            <button
                              key={action.type}
                              onClick={() => {
                                setSelectedAction(action.type);
                                setSelectedElection("");
                                setSelectedCandidate("");
                                setSelectedTargetState("");
                              }}
                              disabled={!action.available}
                              className={`rounded-lg border p-3 text-left transition-colors ${
                                selectedAction === action.type
                                  ? "border-primary bg-primary/20"
                                  : action.available
                                    ? "border-card-border bg-card hover:border-primary/50"
                                    : "cursor-not-allowed border-card-border bg-card/50 opacity-50"
                              }`}
                            >
                              <div className="font-medium">{action.name}</div>
                              <div className="mt-1 text-xs text-muted">{action.description}</div>
                              <div className="mt-2 flex items-center gap-3 text-xs">
                                <span>{action.actionCost} AP</span>
                                {action.baseFundCost > 0 && (
                                  <span className="text-green-400">
                                    {formatLocalFunds(action.baseFundCost, currencyCode)}
                                  </span>
                                )}
                              </div>
                              {!action.available && action.unavailableReason && (
                                <div className="mt-2 text-xs text-red-400">
                                  {action.unavailableReason}
                                </div>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>

                      {selectedAction && selectedActionConfig && (
                        <div className="space-y-4 border-t border-card-border pt-4">
                          {selectedAction === "oppose_candidate" && (
                            <div>
                              <label className="mb-2 block text-sm font-medium">
                                Select Election
                              </label>
                              <select
                                value={selectedElection}
                                onChange={(e) => {
                                  setSelectedElection(e.target.value);
                                  setSelectedCandidate("");
                                }}
                                className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm"
                              >
                                <option value="">-- Select an election --</option>
                                {electionsInState.map((election) => (
                                  <option key={election.id} value={election.id}>
                                    {election.label}
                                  </option>
                                ))}
                              </select>
                              {electionsInState.length === 0 && (
                                <p className="mt-1 text-xs text-muted">
                                  No active elections in{" "}
                                  {getStateDisplayName(selectedState, data.stateNames)}
                                </p>
                              )}
                            </div>
                          )}

                          {selectedAction === "oppose_candidate" && selectedElection && (
                            <div>
                              <label className="mb-2 block text-sm font-medium">
                                Select Candidate
                              </label>
                              <select
                                value={selectedCandidate}
                                onChange={(e) => setSelectedCandidate(e.target.value)}
                                className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm"
                              >
                                <option value="">-- Select a candidate --</option>
                                {(() => {
                                  const byParty = new Map<string, typeof filteredCandidates>();
                                  for (const c of filteredCandidates) {
                                    const parties = byParty.get(c.party) ?? [];
                                    parties.push(c);
                                    byParty.set(c.party, parties);
                                  }
                                  return Array.from(byParty.entries()).map(
                                    ([partyKey, candidates]) => (
                                      <optgroup
                                        key={partyKey}
                                        label={partyKey.charAt(0).toUpperCase() + partyKey.slice(1)}
                                      >
                                        {candidates.map((candidate) => (
                                          <option key={candidate.id} value={candidate.id}>
                                            {candidate.name}
                                            {candidate.isNPP ? " [NPP]" : ""}
                                          </option>
                                        ))}
                                      </optgroup>
                                    )
                                  );
                                })()}
                              </select>
                            </div>
                          )}

                          {selectedAction === "relocate_state" && (
                            <div>
                              <label className="mb-2 block text-sm font-medium">
                                Select Target {regionLabel}
                              </label>
                              <select
                                value={selectedTargetState}
                                onChange={(e) => {
                                  setSelectedTargetState(e.target.value);
                                }}
                                className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm"
                              >
                                <option value="">-- Select a target {regionLabelLower} --</option>
                                {targetStateOptions.map((state) => (
                                  <option key={state.id} value={state.id} disabled={state.full}>
                                    {state.name} ({state.actionCost} AP)
                                    {state.full
                                      ? `: full (${state.currentNPPs}/${state.maxSlots})`
                                      : ""}
                                  </option>
                                ))}
                              </select>
                              {targetStateOptions.length === 0 && (
                                <p className="mt-1 text-xs text-muted">
                                  No alternate {regionLabelLower}s are available for this relocation
                                  request.
                                </p>
                              )}
                              {relocationBlockReason && (
                                <p
                                  role="status"
                                  className="mt-2 rounded-lg bg-yellow-500/20 p-2 text-xs text-yellow-400"
                                >
                                  {relocationBlockReason}
                                </p>
                              )}
                            </div>
                          )}

                          <CostAndChanceSummary
                            actionCost={totalActionCost}
                            fundCost={totalFundCost}
                            currency={currencyCode}
                            estimatedChance={estimatedChance}
                            successLabel={successLabel}
                          />

                          <div className="flex gap-2">
                            <button
                              onClick={handleExecute}
                              disabled={
                                executing ||
                                !selectedActionConfig.available ||
                                (data.nppActionPoints ?? 0) < totalActionCost ||
                                data.treasury < totalFundCost ||
                                (selectedAction === "oppose_candidate" &&
                                  (!selectedElection || !selectedCandidate)) ||
                                (selectedAction === "relocate_state" &&
                                  (!selectedTargetState || relocationBlockReason !== null))
                              }
                              className="flex-1 rounded-lg py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
                              style={{ backgroundColor: partyColor }}
                            >
                              {executing ? "Attempting..." : "Execute Now"}
                            </button>
                            <button
                              onClick={handleAddToQueue}
                              disabled={
                                !selectedActionConfig.available ||
                                (selectedAction === "oppose_candidate" &&
                                  (!selectedElection || !selectedCandidate)) ||
                                (selectedAction === "relocate_state" &&
                                  (!selectedTargetState || relocationBlockReason !== null))
                              }
                              className="flex-1 rounded-lg border border-card-border bg-card py-2 text-sm font-medium transition-colors hover:bg-card-muted disabled:opacity-50"
                            >
                              Add to Queue
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              <InfluenceQueueDisplay
                queue={queue}
                results={queueResults}
                onRemove={removeFromQueue}
                onClear={clearQueue}
                onExecute={handleExecuteQueue}
                executing={executing}
                totalActions={queueTotalCost.actions}
                totalFunds={queueTotalCost.funds}
                availableActions={data.nppActionPoints ?? 0}
                availableFunds={data.treasury ?? 0}
                currency={currencyCode}
                partyColor={partyColor}
              />
            </div>
          </details>
        </>
      )}
    </div>
  );
}
