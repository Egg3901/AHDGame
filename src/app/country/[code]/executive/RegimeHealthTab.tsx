"use client";

/**
 * Regime Health tab body — leader-only diagnostic surface.
 *
 * Fetches /api/country/[code]/regime/leader (gated on isSittingLeader)
 * and renders:
 *   - Both scalars as raw numbers + band labels
 *   - The current escalation stage + dwell counters
 *   - The active decision (if any) with click-to-resolve buttons
 *   - Reform-action buttons with cooldown awareness
 *   - Convention panel (announce / draft / status)
 *   - Recent stage transitions
 *
 * On 403 (not the leader) the tab renders an "Only the sitting leader
 * can view this" empty state — the public Regime Stability panel on
 * the country overview is the non-leader fallback.
 */
import { useCallback, useEffect, useState } from "react";
import { governmentSystemLabel } from "@/lib/military/peaceTerm";

interface Scalars {
  popularLegitimacy: number;
  popularBand: string;
  partyConfidence: number;
  confidenceBand: string;
}

interface ActiveDecision {
  id: string;
  kind: string;
  offeredAtTurn: number;
  expiresAtTurn: number;
  payload: Record<string, unknown>;
  options: { id: string; label: string; description: string }[];
}

interface ConventionState {
  phase: "announced" | "draft" | "ratification";
  announcedAtTurn: number;
  draftDeadlineTurn: number;
  targetSystem?: string;
  legacyReservation: number;
  electionDelayTurns: number;
}

interface Transition {
  turn: number;
  from: string;
  to: string;
  reason: string;
  at: string;
}

interface ScalarHistoryEntry {
  turn: number;
  previous: number;
  next: number;
  delta: number;
  reason: string;
}

interface BannedParty {
  sequentialId: number;
  name: string;
  abbreviation?: string;
}

interface LeaderRegimeData {
  countryId: string;
  currentTurn: number;
  governmentType: string;
  scalars: Scalars;
  history: {
    popularLegitimacy: ScalarHistoryEntry[];
    partyConfidence: ScalarHistoryEntry[];
  };
  projection: { popularLegitimacy: number[]; partyConfidence: number[] } | null;
  stage: string;
  dwellCounters: {
    stage1: number;
    stage2: { sustained: number; cumulativeIn168: number };
    stage3: number;
    stage4: number;
  };
  activeDecision: ActiveDecision | null;
  convention: ConventionState | null;
  conventionInProgress: boolean;
  transitionHistory: Transition[];
  reformAvailability: Record<string, { available: boolean; cooldownUntil?: number; note?: string }>;
  bannedParties: BannedParty[];
  pendingReformDiscount: { turn: number; multiplier: number } | null;
}

interface Props {
  countryCode: string;
}

const STAGE_LABEL: Record<string, string> = {
  stable: "Stable",
  discontent: "Discontent",
  crisis: "Crisis",
  internalChallenge: "Internal challenge",
  collapse: "Collapse",
};

interface StageVisual {
  /** Banner + accent border colors. */
  borderClass: string;
  bgClass: string;
  textClass: string;
  /** Short blurb shown under the banner title. */
  blurb: string;
}

const STAGE_VISUALS: Record<string, StageVisual> = {
  stable: {
    borderClass: "border-emerald-500/40",
    bgClass: "bg-emerald-500/5",
    textClass: "text-emerald-700 dark:text-emerald-400",
    blurb:
      "No active threat. Popular legitimacy is healthy and the party is steady. Leadership has room to spend political capital on reforms.",
  },
  discontent: {
    borderClass: "border-amber-500/40",
    bgClass: "bg-amber-500/5",
    textClass: "text-amber-700 dark:text-amber-400",
    blurb:
      "Public discontent has been building for at least 12 turns. The Stage-1 decision is available — Acknowledge, Crack down, or Ignore — each with different costs and recovery paths.",
  },
  crisis: {
    borderClass: "border-orange-500/40",
    bgClass: "bg-orange-500/5",
    textClass: "text-orange-700 dark:text-orange-400",
    blurb:
      "Mass unrest. Popular legitimacy has been at or below 35 for 36+ sustained turns or 48 cumulative turns in a 168-turn window. The Stage-2 decision (Open dialogue / Selective concession / Martial law) is available; ignoring it accelerates the Stage-3 trip.",
  },
  internalChallenge: {
    borderClass: "border-rose-500/40",
    bgClass: "bg-rose-500/5",
    textClass: "text-rose-700 dark:text-rose-400",
    blurb:
      "Intra-party confidence has collapsed below 15. A faction has already defected and spawned an approved opposition party. The Stage-3 decision — Negotiate / Purge / Concede leadership / Ignore — is the last off-ramp before Stage 4.",
  },
  collapse: {
    borderClass: "border-rose-700/60",
    bgClass: "bg-rose-700/10",
    textClass: "text-rose-700 dark:text-rose-400",
    blurb:
      "Regime in collapse. Stage 4 fires when popular legitimacy stays below 15 for 72 turns. Only the Stage-4 decision remains — Resist (delay + heavy cost) or Accept peacefully (controlled transition). The voluntary convention path is no longer available.",
  },
};

const REFORM_LABEL: Record<string, string> = {
  legalizeParty: "Legalize a banned party",
  reduceVoteMultipliers: "Reduce vote multipliers",
  holdHonestByElection: "Hold an honest by-election",
  anticorruptionPurge: "Anti-corruption purge",
  constitutionalAmendment: "Constitutional amendment (one-time)",
};

const DECISION_LABEL: Record<string, string> = {
  "stage1.addressDiscontent": "Address public discontent",
  "stage2.respondToUnrest": "Respond to mass unrest",
  "stage3.respondToFactionSplit": "Respond to faction split",
  "stage4.faceCollapse": "Face the collapse",
  "convention.draft": "Submit convention draft",
};

/**
 * Costs / gains / cooldowns for the expandable reform-action panels.
 * Mirrors the constants in `src/lib/onePartyState/reformActions.ts`.
 */
interface ReformMeta {
  description: string;
  intraCost: number; // negative = drains intra-party confidence
  popularGain: number;
  boostPerTurn?: number;
  boostDurationTurns?: number;
  cooldownTurns: number | "one-time";
  notes?: string;
}

const REFORM_META: Record<string, ReformMeta> = {
  legalizeParty: {
    description:
      "Flips a chosen banned party to approved. Intra-party hardliners read this as a major concession; the public sees a real opening. Cooldown is per-party — different banned parties have independent windows.",
    intraCost: -6,
    popularGain: 8,
    boostPerTurn: 0.2,
    boostDurationTurns: 120,
    cooldownTurns: 168,
  },
  reduceVoteMultipliers: {
    description:
      "Dials the ruling-party vote-weight multiplier one rung down the ladder (3.0 → 2.0 → 1.5 → 1.0). Grays out at the 1.0 floor — fully equal weighting.",
    intraCost: -4,
    popularGain: 4,
    boostPerTurn: 0.15,
    boostDurationTurns: 96,
    cooldownTurns: 240,
  },
  holdHonestByElection: {
    description:
      "Sets a one-shot flag: the next election in this country uses uniform 1.0× multipliers across every regime status. Consumed by the election engine, not stored long-term.",
    intraCost: -3,
    popularGain: 5,
    cooldownTurns: 96,
  },
  anticorruptionPurge: {
    description:
      "A minor purge tagged 'anticorruption' — the popular driver carves it out of the usual repression penalty, so it's net-positive popular legitimacy. Still costs intra-party confidence through the purge itself.",
    intraCost: -2,
    popularGain: 3,
    cooldownTurns: 72,
    notes: "Minor purge event with kind=anticorruption (no popular cost from the purge itself).",
  },
  constitutionalAmendment: {
    description:
      "Major one-time reform. Permanently caps leader-renewal bumps at +2 instead of +5 — the regime gives up some of its self-renewal lever in exchange for a large legitimacy bump. Cannot be undone.",
    intraCost: -8,
    popularGain: 12,
    boostPerTurn: 0.3,
    boostDurationTurns: 240,
    cooldownTurns: "one-time",
    notes: "Future leader renewals grant +2 intra-party confidence instead of +5.",
  },
};

function fmtCost(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

export function RegimeHealthTab({ countryCode }: Props) {
  const [data, setData] = useState<LeaderRegimeData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [expandedAction, setExpandedAction] = useState<string | null>(null);
  /** Picker state for decision options that need a bannedPartyId payload. */
  const [selectedBannedParty, setSelectedBannedParty] = useState<number | "">("");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/country/${countryCode}/regime/leader`);
      if (res.status === 403) {
        setStatus("forbidden");
        return;
      }
      if (!res.ok) {
        setStatus("error");
        return;
      }
      const body = (await res.json()) as LeaderRegimeData;
      setData(body);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [countryCode]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function resolveDecision(
    optionId: string,
    payload?: Record<string, unknown>
  ): Promise<void> {
    if (!data?.activeDecision) return;
    setBusy(`decision:${optionId}`);
    setErr(null);
    try {
      const res = await fetch(
        `/api/country/${countryCode}/regime/decision/${data.activeDecision.id}/resolve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ optionId, payload }),
        }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(body.error ?? `Submission failed (${res.status})`);
      } else {
        await refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  async function triggerReform(action: string, body?: Record<string, unknown>): Promise<void> {
    setBusy(`reform:${action}`);
    setErr(null);
    try {
      const res = await fetch(`/api/country/${countryCode}/reform/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(errBody.error ?? `Reform action failed (${res.status})`);
      } else {
        await refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  async function announceConvention(): Promise<void> {
    setBusy("convention:announce");
    setErr(null);
    try {
      const res = await fetch(`/api/country/${countryCode}/convention/announce`, {
        method: "POST",
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(errBody.error ?? `Announce failed (${res.status})`);
      } else {
        await refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  if (status === "loading") {
    return (
      <div
        className="rounded-lg border border-card-border bg-card p-4"
        data-testid="regime-health-loading"
      >
        <p className="text-sm text-muted">Loading regime diagnostics…</p>
      </div>
    );
  }
  if (status === "forbidden") {
    return (
      <div
        className="rounded-lg border border-card-border bg-card p-4"
        data-testid="regime-health-forbidden"
      >
        <p className="text-sm text-muted">
          Regime diagnostics are visible only to the sitting head of government. The public Regime
          Stability panel on the country overview is the public view.
        </p>
      </div>
    );
  }
  if (status === "error" || !data) {
    return (
      <div
        className="rounded-lg border border-card-border bg-card p-4"
        data-testid="regime-health-error"
      >
        <p className="text-sm text-error">Failed to load regime diagnostics.</p>
      </div>
    );
  }
  if (data.governmentType !== "onePartyState") {
    return (
      <div
        className="rounded-lg border border-card-border bg-card p-4"
        data-testid="regime-health-na"
      >
        <p className="text-sm text-muted">
          This country is no longer a one-party state. Regime mechanics no longer apply.
        </p>
      </div>
    );
  }

  const stageVisual = STAGE_VISUALS[data.stage] ?? STAGE_VISUALS.stable;

  return (
    <div className="space-y-4" data-testid="regime-health-tab">
      {err && (
        <div
          className="rounded border border-error/40 bg-error/5 p-3 text-sm text-error"
          data-testid="regime-health-error-banner"
        >
          {err}
        </div>
      )}

      {/* Stage banner — color-coded severity + explanation */}
      <section
        className={`rounded-lg border ${stageVisual.borderClass} ${stageVisual.bgClass} p-4`}
        data-testid="regime-stage-banner"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={`text-lg font-bold ${stageVisual.textClass}`}>
            Stage: {STAGE_LABEL[data.stage] ?? data.stage}
          </h2>
          <span className="text-xs text-muted">
            Dwell s1={data.dwellCounters.stage1}, s2={data.dwellCounters.stage2.sustained}, s3=
            {data.dwellCounters.stage3}, s4={data.dwellCounters.stage4}
          </span>
        </div>
        <p className="mt-1 text-xs text-foreground/80">{stageVisual.blurb}</p>
      </section>

      {/* Scalars + history + projection */}
      <section
        className={`rounded-lg border ${stageVisual.borderClass} bg-card p-4`}
        data-testid="regime-scalars"
      >
        <h3 className="text-sm font-semibold text-foreground">Scalars (raw, leader-only)</h3>
        <dl className="mt-2 grid gap-4 sm:grid-cols-2">
          <ScalarCard
            label="Popular legitimacy"
            value={data.scalars.popularLegitimacy}
            band={data.scalars.popularBand}
            history={data.history.popularLegitimacy}
            projection={data.projection?.popularLegitimacy ?? null}
            currentTurn={data.currentTurn}
            color="emerald"
            testId="regime-popular"
          />
          <ScalarCard
            label="Intra-party confidence"
            value={data.scalars.partyConfidence}
            band={data.scalars.confidenceBand}
            history={data.history.partyConfidence}
            projection={data.projection?.partyConfidence ?? null}
            currentTurn={data.currentTurn}
            color="sky"
            testId="regime-confidence"
          />
        </dl>
        {data.projection && (
          <p className="mt-2 text-[10px] text-muted">
            Solid line: last {Math.min(data.history.popularLegitimacy.length, 24)} turns of history.
            Dashed line: 48-turn projection from current economy + decaying boost modifiers (no
            future shocks).
          </p>
        )}
      </section>

      {/* Active decision */}
      {data.activeDecision && (
        <section
          className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4"
          data-testid="regime-active-decision"
        >
          <div className="mb-2 flex items-start justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">
              {DECISION_LABEL[data.activeDecision.kind] ?? data.activeDecision.kind}
            </h3>
            <span className="text-xs text-muted">
              expires turn {data.activeDecision.expiresAtTurn}
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.activeDecision.options.map((o) => {
              if (o.id === "selectiveConcession") {
                const hasBanned = data.bannedParties.length > 0;
                const disabled = busy !== null || !hasBanned || selectedBannedParty === "";
                return (
                  <div
                    key={o.id}
                    className="rounded border border-card-border bg-card p-3 text-sm"
                    data-testid={`regime-option-${o.id}`}
                  >
                    <div className="font-medium text-foreground">{o.label}</div>
                    <div className="mt-1 text-xs text-muted">{o.description}</div>
                    {hasBanned ? (
                      <div className="mt-2 flex items-center gap-2">
                        <select
                          value={selectedBannedParty}
                          onChange={(e) =>
                            setSelectedBannedParty(
                              e.target.value === "" ? "" : Number(e.target.value)
                            )
                          }
                          className="flex-1 rounded border border-card-border bg-background px-2 py-1 text-xs"
                          data-testid="regime-selective-concession-picker"
                        >
                          <option value="">Pick a banned party…</option>
                          {data.bannedParties.map((p) => (
                            <option key={p.sequentialId} value={p.sequentialId}>
                              {p.name}
                              {p.abbreviation ? ` (${p.abbreviation})` : ""}
                            </option>
                          ))}
                        </select>
                        <button
                          disabled={disabled}
                          onClick={() =>
                            void resolveDecision(o.id, {
                              ...data.activeDecision?.payload,
                              bannedPartyId: Number(selectedBannedParty),
                            })
                          }
                          className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs text-amber-700 dark:text-amber-400 hover:bg-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
                          data-testid="regime-selective-concession-confirm"
                        >
                          Legalize
                        </button>
                      </div>
                    ) : (
                      <p
                        className="mt-2 text-xs italic text-muted"
                        data-testid="regime-selective-concession-empty"
                      >
                        No banned parties to legalize — option unavailable.
                      </p>
                    )}
                  </div>
                );
              }
              return (
                <button
                  key={o.id}
                  disabled={busy !== null}
                  onClick={() => void resolveDecision(o.id, data.activeDecision?.payload)}
                  className="rounded border border-card-border bg-card p-3 text-left text-sm hover:bg-card/80 disabled:opacity-50"
                  data-testid={`regime-option-${o.id}`}
                >
                  <div className="font-medium text-foreground">{o.label}</div>
                  <div className="mt-1 text-xs text-muted">{o.description}</div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Reform actions */}
      <section
        className="rounded-lg border border-card-border bg-card p-4"
        data-testid="regime-reform-actions"
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-foreground">Liberalization reforms</h3>
          {data.pendingReformDiscount && data.pendingReformDiscount.turn === data.currentTurn && (
            <span
              className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-400"
              data-testid="regime-discount-flag"
            >
              Half-cost discount available this turn
            </span>
          )}
        </div>
        <div className="space-y-1">
          {Object.keys(REFORM_LABEL).map((action) => {
            const avail = data.reformAvailability[action];
            const onCooldown = avail && !avail.available && avail.cooldownUntil !== undefined;
            const isPerParty = action === "legalizeParty";
            const isExpanded = expandedAction === action;
            const meta = REFORM_META[action];
            return (
              <div key={action} className="rounded border border-card-border/60 bg-background/30">
                <div className="flex items-center justify-between gap-3 p-2">
                  <button
                    type="button"
                    onClick={() => setExpandedAction(isExpanded ? null : action)}
                    className="flex flex-1 items-center gap-2 text-left text-sm text-foreground hover:text-primary"
                    aria-expanded={isExpanded}
                    data-testid={`regime-reform-toggle-${action}`}
                  >
                    <span
                      className={`inline-block w-3 text-muted transition-transform ${isExpanded ? "rotate-90" : ""}`}
                      aria-hidden
                    >
                      ▸
                    </span>
                    <span>{REFORM_LABEL[action]}</span>
                  </button>
                  <div className="flex items-center gap-2">
                    {onCooldown && (
                      <span
                        className="text-xs text-muted"
                        data-testid={`regime-reform-cooldown-${action}`}
                      >
                        cooldown until turn {avail.cooldownUntil}
                      </span>
                    )}
                    {avail?.note && !meta && (
                      <span className="text-xs text-muted">{avail.note}</span>
                    )}
                    <button
                      disabled={!avail?.available || busy !== null || isPerParty}
                      onClick={() => void triggerReform(action)}
                      className="rounded border border-card-border bg-card px-3 py-1 text-xs hover:bg-card/80 disabled:opacity-40 disabled:cursor-not-allowed"
                      data-testid={`regime-reform-${action}`}
                    >
                      Trigger
                    </button>
                  </div>
                </div>
                {isExpanded && meta && (
                  <div
                    className="border-t border-card-border/40 bg-card/40 p-3 text-xs"
                    data-testid={`regime-reform-detail-${action}`}
                  >
                    <p className="text-foreground/90">{meta.description}</p>
                    <dl className="mt-3 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted">Intra-party cost</dt>
                        <dd className="tabular-nums text-foreground">{fmtCost(meta.intraCost)}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted">Popular gain</dt>
                        <dd className="tabular-nums text-foreground">
                          {fmtCost(meta.popularGain)}
                        </dd>
                      </div>
                      {meta.boostPerTurn !== undefined && (
                        <div className="flex justify-between gap-2">
                          <dt className="text-muted">Popular boost</dt>
                          <dd className="tabular-nums text-foreground">
                            +{meta.boostPerTurn}/turn × {meta.boostDurationTurns} turns
                          </dd>
                        </div>
                      )}
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted">Cooldown</dt>
                        <dd className="tabular-nums text-foreground">
                          {meta.cooldownTurns === "one-time"
                            ? "one-time use"
                            : `${meta.cooldownTurns} turns${isPerParty ? " per party" : ""}`}
                        </dd>
                      </div>
                    </dl>
                    {data.pendingReformDiscount &&
                      data.pendingReformDiscount.turn === data.currentTurn && (
                        <p className="mt-2 text-emerald-700 dark:text-emerald-400">
                          Half-cost discount active: intra-party cost is{" "}
                          {Math.round(meta.intraCost * data.pendingReformDiscount.multiplier)} this
                          turn.
                        </p>
                      )}
                    {meta.notes && <p className="mt-2 text-muted">{meta.notes}</p>}
                    {isPerParty && (
                      <p className="mt-2 text-muted">
                        Per-party cooldown — pick a banned party first (party-management page wiring
                        is a follow-up).
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Convention */}
      <section
        className="rounded-lg border border-card-border bg-card p-4"
        data-testid="regime-convention"
      >
        <h3 className="text-sm font-semibold text-foreground">Constitutional convention</h3>
        {!data.convention ? (
          <div className="mt-2 space-y-3 text-xs text-muted">
            <p>
              No convention in progress. A convention is the voluntary off-ramp out of the one-party
              state — the leader negotiates the transition to a parliamentary or presidential system
              on their own terms, instead of waiting for Stage 4 to force a collapse with punishing
              defaults.
            </p>
            <div>
              <p className="font-medium text-foreground/90">How it works</p>
              <ol className="mt-1 list-decimal space-y-1 pl-5">
                <li>
                  <strong className="text-foreground">Announce</strong> — flips
                  <code className="mx-1 rounded bg-card-border/40 px-1">conventionInProgress</code>
                  on, freezes the Stage-4 dwell counter so the regime can&apos;t collapse during
                  negotiations, applies +15 popular / -10 intra, and parks a 48-turn draft window.
                </li>
                <li>
                  <strong className="text-foreground">Draft</strong> — pick the target government
                  type (from <code>collapseTargetAllowlist</code>: parliamentaryRepublic or
                  presidential for CN), the legacy seat reservation (0-35% for the former ruling
                  party in the snap election), and the election-delay window (12 / 24 / 48 turns).
                </li>
                <li>
                  <strong className="text-foreground">Ratify</strong> — at the draft deadline the
                  phase auto-advances to ratification. At
                  <code className="mx-1 rounded bg-card-border/40 px-1">
                    draftDeadlineTurn + electionDelayTurns
                  </code>
                  the conversion fires: governmentType flips, opsVoteMultipliers clear, regimeStatus
                  is wiped from every party, and a snap election is scheduled with the legacy
                  reservation as a vote-share floor for the former ruling party.
                </li>
              </ol>
            </div>
            <p>
              Abandoning the convention (no draft submitted before deadline) silently dissolves it.
              Cannot be announced during Stage 4 (collapse) — at that point only the Stage-4
              decision is available.
            </p>
            <p className="text-foreground/70">
              CN default reservation: <strong>20%</strong> · default election delay:{" "}
              <strong>24 turns</strong>. Both are tunable per-draft.
            </p>
            <button
              disabled={busy !== null || data.stage === "collapse"}
              onClick={() => void announceConvention()}
              className="rounded border border-primary/40 bg-primary/10 px-3 py-1 text-sm text-primary hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed"
              data-testid="regime-convention-announce"
            >
              Announce constitutional convention
            </button>
            {data.stage === "collapse" && (
              <p className="text-rose-600 dark:text-rose-400">
                Disabled: the regime is in Stage 4 (collapse). Voluntary convention is no longer an
                option — resolve the Stage-4 decision instead.
              </p>
            )}
          </div>
        ) : (
          <div className="mt-2 text-xs text-muted" data-testid="regime-convention-status">
            Phase: <strong className="text-foreground">{data.convention.phase}</strong> • announced
            T{data.convention.announcedAtTurn} • draft deadline T{data.convention.draftDeadlineTurn}
            {data.convention.targetSystem && (
              <>
                {" "}
                • target:{" "}
                <strong className="text-foreground">
                  {governmentSystemLabel(data.convention.targetSystem)}
                </strong>
              </>
            )}{" "}
            • legacy {data.convention.legacyReservation}% • election delay{" "}
            {data.convention.electionDelayTurns} turns
            {data.convention.phase === "announced" && (
              <p className="mt-2 text-xs">
                Draft submission UI lives at a future polish pass — for now, submit via POST
                /api/country/{countryCode}/convention/draft.
              </p>
            )}
          </div>
        )}
      </section>

      {/* Recent transitions */}
      {data.transitionHistory.length > 0 && (
        <section
          className="rounded-lg border border-card-border bg-card p-4"
          data-testid="regime-transitions"
        >
          <h3 className="text-sm font-semibold text-foreground">Recent stage transitions</h3>
          <ul className="mt-2 space-y-1 text-xs text-muted">
            {data.transitionHistory.map((t, i) => (
              <li key={`${t.turn}-${i}`}>
                <span className="font-medium text-foreground">Turn {t.turn}:</span>{" "}
                {STAGE_LABEL[t.from] ?? t.from} → {STAGE_LABEL[t.to] ?? t.to} — {t.reason}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ── Scalar card with inline SVG sparkline ───────────────────────────────────

interface ScalarCardProps {
  label: string;
  value: number;
  band: string;
  history: ScalarHistoryEntry[];
  projection: number[] | null;
  currentTurn: number;
  color: "emerald" | "sky";
  testId: string;
}

/**
 * Compact scalar tile with a 24-history + 48-projection sparkline.
 * Solid stroke for history, dashed for projection, vertical "now" tick
 * separating them. Y-axis covers 0–100 so the visual scale is shared
 * between scalars.
 */
function ScalarCard({
  label,
  value,
  band,
  history,
  projection,
  currentTurn: _currentTurn,
  color,
  testId,
}: ScalarCardProps) {
  const HIST_TURNS = 24;
  const recent = [...history].sort((a, b) => a.turn - b.turn).slice(-HIST_TURNS);

  // Series we plot: each recent history entry's `next` value, then the
  // projection values. Connect history → projection so the line is
  // continuous across the "now" tick.
  const histPts = recent.map((h) => h.next);
  const projPts = projection ?? [];

  const stroke = color === "emerald" ? "#10b981" : "#0ea5e9";
  const sparkW = 200;
  const sparkH = 48;
  const total = histPts.length + projPts.length;
  const hasSeries = total > 1;
  const xStep = hasSeries ? sparkW / (total - 1) : 0;
  const yFor = (v: number): number => sparkH - (v / 100) * sparkH;

  const histPath = histPts
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i * xStep).toFixed(2)},${yFor(v).toFixed(2)}`)
    .join(" ");

  // Projection path starts at the last history point so the line is
  // continuous across the boundary.
  const projStartIdx = histPts.length - 1;
  const projPath = projPts.length
    ? `M${(projStartIdx * xStep).toFixed(2)},${yFor(histPts[histPts.length - 1] ?? value).toFixed(
        2
      )} ` +
      projPts
        .map((v, i) => `L${((projStartIdx + 1 + i) * xStep).toFixed(2)},${yFor(v).toFixed(2)}`)
        .join(" ")
    : "";

  const projTip = projPts.length ? projPts[projPts.length - 1] : null;
  const delta = projTip !== null ? projTip - value : null;
  const deltaLabel =
    delta === null
      ? null
      : delta > 0.1
        ? `↑ projected +${delta.toFixed(1)} over 48 turns`
        : delta < -0.1
          ? `↓ projected ${delta.toFixed(1)} over 48 turns`
          : `≈ projected flat over 48 turns`;

  return (
    <div data-testid={testId}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-2xl font-bold tabular-nums text-foreground">{value.toFixed(1)}</dd>
      <dd className="text-xs text-muted">band: {band}</dd>
      {hasSeries && (
        <svg
          viewBox={`0 0 ${sparkW} ${sparkH}`}
          className="mt-2 h-12 w-full"
          aria-label={`${label} history and projection`}
          data-testid={`${testId}-spark`}
        >
          {/* Background bands for quick visual reference */}
          <rect
            x="0"
            y={yFor(60)}
            width={sparkW}
            height={sparkH - yFor(60)}
            fill="currentColor"
            opacity="0.04"
          />
          {/* History (solid) */}
          {histPath && <path d={histPath} stroke={stroke} strokeWidth="1.5" fill="none" />}
          {/* Projection (dashed) */}
          {projPath && (
            <path
              d={projPath}
              stroke={stroke}
              strokeWidth="1.5"
              fill="none"
              strokeDasharray="3 2"
              opacity="0.7"
            />
          )}
          {/* "Now" tick */}
          {projPts.length > 0 && (
            <line
              x1={(projStartIdx * xStep).toFixed(2)}
              y1="0"
              x2={(projStartIdx * xStep).toFixed(2)}
              y2={sparkH}
              stroke="currentColor"
              strokeWidth="0.5"
              opacity="0.3"
              strokeDasharray="2 2"
            />
          )}
        </svg>
      )}
      {deltaLabel && (
        <dd className="mt-1 text-xs text-muted" data-testid={`${testId}-projection-label`}>
          {deltaLabel}
        </dd>
      )}
    </div>
  );
}
