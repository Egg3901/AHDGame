"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

interface PartyOption {
  sequentialId: number;
  abbreviation: string;
  name: string;
}

interface CandidatePayload {
  candidateId: string;
  characterName: string;
  isNPP: boolean;
  homeState: string | null;
  primaryCampaignState: string | null;
  primaryCampaignTicks: number;
  nationalInfluence: number | null;
  favorability: number | null;
  economicPosition: number | null;
  socialPosition: number | null;
  nationalVotes: number;
  nationalVoteSharePct: number;
  projectedDelegates: number;
  nationalDelegateSharePct: number;
}

interface PerStatePayload {
  stateId: string;
  delegatesAvailable: number;
  allocationMethod: "PR" | "WTA";
  allocationSource: "tally" | "chair-override" | "real-world-default" | "fallback";
  isHybridApprox: boolean;
  voteSource: "actual" | "projected" | "none";
  totalVotes: number;
  winnerId: string | null;
  sharePctByCandidate: Record<string, number>;
  votesByCandidate: Record<string, number>;
  projectedDelegatesByCandidate: Record<string, number>;
  awardedDelegatesByCandidate: Record<string, number> | null;
}

interface DebuggerResponse {
  ok: boolean;
  error?: string;
  message?: string;
  electionId?: string;
  partyOptions?: PartyOption[];
  party?: {
    id: string;
    sequentialId: number;
    name: string;
    abbreviation: string;
    economicPosition: number;
    socialPosition: number;
  } | null;
  family?: "dem" | "gop";
  totalDelegates?: number;
  wavesRun?: number;
  candidates?: CandidatePayload[];
  perState?: PerStatePayload[];
  warnings?: string[];
}

const SOURCE_LABEL: Record<PerStatePayload["voteSource"], string> = {
  actual: "actual",
  projected: "projected",
  none: "no data",
};

function formatPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

export function PrimaryProjectionDebugger() {
  const [partyId, setPartyId] = useState<string>("");
  const [data, setData] = useState<DebuggerResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedState, setExpandedState] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<"all" | "actual" | "projected" | "none">("all");

  const fetchData = useCallback(async (party: string) => {
    setLoading(true);
    setError(null);
    try {
      const qs = party ? `?partyId=${encodeURIComponent(party)}` : "";
      const res = await fetch(`/api/admin/debug/primary-projection${qs}`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      const json = (await res.json()) as DebuggerResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load — list parties and pick the first if none selected.
  useEffect(() => {
    fetchData(partyId);
  }, [partyId, fetchData]);

  useEffect(() => {
    if (!data?.partyOptions || partyId) return;
    const first = data.partyOptions[0];
    if (first) setPartyId(String(first.sequentialId));
  }, [data?.partyOptions, partyId]);

  const candidates = useMemo<CandidatePayload[]>(() => data?.candidates ?? [], [data]);
  const perState = useMemo<PerStatePayload[]>(() => data?.perState ?? [], [data]);
  const candidateNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of candidates) m.set(c.candidateId, c.characterName);
    return m;
  }, [candidates]);

  const filteredStates = useMemo(() => {
    if (stateFilter === "all") return perState;
    return perState.filter((s) => s.voteSource === stateFilter);
  }, [perState, stateFilter]);

  const sharesAgree = useMemo(() => {
    if (!candidates.length) return null;
    return candidates.map((c) => ({
      candidateId: c.candidateId,
      diff: c.nationalDelegateSharePct - c.nationalVoteSharePct,
    }));
  }, [candidates]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Primary projection debugger</h3>
          <p className="mt-0.5 text-xs text-muted">
            Read-only. Reconciles the per-state primary projection that powers
            <code className="mx-1 rounded bg-card px-1 py-0.5 text-[11px]">
              /president/primary/[party]
            </code>
            against the per-state pages from a single canonical source.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted" htmlFor="primary-debug-party">
            Party
          </label>
          <select
            id="primary-debug-party"
            value={partyId}
            onChange={(e) => setPartyId(e.target.value)}
            className="rounded-md border border-card-border bg-background px-2 py-1 text-xs"
          >
            {!data?.partyOptions?.length && <option value="">—</option>}
            {data?.partyOptions?.map((p) => (
              <option key={p.sequentialId} value={String(p.sequentialId)}>
                {p.name} ({p.abbreviation})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => fetchData(partyId)}
            disabled={loading}
            className="rounded-md border border-card-border bg-background px-3 py-1 text-xs hover:bg-card disabled:opacity-50"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {data && !data.ok && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {data.message ?? data.error ?? "Unknown error"}
        </div>
      )}

      {data?.warnings && data.warnings.length > 0 && (
        <ul className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
          {data.warnings.map((w, i) => (
            <li key={i}>⚠ {w}</li>
          ))}
        </ul>
      )}

      {data?.party && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Party">
            {data.party.name}
            <div className="text-[11px] text-muted">
              EP {data.party.economicPosition.toFixed(1)} · SP{" "}
              {data.party.socialPosition.toFixed(1)}
            </div>
          </Tile>
          <Tile label="Calendar family">{data.family === "dem" ? "Democratic" : "GOP"}</Tile>
          <Tile label="Total delegates">{formatNumber(data.totalDelegates ?? 0)}</Tile>
          <Tile label="Waves fired">{data.wavesRun ?? 0}</Tile>
        </div>
      )}

      {candidates.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-card-border bg-card">
          <div className="border-b border-card-border bg-background px-4 py-2 text-xs font-medium uppercase tracking-wider text-muted">
            Candidate aggregates · vote share vs delegate share
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-card-border bg-background text-left text-[10px] uppercase tracking-wider text-muted">
                  <th className="px-3 py-2">Candidate</th>
                  <th className="px-3 py-2 text-right" title="Sum across states">
                    National votes
                  </th>
                  <th className="px-3 py-2 text-right">Vote %</th>
                  <th className="px-3 py-2 text-right">Proj. delegates</th>
                  <th className="px-3 py-2 text-right">Del. share</th>
                  <th
                    className="px-3 py-2 text-right"
                    title="Del. share − Vote share. Big positive numbers signal WTA amplification."
                  >
                    Δ
                  </th>
                  <th className="px-3 py-2 text-right">NI</th>
                  <th className="px-3 py-2 text-right">Fav</th>
                  <th className="px-3 py-2 text-right">Pos (E/S)</th>
                  <th className="px-3 py-2">Home</th>
                  <th className="px-3 py-2">Camped</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {candidates.map((c, i) => {
                  const diff = (sharesAgree ?? []).find(
                    (d) => d.candidateId === c.candidateId
                  )?.diff;
                  return (
                    <tr key={c.candidateId}>
                      <td className="px-3 py-2 font-semibold">
                        <span className={i === 0 ? "text-yellow-400" : ""}>{c.characterName}</span>
                        {c.isNPP && (
                          <span className="ml-1.5 rounded bg-purple-500/20 px-1 py-0.5 text-[9px] text-purple-300">
                            NPP
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatNumber(Math.round(c.nationalVotes))}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatPct(c.nationalVoteSharePct)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatNumber(c.projectedDelegates)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatPct(c.nationalDelegateSharePct)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${
                          diff != null && Math.abs(diff) >= 5
                            ? diff > 0
                              ? "text-amber-400"
                              : "text-blue-400"
                            : "text-muted"
                        }`}
                      >
                        {diff != null ? `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}pp` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">
                        {c.nationalInfluence != null ? c.nationalInfluence.toFixed(0) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">
                        {c.favorability != null ? `${c.favorability.toFixed(1)}%` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">
                        {c.economicPosition != null && c.socialPosition != null
                          ? `${c.economicPosition.toFixed(1)} / ${c.socialPosition.toFixed(1)}`
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-muted">{c.homeState ?? "—"}</td>
                      <td className="px-3 py-2 text-muted">
                        {c.primaryCampaignState ? (
                          <span className="text-amber-400">
                            📍 {c.primaryCampaignState} ×{c.primaryCampaignTicks}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="border-t border-card-border bg-background/60 px-4 py-2 text-[11px] text-muted">
            <strong className="text-foreground/80">Reading the Δ column:</strong> Vote% is the sum
            of every state&apos;s projected/actual votes for that candidate, divided by all primary
            votes. Del. share is projected delegates over total delegates. A large positive Δ means
            a candidate is winning many WTA states by tiny margins — that&apos;s the legitimate
            reason an 84% delegate share can coexist with a ~50% national vote share.
          </div>
        </div>
      )}

      {perState.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-card-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-card-border bg-background px-4 py-2 text-xs font-medium uppercase tracking-wider text-muted">
            <span>Per-state breakdown</span>
            <div className="flex items-center gap-2 text-[10px] normal-case">
              <span>Filter:</span>
              {(["all", "actual", "projected", "none"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setStateFilter(f)}
                  className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors ${
                    stateFilter === f
                      ? "bg-primary/30 text-foreground"
                      : "bg-background text-muted hover:text-foreground"
                  }`}
                >
                  {f}
                </button>
              ))}
              <span className="text-muted">
                ({filteredStates.length} / {perState.length})
              </span>
            </div>
          </div>
          <div className="max-h-[640px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b border-card-border text-left text-[10px] uppercase tracking-wider text-muted">
                  <th className="px-3 py-2">State</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Alloc</th>
                  <th className="px-3 py-2 text-right">Del.</th>
                  <th className="px-3 py-2 text-right">Total votes</th>
                  <th className="px-3 py-2">Winner</th>
                  <th className="px-3 py-2">Top shares</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {filteredStates.map((s) => {
                  const isOpen = expandedState === s.stateId;
                  const top = Object.entries(s.sharePctByCandidate)
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 3);
                  const winnerName = s.winnerId
                    ? (candidateNameById.get(s.winnerId) ?? s.winnerId)
                    : null;
                  return (
                    <Fragment key={s.stateId}>
                      <tr
                        onClick={() => setExpandedState(isOpen ? null : s.stateId)}
                        className="cursor-pointer hover:bg-background/40"
                      >
                        <td className="px-3 py-2 font-mono">{s.stateId}</td>
                        <td className="px-3 py-2 text-muted">
                          <span
                            className={
                              s.voteSource === "actual"
                                ? "text-green-400"
                                : s.voteSource === "projected"
                                  ? "text-blue-400"
                                  : "text-muted"
                            }
                          >
                            {SOURCE_LABEL[s.voteSource]}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-muted">
                          <span
                            title={`Source: ${s.allocationSource}${s.isHybridApprox ? " — hybrid (PR + per-CD WTA in real life, modeled as PR)" : ""}`}
                          >
                            {s.allocationMethod}
                            {s.allocationSource === "chair-override" && (
                              <span className="ml-1 text-[9px] uppercase text-amber-400">
                                override
                              </span>
                            )}
                            {s.allocationSource === "tally" && (
                              <span className="ml-1 text-[9px] uppercase text-green-400">
                                locked
                              </span>
                            )}
                            {s.isHybridApprox && (
                              <span
                                className="ml-1 text-[9px] uppercase text-blue-400"
                                title="Hybrid PR + per-CD WTA — collapsed to PR for the statewide pool"
                              >
                                hybrid≈
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {s.delegatesAvailable}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatNumber(Math.round(s.totalVotes))}
                        </td>
                        <td className="px-3 py-2">{winnerName ?? "—"}</td>
                        <td className="px-3 py-2 text-muted">
                          {top
                            .map(([cid, share]) => {
                              const name = candidateNameById.get(cid) ?? cid;
                              return `${name} ${formatPct(share)}`;
                            })
                            .join(" · ")}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-background/40">
                          <td colSpan={7} className="px-4 py-3">
                            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                              {Object.entries(s.votesByCandidate)
                                .sort(([, a], [, b]) => b - a)
                                .map(([cid, votes]) => {
                                  const name = candidateNameById.get(cid) ?? cid;
                                  const share = s.sharePctByCandidate[cid] ?? 0;
                                  const projDel = s.projectedDelegatesByCandidate[cid] ?? 0;
                                  const awardedDel = s.awardedDelegatesByCandidate?.[cid] ?? 0;
                                  return (
                                    <div
                                      key={cid}
                                      className="rounded-md border border-card-border bg-background p-2 text-[11px]"
                                    >
                                      <div className="font-semibold text-foreground">{name}</div>
                                      <div className="text-muted">
                                        Votes: {formatNumber(Math.round(votes))} ·{" "}
                                        {formatPct(share)}
                                      </div>
                                      <div className="text-muted">
                                        Projected del.: {projDel} · Awarded: {awardedDel}
                                      </div>
                                    </div>
                                  );
                                })}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-0.5 text-sm font-semibold">{children}</div>
    </div>
  );
}
