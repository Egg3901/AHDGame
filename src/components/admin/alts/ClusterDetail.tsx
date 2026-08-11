"use client";

// ClusterDetail (plan §4.8): the drill-in for one ring. Leads with the
// confidence meter and a report-only / stale-compute banner, then the act bar
// (ModeratorActions), the ring graph + member roster, the SignalBreakdown
// ("why this score"), and the per-pair EvidencePanel. Admins additionally get
// the ScoringConfigPanel with live preview. Selecting an edge in the graph
// focuses the matching evidence row and vice-versa.

import { useMemo, useState } from "react";
import { ConfidenceMeter } from "./ConfidenceMeter";
import { SignalBreakdown } from "./SignalBreakdown";
import { RingGraph } from "./RingGraph";
import { EvidencePanel } from "./EvidencePanel";
import { ModeratorActions, type ToastKind } from "./ModeratorActions";
import { ScoringConfigPanel } from "./ScoringConfigPanel";
import {
  confidenceHex,
  confidenceLabel,
  formatRelativeTime,
  memberDisplayName,
  ROLE_HEX,
  ROLE_LABEL,
  signalMeta,
  STATUS_LABEL,
  type AltClusterStatus,
  type AltConfig,
  type AltContext,
  type AltSignal,
  type ClusterDetail as ClusterDetailData,
} from "./altTypes";

interface ClusterDetailViewProps {
  detail: ClusterDetailData;
  config: AltConfig | null;
  context: AltContext;
  loading: boolean;
  onBack: () => void;
  onStatusChange: (status: AltClusterStatus) => void;
  onMemberBanned: (userId: string) => void;
  onConfigSaved: (config: AltConfig) => void;
  notify: (msg: string, kind: ToastKind) => void;
}

const STATUS_STYLE: Record<AltClusterStatus, string> = {
  open: "border border-blue-400/25 bg-blue-500/10 text-blue-400",
  reviewed: "border border-purple-400/25 bg-purple-500/10 text-purple-400",
  confirmed: "border border-red-400/25 bg-red-500/10 text-red-400",
  dismissed: "border border-gray-400/20 bg-gray-500/10 text-gray-400",
};

/** Shared panel chrome + the small overline heading every section wears. */
const PANEL_CLS = "rounded-xl border border-card-border bg-card p-4 shadow-card";
const OVERLINE_CLS = "text-[11px] font-semibold uppercase tracking-[0.14em] text-muted";

export function ClusterDetailView({
  detail,
  config,
  context,
  loading,
  onBack,
  onStatusChange,
  onMemberBanned,
  onConfigSaved,
  notify,
}: ClusterDetailViewProps) {
  const isAdmin = context === "admin";
  const [selectedPair, setSelectedPair] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);

  // Guards to surface: signals that matched but were scored to 0. Deduped by
  // type+evidence across all internal links.
  const guards = useMemo(() => {
    const seen = new Set<string>();
    const out: { type: AltSignal; evidence: string }[] = [];
    for (const link of detail.links) {
      for (const s of link.signals) {
        if (s.weight > 0) continue;
        const key = `${s.type}|${s.evidence}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ type: s.type, evidence: s.evidence });
      }
    }
    return out;
  }, [detail.links]);

  const accent = confidenceHex(detail.confidence);

  return (
    <div className="space-y-4">
      {/* Back */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 rounded-md text-sm text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 motion-reduce:transition-none"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to ranked list
      </button>

      {/* Header — the one focal element: the ring's confidence. */}
      <div className="relative overflow-hidden rounded-xl border border-card-border bg-card p-5 shadow-panel">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background: `radial-gradient(120% 140% at 0% 0%, ${accent}14, transparent 55%)`,
          }}
        />
        <div className="relative flex flex-wrap items-center gap-6">
          <ConfidenceMeter value={detail.confidence} size="lg" showBand />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className={OVERLINE_CLS}>Suspected ring</div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-xl font-semibold tracking-tight">
                {detail.size} account{detail.size === 1 ? "" : "s"}
              </h2>
              <span
                className={`rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_STYLE[detail.status]}`}
              >
                {STATUS_LABEL[detail.status]}
              </span>
            </div>
            <p className="text-sm text-muted">
              {confidenceLabel(detail.confidence)} confidence ring.{" "}
              {detail.signalSummary.length > 0 &&
                `Top signal: ${signalMeta(detail.signalSummary[0].type).label}.`}
            </p>
            {loading && <p className="text-xs text-muted">Refreshing…</p>}
          </div>
        </div>
      </div>

      {/* Report-only / stale-compute banner */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300/90">
        <svg
          className="h-4 w-4 flex-shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <span>
          <span className="font-semibold">Report-only.</span> Scores are advisory — a human takes
          every action; nothing here auto-bans.
        </span>
        <span className="ml-auto tabular-nums text-amber-300/60">
          {detail.updatedAt
            ? `Computed ${formatRelativeTime(detail.updatedAt)}${detail.turn != null ? ` · turn ${detail.turn}` : ""}`
            : detail.turn != null
              ? `Computed turn ${detail.turn}`
              : "Latest computed snapshot"}
        </span>
      </div>

      {/* Actions */}
      <div className={PANEL_CLS}>
        <h3 className={`mb-3 ${OVERLINE_CLS}`}>Actions</h3>
        <ModeratorActions
          cluster={detail}
          context={context}
          onStatusChange={onStatusChange}
          onMemberBanned={onMemberBanned}
          notify={notify}
        />
      </div>

      {/* Two-column body */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Left: ring graph + roster */}
        <div className="space-y-4">
          <div className={PANEL_CLS}>
            <h3 className={`mb-3 ${OVERLINE_CLS}`}>Ring graph</h3>
            <RingGraph
              members={detail.members}
              links={detail.links}
              operatorId={detail.members.find((m) => m.role === "operator")?.userId}
              selectedPair={selectedPair}
              onSelectPair={setSelectedPair}
            />
          </div>

          <div className={PANEL_CLS}>
            <h3 className={`mb-2 ${OVERLINE_CLS}`}>Members ({detail.members.length})</h3>
            <ul className="divide-y divide-card-border/60">
              {detail.members.map((m) => (
                <li key={m.userId} className="flex items-center gap-2.5 py-2.5">
                  <span
                    className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full ring-2 ring-background"
                    style={{ backgroundColor: ROLE_HEX[m.role] }}
                  />
                  <span className="min-w-0 truncate text-sm font-medium">
                    {memberDisplayName(m.name, m.userId)}
                  </span>
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
                    {ROLE_LABEL[m.role]}
                  </span>
                  {m.banned && (
                    <span className="ml-auto rounded-md border border-red-400/25 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-400">
                      Banned
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Right: why-this-score + evidence */}
        <div className="space-y-4">
          <div className={PANEL_CLS}>
            <SignalBreakdown
              confidence={detail.confidence}
              contributions={detail.contributions}
              guards={guards}
            />
          </div>

          <div className={PANEL_CLS}>
            <EvidencePanel
              links={detail.links}
              members={detail.members}
              selectedPair={selectedPair}
              onSelectPair={setSelectedPair}
              isAdmin={isAdmin}
            />
          </div>
        </div>
      </div>

      {/* Admin: scoring config with live preview */}
      {isAdmin && config && (
        <div>
          <button
            onClick={() => setShowConfig((s) => !s)}
            aria-expanded={showConfig}
            className="flex items-center gap-1.5 rounded-md text-sm font-medium text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 motion-reduce:transition-none"
          >
            <svg
              className={`h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${showConfig ? "rotate-90" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            Scoring config (admin) — tune weights with live preview
          </button>
          {showConfig && (
            <div className="mt-3">
              <ScoringConfigPanel
                config={config}
                cluster={detail}
                onSaved={onConfigSaved}
                notify={notify}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
