"use client";

import React, { useState } from "react";

interface StockExchangeSnapshotDebugData {
  timestamps: {
    now: string;
    currentTurn: number;
  };
  collections: {
    corporations: number;
    corporateSectors: number;
    stockExchangeSnapshots: number;
    investorRankingSnapshots: number;
  };
  snapshots: {
    nyse: { _id: string; turn: number; listings: unknown[]; createdAt: string } | null;
    ftse: { _id: string; turn: number; listings: unknown[]; createdAt: string } | null;
    global: { _id: string; turn: number; listings: unknown[]; createdAt: string } | null;
    investorRanking: { _id: string; turn: number; rankings: unknown[] } | null;
  };
  sampleCorporations: Array<{
    _id: string;
    name: string;
    type: string;
    headquartersState: string;
    sharePrice: number;
    hiddenFromExchange: boolean;
  }>;
  generationResult?: {
    success: boolean;
    stockExchangeListings: {
      nyse: number;
      ftse: number;
      global: number;
    };
    investorRankings: number;
    error?: string;
  };
}

interface NPPEntryDebugData {
  timestamps: {
    realNow: string;
    gameNow: string;
    lastTurnProcessed: string;
    currentTurn: number;
    isActive: boolean;
  };
  summary: {
    openPrimaries: number;
    allActiveElections: number;
    activeElectionsWithExpiredPrimary: number;
    totalNPPs: number;
    nppsAlreadyInCandidacies: number;
    electionStates: string[];
    nppHomeStates: string[];
    matchingStates: number;
  };
  samplePrimaries: Array<{
    _id: string;
    electionType: string;
    state: string;
    primaryEndTime: string;
    endTime: string;
  }>;
  sampleAnalysis: {
    state: string;
    nppsInState: number;
    partyCounts: Record<string, number>;
    primaries: Array<{
      electionType: string;
      totalCandidates: number;
      nppCandidates: number;
      partiesWithCandidates: string[];
      partiesNeedingCandidates: string[];
      primaryEndTime: string;
      endTime: string;
    }>;
  } | null;
  entrySimulation: {
    party: string;
    state: string;
    steps: Record<string, string | number | boolean | null>;
    sampleNPPs: Array<{
      id: string;
      name: string;
      party: string;
      homeState: string;
      retiredAt: string | null;
      hasCooldown: boolean;
      cooldownValue: string | null;
      allCooldowns: Record<string, string>;
    }>;
  } | null;
}

export function DebugTab() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<NPPEntryDebugData | null>(null);

  // Stock Exchange Snapshot state
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotGenerating, setSnapshotGenerating] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [snapshotData, setSnapshotData] = useState<StockExchangeSnapshotDebugData | null>(null);
  const [clearingCooldowns, setClearingCooldowns] = useState(false);
  const [cooldownResult, setCooldownResult] = useState<{
    success: boolean;
    modified: number;
  } | null>(null);
  const [vacatingPrimaries, setVacatingPrimaries] = useState(false);
  const [vacateResult, setVacateResult] = useState<{
    success: boolean;
    withdrawn: number;
    electionsChecked: number;
  } | null>(null);
  const [reenteringPrimaries, setReenteringPrimaries] = useState(false);
  const [forceEntry, setForceEntry] = useState(false);
  const [reenterResult, setReenterResult] = useState<{
    success: boolean;
    entered: number;
    openPrimaries: number;
  } | null>(null);

  const runNPPEntryDebug = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/debug/npp-entry");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const downloadJSON = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `npp-entry-debug-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const clearCooldowns = async () => {
    if (
      !confirm("Clear all NPP election cooldowns? This will allow NPPs to enter primaries again.")
    ) {
      return;
    }
    setClearingCooldowns(true);
    setCooldownResult(null);
    try {
      const res = await fetch("/api/admin/npps/clear-cooldowns", { method: "POST" });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const json = await res.json();
      setCooldownResult({ success: true, modified: json.modified });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear cooldowns");
    } finally {
      setClearingCooldowns(false);
    }
  };

  const vacatePrimaries = async () => {
    if (
      !confirm(
        "Withdraw all NPPs from active primaries? They will re-enter on the next turn based on current eligibility rules."
      )
    ) {
      return;
    }
    setVacatingPrimaries(true);
    setVacateResult(null);
    try {
      const res = await fetch("/api/admin/npps/vacate-primaries", { method: "POST" });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const json = await res.json();
      setVacateResult({
        success: true,
        withdrawn: json.withdrawn,
        electionsChecked: json.electionsChecked,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to vacate primaries");
    } finally {
      setVacatingPrimaries(false);
    }
  };

  const reenterPrimaries = async () => {
    if (
      !confirm(
        "Force NPPs to re-enter primaries based on current eligibility rules? This runs the same entry logic as the turn processor."
      )
    ) {
      return;
    }
    setReenteringPrimaries(true);
    setReenterResult(null);
    try {
      const qs = forceEntry ? "?forceEntry=true" : "";
      const res = await fetch(`/api/admin/npps/reenter-primaries${qs}`, { method: "POST" });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const json = await res.json();
      setReenterResult({
        success: true,
        entered: json.entered,
        openPrimaries: json.openPrimaries,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to re-enter primaries");
    } finally {
      setReenteringPrimaries(false);
    }
  };

  // Stock Exchange Snapshot functions
  const diagnoseSnapshots = async () => {
    setSnapshotLoading(true);
    setSnapshotError(null);
    try {
      const res = await fetch("/api/admin/debug/stock-exchange-snapshot");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const json = await res.json();
      setSnapshotData(json);
    } catch (err) {
      setSnapshotError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSnapshotLoading(false);
    }
  };

  const generateSnapshots = async () => {
    setSnapshotGenerating(true);
    setSnapshotError(null);
    try {
      const res = await fetch("/api/admin/debug/stock-exchange-snapshot", { method: "POST" });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const json = await res.json();
      setSnapshotData(json);
    } catch (err) {
      setSnapshotError(err instanceof Error ? err.message : "Failed to generate snapshots");
    } finally {
      setSnapshotGenerating(false);
    }
  };

  const downloadSnapshotJSON = () => {
    if (!snapshotData) return;
    const blob = new Blob([JSON.stringify(snapshotData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stock-exchange-snapshot-debug-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Stock Exchange Snapshot Diagnostics */}
      <div className="rounded-lg border border-card-border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold">Stock Exchange Snapshot Diagnostics</h2>
        <p className="mb-4 text-sm text-muted">
          Diagnose stock exchange snapshot state or manually trigger snapshot generation. Snapshots
          are normally generated once per turn for fast Discord bot responses.
        </p>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={diagnoseSnapshots}
            disabled={snapshotLoading}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {snapshotLoading ? "Diagnosing..." : "Diagnose Snapshots"}
          </button>

          <button
            onClick={generateSnapshots}
            disabled={snapshotGenerating}
            className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
          >
            {snapshotGenerating ? "Generating..." : "Generate Snapshots Now"}
          </button>

          {snapshotData && (
            <button
              onClick={downloadSnapshotJSON}
              className="rounded-md border border-card-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:bg-card-hover"
            >
              Download JSON
            </button>
          )}
        </div>

        {snapshotError && (
          <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
            {snapshotError}
          </div>
        )}

        {snapshotData?.generationResult && (
          <div
            className={`mt-4 rounded-md border p-3 text-sm ${
              snapshotData.generationResult.success
                ? "border-green-500/30 bg-green-500/10 text-green-400"
                : "border-red-500/30 bg-red-500/10 text-red-400"
            }`}
          >
            {snapshotData.generationResult.success ? (
              <>
                Generated: NYSE ({snapshotData.generationResult.stockExchangeListings.nyse}), FTSE (
                {snapshotData.generationResult.stockExchangeListings.ftse}), Global (
                {snapshotData.generationResult.stockExchangeListings.global}) listings, plus{" "}
                {snapshotData.generationResult.investorRankings} investor rankings.
              </>
            ) : (
              <>Generation failed: {snapshotData.generationResult.error}</>
            )}
          </div>
        )}

        {snapshotData && (
          <div className="mt-4 space-y-4">
            {/* Collection counts */}
            <div className="rounded border border-card-border/50 p-3">
              <h4 className="mb-2 text-sm font-medium">Collection Counts</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted">Corporations:</span>
                  <span>{snapshotData.collections.corporations}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Corporate Sectors:</span>
                  <span>{snapshotData.collections.corporateSectors}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Exchange Snapshots:</span>
                  <span
                    className={
                      snapshotData.collections.stockExchangeSnapshots === 0
                        ? "text-red-400"
                        : "text-green-400"
                    }
                  >
                    {snapshotData.collections.stockExchangeSnapshots}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Investor Snapshots:</span>
                  <span
                    className={
                      snapshotData.collections.investorRankingSnapshots === 0
                        ? "text-red-400"
                        : "text-green-400"
                    }
                  >
                    {snapshotData.collections.investorRankingSnapshots}
                  </span>
                </div>
              </div>
            </div>

            {/* Snapshot status */}
            <div className="rounded border border-card-border/50 p-3">
              <h4 className="mb-2 text-sm font-medium">Snapshot Status</h4>
              <div className="space-y-2 text-sm">
                {(["nyse", "ftse", "global"] as const).map((exchange) => {
                  const snap = snapshotData.snapshots[exchange];
                  return (
                    <div key={exchange} className="flex justify-between">
                      <span className="text-muted uppercase">{exchange}:</span>
                      {snap ? (
                        <span className="text-green-400">
                          Turn {snap.turn}, {snap.listings?.length ?? 0} listings
                        </span>
                      ) : (
                        <span className="text-red-400">Not generated</span>
                      )}
                    </div>
                  );
                })}
                <div className="flex justify-between">
                  <span className="text-muted">Investor Rankings:</span>
                  {snapshotData.snapshots.investorRanking ? (
                    <span className="text-green-400">
                      Turn {snapshotData.snapshots.investorRanking.turn},{" "}
                      {snapshotData.snapshots.investorRanking.rankings?.length ?? 0} rankings
                    </span>
                  ) : (
                    <span className="text-red-400">Not generated</span>
                  )}
                </div>
              </div>
            </div>

            {/* Sample corporations */}
            {snapshotData.sampleCorporations.length > 0 && (
              <div className="rounded border border-card-border/50 p-3">
                <h4 className="mb-2 text-sm font-medium">
                  Sample Corporations ({snapshotData.sampleCorporations.length})
                </h4>
                <div className="max-h-48 overflow-y-auto text-xs">
                  {snapshotData.sampleCorporations.map((corp) => (
                    <div
                      key={corp._id}
                      className="flex justify-between border-b border-card-border/30 py-1"
                    >
                      <span>
                        {corp.name} ({corp.type})
                      </span>
                      <span className="text-muted">
                        {corp.headquartersState} | ${corp.sharePrice.toFixed(2)}
                        {corp.hiddenFromExchange && " | Hidden"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-card-border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold">NPP Election Entry Diagnostics</h2>
        <p className="mb-4 text-sm text-muted">
          Run diagnostics to understand why NPPs may not be entering primaries. This checks game
          time vs real time, open primaries, NPP availability, and state matching.
        </p>

        <div className="flex gap-3">
          <button
            onClick={runNPPEntryDebug}
            disabled={loading}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? "Running..." : "Run NPP Entry Debug"}
          </button>

          {data && (
            <button
              onClick={downloadJSON}
              className="rounded-md border border-card-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:bg-card-hover"
            >
              Download JSON
            </button>
          )}
        </div>

        {error && (
          <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
            {error}
          </div>
        )}
      </div>

      {/* Clear Cooldowns */}
      <div className="rounded-lg border border-card-border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold">Clear NPP Cooldowns</h2>
        <p className="mb-4 text-sm text-muted">
          If NPPs are blocked from entering primaries due to stale cooldowns, clear them here. This
          removes all election-specific cooldowns from NPP records, allowing them to enter any open
          primary on the next turn.
        </p>

        <button
          onClick={clearCooldowns}
          disabled={clearingCooldowns}
          className="rounded-md bg-yellow-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-yellow-700 disabled:opacity-50"
        >
          {clearingCooldowns ? "Clearing..." : "Clear All NPP Cooldowns"}
        </button>

        {cooldownResult && (
          <div className="mt-4 rounded-md border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-400">
            Cleared cooldowns from {cooldownResult.modified} NPPs.
          </div>
        )}
      </div>

      {/* Vacate Primaries */}
      <div className="rounded-lg border border-card-border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold">Vacate NPP Primaries</h2>
        <p className="mb-4 text-sm text-muted">
          Withdraw all NPPs from active primaries. Use this after fixing eligibility bugs so NPPs
          can re-enter based on the updated rules (country/region restrictions, incumbent priority,
          etc.). NPPs will re-enter on the next turn.
        </p>

        <button
          onClick={vacatePrimaries}
          disabled={vacatingPrimaries}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
        >
          {vacatingPrimaries ? "Withdrawing..." : "Vacate All NPP Primaries"}
        </button>

        {vacateResult && (
          <div className="mt-4 rounded-md border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-400">
            Withdrew {vacateResult.withdrawn} NPPs from {vacateResult.electionsChecked} active
            elections.
          </div>
        )}
      </div>

      {/* Re-enter Primaries */}
      <div className="rounded-lg border border-card-border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold">Re-enter NPP Primaries</h2>
        <p className="mb-4 text-sm text-muted">
          Force NPPs to enter open primaries now based on current eligibility rules (country/region
          restrictions, incumbent priority, party slots). This runs the same entry logic as the turn
          processor without waiting for the next turn.
        </p>

        <div className="flex items-center gap-4">
          <button
            onClick={reenterPrimaries}
            disabled={reenteringPrimaries}
            className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
          >
            {reenteringPrimaries ? "Processing..." : "Re-enter NPP Primaries"}
          </button>
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={forceEntry}
              onChange={(e) => setForceEntry(e.target.checked)}
              className="rounded border-card-border"
            />
            Force entry (include general-phase elections)
          </label>
        </div>

        {reenterResult && (
          <div className="mt-4 rounded-md border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-400">
            {reenterResult.entered} NPPs entered primaries ({reenterResult.openPrimaries} open
            primaries available).
          </div>
        )}
      </div>

      {data && (
        <>
          {/* Timestamps */}
          <div className="rounded-lg border border-card-border bg-card p-6">
            <h3 className="mb-3 font-semibold">Timestamps</h3>
            <div className="grid gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">Real Time:</span>
                <span className="font-mono">{data.timestamps.realNow}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Game Time:</span>
                <span className="font-mono">{data.timestamps.gameNow}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Last Turn Processed:</span>
                <span className="font-mono">{data.timestamps.lastTurnProcessed}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Current Turn:</span>
                <span>{data.timestamps.currentTurn}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Turn System Active:</span>
                <span className={data.timestamps.isActive ? "text-green-400" : "text-yellow-400"}>
                  {data.timestamps.isActive ? "Yes" : "No"}
                </span>
              </div>
            </div>
          </div>

          {/* Summary */}
          <div className="rounded-lg border border-card-border bg-card p-6">
            <h3 className="mb-3 font-semibold">Summary</h3>
            <div className="grid gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">Open Primaries:</span>
                <span
                  className={data.summary.openPrimaries === 0 ? "text-red-400" : "text-green-400"}
                >
                  {data.summary.openPrimaries}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">All Active Elections:</span>
                <span>{data.summary.allActiveElections}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Active Elections with Expired Primary:</span>
                <span className="text-yellow-400">
                  {data.summary.activeElectionsWithExpiredPrimary}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Total NPPs:</span>
                <span>{data.summary.totalNPPs}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">NPPs Already in Candidacies:</span>
                <span>{data.summary.nppsAlreadyInCandidacies}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Matching States:</span>
                <span
                  className={data.summary.matchingStates === 0 ? "text-red-400" : "text-green-400"}
                >
                  {data.summary.matchingStates}
                </span>
              </div>
            </div>

            <div className="mt-4 space-y-2 text-sm">
              <div>
                <span className="text-muted">Election States: </span>
                <span className="font-mono text-xs">
                  {data.summary.electionStates.join(", ") || "(none)"}
                </span>
              </div>
              <div>
                <span className="text-muted">NPP Home States: </span>
                <span className="font-mono text-xs">
                  {data.summary.nppHomeStates.join(", ") || "(none)"}
                </span>
              </div>
            </div>
          </div>

          {/* Sample Primaries */}
          {data.samplePrimaries.length > 0 && (
            <div className="rounded-lg border border-card-border bg-card p-6">
              <h3 className="mb-3 font-semibold">Sample Open Primaries</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-card-border text-left text-muted">
                      <th className="pb-2">Type</th>
                      <th className="pb-2">State</th>
                      <th className="pb-2">Primary Ends</th>
                      <th className="pb-2">Election Ends</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.samplePrimaries.map((p) => (
                      <tr key={p._id} className="border-b border-card-border/50">
                        <td className="py-2">{p.electionType}</td>
                        <td className="py-2 font-mono">{p.state}</td>
                        <td className="py-2 font-mono text-xs">{p.primaryEndTime}</td>
                        <td className="py-2 font-mono text-xs">{p.endTime}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Sample Analysis */}
          {data.sampleAnalysis && (
            <div className="rounded-lg border border-card-border bg-card p-6">
              <h3 className="mb-3 font-semibold">
                Sample State Analysis: {data.sampleAnalysis.state}
              </h3>
              <div className="mb-4 text-sm">
                <span className="text-muted">NPPs in state: </span>
                <span>{data.sampleAnalysis.nppsInState}</span>
              </div>

              <div className="mb-4">
                <span className="text-sm text-muted">Party Counts:</span>
                <div className="mt-1 flex flex-wrap gap-2">
                  {Object.entries(data.sampleAnalysis.partyCounts).map(([party, count]) => (
                    <span key={party} className="rounded bg-card-hover px-2 py-1 text-xs font-mono">
                      {party}: {count}
                    </span>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                {data.sampleAnalysis.primaries.map((primary, i) => (
                  <div key={i} className="rounded border border-card-border/50 p-3 text-sm">
                    <div className="mb-2 font-medium">{primary.electionType}</div>
                    <div className="grid gap-1 text-xs">
                      <div>
                        <span className="text-muted">Candidates: </span>
                        {primary.totalCandidates} total, {primary.nppCandidates} NPPs
                      </div>
                      <div>
                        <span className="text-muted">Parties with candidates: </span>
                        {primary.partiesWithCandidates.join(", ") || "(none)"}
                      </div>
                      <div>
                        <span className="text-muted">Parties needing candidates: </span>
                        <span className="text-yellow-400">
                          {primary.partiesNeedingCandidates.join(", ") || "(none)"}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Entry Simulation */}
          {data.entrySimulation && (
            <div className="rounded-lg border border-card-border bg-card p-6">
              <h3 className="mb-3 font-semibold">
                Entry Simulation: {data.entrySimulation.party} in {data.entrySimulation.state}
              </h3>
              <p className="mb-4 text-sm text-muted">
                Step-by-step trace of why an NPP would or would not enter the first available
                primary.
              </p>

              <div className="mb-4 space-y-1 text-sm">
                {Object.entries(data.entrySimulation.steps).map(([key, value]) => {
                  const isBoolean = typeof value === "boolean";
                  const isFail =
                    (key.includes("Found") && value === false) ||
                    (key.includes("Blocked") && value === true) ||
                    (key.includes("wouldEnter") && value === false);
                  const isPass =
                    (key.includes("Found") && value === true) ||
                    (key.includes("Blocked") && value === false) ||
                    (key.includes("wouldEnter") && value === true);

                  return (
                    <div key={key} className="flex justify-between font-mono text-xs">
                      <span className="text-muted">{key}:</span>
                      <span
                        className={
                          isFail ? "text-red-400" : isPass ? "text-green-400" : "text-foreground"
                        }
                      >
                        {isBoolean ? (value ? "true" : "false") : String(value ?? "null")}
                      </span>
                    </div>
                  );
                })}
              </div>

              {data.entrySimulation.sampleNPPs.length > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-medium">Sample Available NPPs:</h4>
                  <div className="space-y-2">
                    {data.entrySimulation.sampleNPPs.map((npp) => (
                      <div
                        key={npp.id}
                        className="rounded border border-card-border/50 p-2 text-xs"
                      >
                        <div className="font-medium">{npp.name}</div>
                        <div className="text-muted">
                          {npp.party} | {npp.homeState}
                        </div>
                        <div className={npp.hasCooldown ? "text-red-400" : "text-green-400"}>
                          Cooldown: {npp.hasCooldown ? `Yes (${npp.cooldownValue})` : "No"}
                        </div>
                        {npp.hasCooldown && Object.keys(npp.allCooldowns).length > 0 && (
                          <div className="mt-1 text-muted">
                            All cooldowns: {Object.keys(npp.allCooldowns).length} election(s)
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
