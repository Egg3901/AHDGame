"use client";

import { useEffect, useState } from "react";
import { COMMODITY_LABELS, COMMODITY_UNITS } from "@/lib/constants/commodities";
import { GrantContractModal } from "@/components/congress/GrantContractModal";
import { IssueExtractionContractModal } from "@/components/extraction/IssueExtractionContractModal";
import { CommissionSurveyModal } from "@/components/extraction/CommissionSurveyModal";
import { ContractStatusBadge } from "@/components/extraction/ContractStatusBadge";
import { effectiveContractStatus } from "@/components/extraction/types";
import { useExtractionIssuerAccess } from "@/hooks/useExtractionIssuerAccess";
import { useProspectingSurveys } from "@/hooks/useProspectingSurveys";
import { useGameTurnStatus } from "@/hooks/useGameEvents";
import { ProspectingSurveyList } from "@/components/extraction/ProspectingSurveyList";
import { GOVT_CONTRACT_MAX_TOTAL_SHARE } from "@/lib/constants/prospecting";
import type { ExtractableResource } from "@/lib/constants/commodities";

interface ResourceSummaryRow {
  resource: ExtractableResource;
  capacityPerTurn: number;
  contractedPct: number;
  openAccessPct: number;
  overAllocated: boolean;
  currentOutput: number;
}

interface ContractRow {
  _id: string;
  corporationId: string;
  corporationName?: string;
  resource: ExtractableResource;
  share: number;
  grantedBy: string;
  grantedByLevel: "state" | "national";
  status?: "offered" | "active" | "declined" | "expired" | "defaulted";
  revokedTurn?: number;
  royaltyRatePerTurn?: number;
}

interface ResourcesData {
  stateId: string;
  summary: ResourceSummaryRow[];
  contracts: ContractRow[];
  /** gameConfig.prospectingEnabled — assumed attached alongside the existing summary payload. */
  prospectingEnabled?: boolean;
  /** gameConfig.contractIssuanceEnabled — assumed attached alongside the existing summary payload. */
  contractIssuanceEnabled?: boolean;
}

interface Props {
  stateId: string;
  /** Country owning the state (US/UK/DE/CN/...). Required for cross-country state-ID disambiguation. */
  countryId: string;
  isAdmin?: boolean;
}

export function ResourcesTab({ stateId, countryId, isAdmin = false }: Props) {
  const [data, setData] = useState<ResourcesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showGrantModal, setShowGrantModal] = useState(false);
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [showSurveyModal, setShowSurveyModal] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const gameTurn = useGameTurnStatus();
  const { isStateIssuer } = useExtractionIssuerAccess(countryId, stateId);
  const {
    surveys,
    loading: surveysLoading,
    refresh: refreshSurveys,
  } = useProspectingSurveys({
    stateId,
    countryId,
    enabled: !!data?.prospectingEnabled,
  });

  useEffect(() => {
    fetch(`/api/states/${stateId}/resources`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [stateId, refreshKey]);

  async function handleRevoke(id: string) {
    setRevoking(id);
    setRevokeError("");
    const res = await fetch(`/api/contracts/extraction/${id}/revoke`, { method: "POST" });
    setRevoking(null);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setRevokeError(json.error ?? "Failed to revoke contract");
      return;
    }
    setRefreshKey((k) => k + 1);
  }

  if (loading) {
    return (
      <div className="py-12 text-center text-sm text-muted animate-pulse">Loading resources...</div>
    );
  }

  if (!data || data.summary.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted">
        No significant extractable resources in this state.
      </div>
    );
  }

  const canGovern = isAdmin || isStateIssuer;

  // KPI strip values
  const totalCapacity = data.summary.reduce((s, r) => s + r.capacityPerTurn, 0);
  const totalOutput = data.summary.reduce((s, r) => s + r.currentOutput, 0);
  const avgUtilization = totalCapacity > 0 ? totalOutput / totalCapacity : 0;
  const activeContracts = data.contracts.filter(
    (c) => effectiveContractStatus(c) === "active"
  ).length;

  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-card-border bg-card p-3.5">
          <span className="text-[9px] font-medium uppercase tracking-widest text-muted">
            Resources
          </span>
          <span className="text-lg font-bold tabular-nums text-foreground">
            {data.summary.length}
          </span>
        </div>
        <div className="rounded-xl border border-card-border bg-card p-3.5">
          <span className="text-[9px] font-medium uppercase tracking-widest text-muted">
            Total Output
          </span>
          <span className="text-lg font-bold tabular-nums text-success">
            {totalOutput.toLocaleString("en-US", { maximumFractionDigits: 0 })}
          </span>
        </div>
        <div className="rounded-xl border border-card-border bg-card p-3.5">
          <span className="text-[9px] font-medium uppercase tracking-widest text-muted">
            Avg Utilization
          </span>
          <span
            className={`text-lg font-bold tabular-nums ${
              avgUtilization >= 1
                ? "text-error"
                : avgUtilization >= 0.8
                  ? "text-warning"
                  : "text-foreground"
            }`}
          >
            {(avgUtilization * 100).toFixed(0)}%
          </span>
        </div>
        <div className="rounded-xl border border-card-border bg-card p-3.5">
          <span className="text-[9px] font-medium uppercase tracking-widest text-muted">
            Active Contracts
          </span>
          <span className="text-lg font-bold tabular-nums text-primary">{activeContracts}</span>
        </div>
      </div>

      <section className="rounded-xl border border-card-border bg-card p-5 shadow-card">
        <div className="mb-4 flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-semibold uppercase tracking-widest text-muted">
            Resource Capacity
          </h3>
          {data.prospectingEnabled && canGovern && (
            <button
              onClick={() => setShowSurveyModal(true)}
              className="rounded-lg border border-card-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-card-elevated transition-colors"
            >
              Commission Geological Survey
            </button>
          )}
        </div>
        <div className="overflow-x-auto rounded-lg border border-card-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border bg-card-elevated">
                <th className="px-4 py-3 text-left font-medium text-muted">Resource</th>
                <th className="px-4 py-3 text-right font-medium text-muted">Capacity / turn</th>
                <th className="px-4 py-3 text-right font-medium text-muted">Contracted</th>
                <th className="px-4 py-3 text-right font-medium text-muted">Open-access</th>
                <th className="px-4 py-3 text-right font-medium text-muted">Current output</th>
                <th className="px-4 py-3 text-left font-medium text-muted">Utilization</th>
                <th className="px-4 py-3 text-left font-medium text-muted">
                  Contract headroom (75% cap)
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.summary.map((row) => {
                const utilization =
                  row.capacityPerTurn > 0 ? row.currentOutput / row.capacityPerTurn : 0;
                const barColor =
                  row.overAllocated || utilization >= 1
                    ? "bg-error"
                    : utilization >= 0.8
                      ? "bg-warning"
                      : utilization >= 0.5
                        ? "bg-primary"
                        : "bg-success";
                const headroomUsedPct = Math.min(
                  1,
                  row.contractedPct / GOVT_CONTRACT_MAX_TOTAL_SHARE
                );
                return (
                  <tr key={row.resource} className="border-b border-card-border last:border-0">
                    <td className="px-4 py-3 font-medium">{COMMODITY_LABELS[row.resource]}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {row.capacityPerTurn.toLocaleString("en-US")} {COMMODITY_UNITS[row.resource]}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {(row.contractedPct * 100).toFixed(1)}%
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {(row.openAccessPct * 100).toFixed(1)}%
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {row.currentOutput.toLocaleString("en-US", { maximumFractionDigits: 0 })}{" "}
                      {COMMODITY_UNITS[row.resource]}
                    </td>
                    <td className="px-4 py-3">
                      {row.capacityPerTurn > 0 ? (
                        <div className="flex items-center gap-2">
                          <div
                            className="h-1.5 w-24 overflow-hidden rounded-full bg-card-elevated"
                            title={`${(utilization * 100).toFixed(1)}% of capacity used`}
                          >
                            <div
                              className={`h-full ${barColor} transition-[width]`}
                              style={{ width: `${Math.min(100, utilization * 100)}%` }}
                            />
                          </div>
                          <span className="min-w-[36px] tabular-nums text-xs text-muted">
                            {(utilization * 100).toFixed(0)}%
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted">n/a</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div
                          className="h-1.5 w-24 overflow-hidden rounded-full bg-card-elevated"
                          title={`${(row.contractedPct * 100).toFixed(1)}% of capacity is contracted out of a 75% cap`}
                        >
                          <div
                            className={`h-full transition-[width] ${headroomUsedPct >= 1 ? "bg-error" : headroomUsedPct >= 0.8 ? "bg-warning" : "bg-primary"}`}
                            style={{ width: `${headroomUsedPct * 100}%` }}
                          />
                        </div>
                        <span className="min-w-[36px] tabular-nums text-xs text-muted">
                          {Math.max(
                            0,
                            GOVT_CONTRACT_MAX_TOTAL_SHARE * 100 - row.contractedPct * 100
                          ).toFixed(0)}
                          % left
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.overAllocated ? (
                        <span className="rounded-full bg-error/15 px-2 py-0.5 text-xs text-error">
                          Over-allocated
                        </span>
                      ) : (
                        <span className="text-xs text-muted">n/a</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {data.prospectingEnabled && (
          <div className="mt-4 rounded-lg border border-card-border bg-card p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">
              Geological surveys in this state
            </p>
            <ProspectingSurveyList
              surveys={surveys}
              currentTurn={gameTurn?.currentTurn ?? 0}
              loading={surveysLoading}
            />
          </div>
        )}
      </section>

      <section className="rounded-xl border border-card-border bg-card p-5 shadow-card">
        <div className="mb-4 flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-semibold uppercase tracking-widest text-muted">
            Active Contracts
          </h3>
          <div className="flex gap-2">
            {data.contractIssuanceEnabled && canGovern && (
              <button
                onClick={() => setShowIssueModal(true)}
                className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-dark transition-colors"
              >
                Issue Contract
              </button>
            )}
            {isAdmin && (
              <button
                onClick={() => setShowGrantModal(true)}
                className="rounded-lg border border-card-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-card-elevated transition-colors"
              >
                Admin Grant
              </button>
            )}
          </div>
        </div>

        {revokeError && (
          <p className="mb-3 rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
            {revokeError}
          </p>
        )}

        {data.contracts.length === 0 ? (
          <p className="text-sm text-muted">No active extraction contracts.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-card-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-card-border bg-card-elevated">
                  <th className="px-4 py-3 text-left font-medium text-muted">Company</th>
                  <th className="px-4 py-3 text-left font-medium text-muted">Resource</th>
                  <th className="px-4 py-3 text-right font-medium text-muted">Share</th>
                  <th className="px-4 py-3 text-right font-medium text-muted">Royalty/turn</th>
                  <th className="px-4 py-3 text-left font-medium text-muted">Granted by</th>
                  <th className="px-4 py-3 text-right font-medium text-muted">Status</th>
                  {canGovern && <th className="px-4 py-3" />}
                </tr>
              </thead>
              <tbody>
                {data.contracts.map((c) => (
                  <tr key={c._id} className="border-b border-card-border last:border-0">
                    <td className="px-4 py-3">
                      {c.corporationName ?? (
                        <span className="font-mono text-xs text-muted">{c.corporationId}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">{COMMODITY_LABELS[c.resource]}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {(c.share * 100).toFixed(1)}%
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {c.royaltyRatePerTurn != null
                        ? `${(c.royaltyRatePerTurn * 100).toFixed(2)}%`
                        : "n/a"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {c.grantedByLevel === "national"
                        ? "National legislature"
                        : "State legislature"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ContractStatusBadge status={effectiveContractStatus(c)} />
                    </td>
                    {canGovern && (
                      <td className="px-4 py-3 text-right">
                        {/* Server rule: admins may revoke anything; the governor
                            may only revoke contracts their level issued. */}
                        {(isAdmin || c.grantedByLevel === "state") && (
                          <button
                            onClick={() => handleRevoke(c._id)}
                            disabled={revoking === c._id}
                            className="rounded px-2 py-1 text-xs text-error hover:bg-error/10 disabled:opacity-50 transition-colors"
                          >
                            {revoking === c._id ? "Revoking…" : "Revoke"}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {isAdmin && showGrantModal && (
        <GrantContractModal
          legislatureId={stateId}
          legislatureLevel="state"
          stateId={stateId}
          countryId={countryId}
          onClose={() => setShowGrantModal(false)}
          onGranted={() => {
            setShowGrantModal(false);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}

      {canGovern && showIssueModal && (
        <IssueExtractionContractModal
          level="state"
          countryId={countryId}
          stateId={stateId}
          onClose={() => setShowIssueModal(false)}
          onIssued={() => {
            setShowIssueModal(false);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}

      {canGovern && showSurveyModal && (
        <CommissionSurveyModal
          level="state"
          countryId={countryId}
          stateId={stateId}
          onClose={() => setShowSurveyModal(false)}
          onLaunched={() => {
            setShowSurveyModal(false);
            refreshSurveys();
          }}
        />
      )}
    </div>
  );
}
