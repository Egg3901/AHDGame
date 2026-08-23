"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/contexts/ToastContext";
import type { CrisisDecisionNode, CrisisEffect } from "@/lib/db/types/crisis";
import { formatCrisisEffectTarget } from "@/lib/crises/effectLabels";
import { buildDecisionHistory } from "@/lib/crises/decisionHistory";
import { computeFiscalImpact } from "@/lib/budget/fiscalImpact";
import { computeAidOutcome } from "@/lib/crises/aidScaling";
import { AID_MAX_PCT_GDP, AID_DEFAULT_PCT_GDP } from "@/lib/constants/crises";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { getCountryFlagUrlForEra } from "@/lib/constants/flags";
import { useActivePreset } from "@/contexts/RegisteredCountriesContext";
import { Tooltip } from "@/components/ui/Tooltip";

/** One leader's response to a multi-responder (global) crisis. */
interface LeaderResponse {
  countryId: string;
  characterName: string;
  nodeId: string;
  optionId: string;
  optionLabel: string;
  responseRole?: string;
  effects?: CrisisEffect[];
  responseScores?: Record<string, number>;
  respondedAt: string;
}

/** Interaction shape as serialized by GET /api/crises/[id]/interaction (ObjectId → string). */
interface SerializedInteraction {
  _id: string;
  crisisId: string;
  decisionTree: CrisisDecisionNode[];
  currentNodeId: string | null;
  collectiveTarget: number | null;
  collectiveCurrent: number;
  contributors: Array<{ countryId: string; amount: number }>;
  leaderResponses?: LeaderResponse[];
  decisionDeadline: string | null;
  resolvedAt: string | null;
  resolutionPath: string[];
  resolutionOutcome: string | null;
  globalResponseOutcome?: {
    outcomeId: string;
    label: string;
    description: string;
    scores: Record<string, number>;
    respondedCountries: number;
    eligibleCountries: number;
  };
}

function roleLabel(role?: string): string | null {
  if (!role) return null;
  return role.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function countryName(countryId: string): string {
  return COUNTRY_CONFIGS[countryId as keyof typeof COUNTRY_CONFIGS]?.name ?? countryId;
}

function formatTimeRemaining(deadlineIso: string): string | null {
  const minutes = Math.ceil((new Date(deadlineIso).getTime() - Date.now()) / 60_000);
  if (minutes <= 0) return "Expired";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours > 0 ? `${hours}h ${mins}m remaining` : `${mins}m remaining`;
}

/**
 * Live deadline label that re-renders each minute so the countdown reads as
 * urgent rather than stale on a long-lived page. Turns rose once under an hour.
 */
function DeadlineCountdown({ deadlineIso }: { deadlineIso: string }) {
  const [label, setLabel] = useState(() => formatTimeRemaining(deadlineIso));
  useEffect(() => {
    const tick = () => setLabel(formatTimeRemaining(deadlineIso));
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, [deadlineIso]);

  if (!label) return null;
  const urgent =
    label === "Expired" ||
    (!label.includes("h") && parseInt(label, 10) <= 60 && !Number.isNaN(parseInt(label, 10)));
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium tabular-nums ${
        urgent
          ? "border-rose-500/30 bg-rose-500/10 text-rose-500 dark:text-rose-400"
          : "border-card-border bg-card-elevated text-muted"
      }`}
    >
      <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      {label}
    </span>
  );
}

/**
 * Compact, signed, color-coded effect chips. Mirrors the EffectPills pattern on
 * the crises list page so the two surfaces read consistently. Used both to
 * preview what a decision option will do and to show a resolution's net effect.
 */
function EffectChips({ effects, max = 4 }: { effects: CrisisEffect[]; max?: number }) {
  if (!effects || effects.length === 0) return null;
  const shown = effects.slice(0, max);
  const overflow = effects.length - shown.length;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((e, i) => (
        <span
          key={i}
          title={e.label}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
            e.value < 0
              ? "border-error/30 bg-error/5 text-error"
              : "border-success/30 bg-success/5 text-success"
          }`}
        >
          <span className="text-muted uppercase tracking-wide text-[9.5px]">
            {formatCrisisEffectTarget(e)}
          </span>
          <span className="font-mono font-semibold">
            {e.value > 0 ? "+" : ""}
            {e.value}
            {e.targetType === "profitMargin" ? "%" : ""}
          </span>
        </span>
      ))}
      {overflow > 0 && (
        <span className="rounded-full border border-card-border px-2 py-0.5 text-[11px] text-muted">
          +{overflow} more
        </span>
      )}
    </div>
  );
}

/**
 * One leader's response, rendered as a single compact row: flag + nation, the
 * leader's name, their chosen option, and the option's effects collapsed into a
 * tooltip-on-hover chip count so a roomful of responders stays readable.
 */
function LeaderResponseRow({ r, effects }: { r: LeaderResponse; effects: CrisisEffect[] }) {
  const preset = useActivePreset();
  return (
    <li className="flex items-center gap-2 text-xs">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={getCountryFlagUrlForEra(r.countryId, preset, 40)}
        alt=""
        className="h-3.5 w-5 shrink-0 rounded-[2px] object-cover ring-1 ring-card-border"
      />
      <span className="font-medium text-foreground shrink-0">{countryName(r.countryId)}</span>
      {r.responseRole ? (
        <span className="rounded-full border border-card-border px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted">
          {roleLabel(r.responseRole)}
        </span>
      ) : null}
      <span className="text-muted/70 shrink-0">·</span>
      <span className="text-muted truncate">{r.characterName}</span>
      <span className="ml-auto flex items-center gap-1.5 shrink-0">
        <span className="rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary">
          {r.optionLabel}
        </span>
        {effects.length > 0 && (
          <span
            title={effects
              .map((e) => `${formatCrisisEffectTarget(e)} ${e.value > 0 ? "+" : ""}${e.value}`)
              .join(" · ")}
            className="cursor-help text-[10px] text-muted tabular-nums"
          >
            {effects.length} effect{effects.length === 1 ? "" : "s"}
          </span>
        )}
      </span>
    </li>
  );
}

/**
 * Interactive crisis-decision panel for the crisis detail page. Consumes
 * GET /api/crises/[id]/interaction and submits decisions via
 * POST /api/crises/[id]/interact. Renders nothing for crises without an active
 * interaction (non-interactive crises, or when the feature flag is off).
 */
export default function CrisisInteractionPanel({ crisisId }: { crisisId: string }) {
  const [interaction, setInteraction] = useState<SerializedInteraction | null>(null);
  const [canInteract, setCanInteract] = useState(false);
  const [multiResponder, setMultiResponder] = useState(false);
  const [alreadyResponded, setAlreadyResponded] = useState(false);
  const [responseRole, setResponseRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [hasContributed, setHasContributed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aidContext, setAidContext] = useState<{
    senderGdp: number;
    senderTreasuryBalance: number;
    senderCurrencyCode: string;
    alreadyPledged: boolean;
  } | null>(null);
  const { showToast } = useToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/crises/${crisisId}/interaction`);
      if (!res.ok) {
        setInteraction(null);
        return;
      }
      const data = await res.json();
      setInteraction(data.interaction ?? null);
      setCanInteract(!!data.canInteract);
      setMultiResponder(!!data.multiResponder);
      setAlreadyResponded(!!data.alreadyResponded);
      setResponseRole(data.responseRole ?? null);
      setAidContext(data.aidContext ?? null);
    } catch {
      setInteraction(null);
    } finally {
      setLoading(false);
    }
  }, [crisisId]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (optionId: string) => {
    setSubmitting(optionId);
    setError(null);
    try {
      const res = await fetch(`/api/crises/${crisisId}/interact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to submit decision");
        return;
      }
      if (data.appliedEffects?.length) {
        showToast("Decision applied", "success");
      } else if (data.nextNode) {
        showToast("Decision submitted", "success");
      } else {
        showToast("Crisis resolved", "success");
      }
      setHasContributed(true);
      await load();
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(null);
    }
  };

  const submitAid = async (pctGdp: number) => {
    setSubmitting("aid");
    setError(null);
    try {
      const res = await fetch(`/api/crises/${crisisId}/interact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pctGdp }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to pledge aid");
        return;
      }
      showToast("Aid pledged — bill sent to your legislature", "success");
      await load();
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(null);
    }
  };

  const submitAidDecline = async (node: CrisisDecisionNode) => {
    const declineOptionId = node.options?.[0]?.optionId;
    setSubmitting("aid");
    try {
      await fetch(`/api/crises/${crisisId}/interact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decline: true, optionId: declineOptionId }),
      });
      await load();
    } finally {
      setSubmitting(null);
    }
  };

  if (loading || !interaction) return null;

  const currentNode =
    interaction.decisionTree.find((n) => n.nodeId === interaction.currentNodeId) ?? null;
  const resolved = !!interaction.resolvedAt;
  const terminalId = interaction.resolutionPath.at(-1);
  const terminalNode = interaction.decisionTree.find(
    (n) => n.nodeId === terminalId && n.type === "terminal"
  );

  return (
    <div className="relative rounded-xl border border-card-border bg-card shadow-card overflow-hidden">
      <div
        className={`absolute inset-x-0 top-0 h-[2px] ${
          resolved
            ? "bg-gradient-to-r from-muted/40 via-muted/20 to-transparent"
            : "bg-gradient-to-r from-primary/60 via-primary/30 to-transparent"
        }`}
      />
      <div className="px-5 py-4 border-b border-card-border flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-1">
          Crisis Response
          <Tooltip content="Interactive crises let players choose a response. Each option has different mechanical effects and political consequences." />
        </h2>
        {!resolved && interaction.decisionDeadline && (
          <DeadlineCountdown deadlineIso={interaction.decisionDeadline} />
        )}
      </div>

      <div className="p-5 space-y-4">
        {/* Active decision node */}
        {!resolved && currentNode && (
          <div>
            <h3 className="text-sm font-medium text-foreground">{currentNode.title}</h3>
            <p className="text-xs text-muted mt-0.5 mb-3">{currentNode.description}</p>

            {multiResponder && (
              <div className="text-[11px] text-muted -mt-2 mb-3 space-y-1">
                <p>
                  Each nation&rsquo;s leader responds for their own country. The combined choices
                  determine the global outcome.
                </p>
                <p>
                  Governments that send no order follow the event&rsquo;s default posture at expiry.
                </p>
                {responseRole ? (
                  <p className="font-medium text-foreground/80">
                    Your role: {roleLabel(responseRole)}
                  </p>
                ) : null}
              </div>
            )}

            {currentNode.type === "collective" && (
              <div className="mb-3">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-muted">Response Fund</span>
                  <span className="tabular-nums">
                    ${interaction.collectiveCurrent.toLocaleString("en-US")} / $
                    {(interaction.collectiveTarget ?? 0).toLocaleString("en-US")}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{
                      width: `${Math.min(100, (interaction.collectiveCurrent / (interaction.collectiveTarget || 1)) * 100)}%`,
                    }}
                  />
                </div>
                {interaction.contributors.length > 0 && (
                  <p className="text-xs text-muted mt-1">
                    {interaction.contributors.length} contributor
                    {interaction.contributors.length === 1 ? "" : "s"}
                  </p>
                )}
              </div>
            )}

            {currentNode.type === "aid" && aidContext && (
              <AidSlider
                node={currentNode}
                ctx={aidContext}
                disabled={!canInteract || aidContext.alreadyPledged || !!submitting}
                onPledge={(pctGdp) => submitAid(pctGdp)}
                onDecline={() => submitAidDecline(currentNode)}
              />
            )}

            {currentNode.type !== "aid" &&
              !(multiResponder && alreadyResponded) &&
              currentNode.options &&
              currentNode.options.length > 0 && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {currentNode.options.map((option) => {
                    const isSubmitting = submitting === option.optionId;
                    const disabled =
                      !canInteract ||
                      isSubmitting ||
                      (currentNode.type === "collective" && hasContributed);
                    return (
                      <button
                        key={option.optionId}
                        onClick={() => submit(option.optionId)}
                        disabled={disabled}
                        className={`group rounded-lg border border-card-border bg-card-elevated p-3 text-left transition-all hover:border-primary/40 hover:-translate-y-px disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 ${
                          isSubmitting ? "animate-pulse" : ""
                        }`}
                      >
                        <div className="text-sm font-medium text-foreground">{option.label}</div>
                        <div className="text-xs text-muted mt-0.5">{option.description}</div>
                        {option.collectiveContribution ? (
                          <div className="text-xs text-primary mt-1">
                            Contribute ${option.collectiveContribution.toLocaleString("en-US")}
                          </div>
                        ) : null}
                        {option.effects && option.effects.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-card-border/60">
                            <EffectChips effects={option.effects} />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

            {multiResponder && alreadyResponded ? (
              <p className="text-xs text-success mt-2">
                Your nation has responded. Other leaders may still respond for theirs.
              </p>
            ) : (
              !canInteract && (
                <p className="text-xs text-muted mt-2">
                  Requires: {currentNode.requiredRoles.join(", ")}
                </p>
              )
            )}
          </div>
        )}

        {/* Resolved */}
        {resolved && (
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs px-2 py-0.5 rounded-full border border-card-border bg-card-elevated text-muted">
                {interaction.resolutionOutcome === "auto" ? "Auto-resolved" : "Resolved"}
              </span>
            </div>
            {terminalNode?.outcomeMessage ? (
              <p className="text-sm text-foreground/80 mt-2 leading-relaxed">
                {terminalNode.outcomeMessage}
              </p>
            ) : terminalNode ? (
              <div className="mt-2">
                <p className="text-sm font-medium text-foreground">{terminalNode.title}</p>
                <p className="text-xs text-muted mt-0.5 leading-relaxed">
                  {terminalNode.description}
                </p>
              </div>
            ) : null}
            {interaction.globalResponseOutcome ? (
              <div className="mt-3 rounded-lg border border-primary/25 bg-primary/5 p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-primary">
                  Global outcome
                </p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {interaction.globalResponseOutcome.label}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted">
                  {interaction.globalResponseOutcome.description}
                </p>
                <p className="mt-2 text-[11px] text-muted">
                  {interaction.globalResponseOutcome.respondedCountries} of{" "}
                  {interaction.globalResponseOutcome.eligibleCountries} eligible governments
                  responded
                </p>
                {Object.keys(interaction.globalResponseOutcome.scores).length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {Object.entries(interaction.globalResponseOutcome.scores).map(
                      ([axis, value]) => (
                        <span
                          key={axis}
                          className="rounded-full border border-card-border bg-card px-2 py-0.5 text-[10px] text-muted"
                        >
                          {axis.replaceAll("_", " ")} {value > 0 ? "+" : ""}
                          {value}
                        </span>
                      )
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
            {terminalNode?.outcomeEffects && terminalNode.outcomeEffects.length > 0 && (
              <div className="mt-3 rounded-lg border border-card-border bg-card-elevated p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-2">
                  Net effect, applied at turn resolve
                </p>
                <EffectChips effects={terminalNode.outcomeEffects} max={8} />
              </div>
            )}
          </div>
        )}

        {/* Leadership responses (multi-responder global crises) */}
        {(interaction.leaderResponses?.length ?? 0) > 0 && (
          <div className="pt-3 border-t border-card-border">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-2">
              Leadership Responses · {interaction.leaderResponses!.length}
            </p>
            <ul className="space-y-1.5">
              {interaction.leaderResponses!.map((r) => {
                return <LeaderResponseRow key={r.countryId} r={r} effects={r.effects ?? []} />;
              })}
            </ul>
          </div>
        )}

        {/* Decision history */}
        {interaction.resolutionPath.length > 0 && (
          <div className="pt-3 border-t border-card-border">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-1.5">
              Decision History
            </p>
            <ul className="text-xs text-muted space-y-0.5">
              {buildDecisionHistory(interaction.decisionTree, interaction.resolutionPath).map(
                (line, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span className="text-muted/60">{i + 1}.</span>
                    <span>{line}</span>
                  </li>
                )
              )}
            </ul>
          </div>
        )}

        {error && <p className="text-xs text-rose-600">{error}</p>}
      </div>
    </div>
  );
}

function AidSlider({
  node,
  ctx,
  disabled,
  onPledge,
  onDecline,
}: {
  node: CrisisDecisionNode;
  ctx: {
    senderGdp: number;
    senderTreasuryBalance: number;
    senderCurrencyCode: string;
    alreadyPledged: boolean;
  };
  disabled: boolean;
  onPledge: (pctGdp: number) => void;
  onDecline: () => void;
}) {
  const max = node.aidMaxPctGdp ?? AID_MAX_PCT_GDP;
  const [pct, setPct] = useState(node.aidDefaultPctGdp ?? AID_DEFAULT_PCT_GDP);
  const { amountLocal, senderEffects } = computeAidOutcome(pct, ctx.senderGdp);
  const { fromSurplus, addedToDebt } = computeFiscalImpact(ctx.senderTreasuryBalance, amountLocal);
  const cur = ctx.senderCurrencyCode;
  const fmt = (n: number) => `${cur} ${Math.round(n).toLocaleString("en-US")}`;
  const approval = senderEffects.find((e) => e.targetType === "approval")?.value ?? 0;

  if (ctx.alreadyPledged) {
    return (
      <p className="text-xs text-muted">Your country has already pledged aid to this crisis.</p>
    );
  }
  return (
    <div className="space-y-3">
      <input
        type="range"
        min={0}
        max={max}
        step={max / 100}
        value={pct}
        onChange={(e) => setPct(Number(e.target.value))}
        disabled={disabled}
        className="w-full accent-primary"
      />
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted">Pledge</span>
        <span className="tabular-nums font-medium text-foreground">
          {(pct * 100).toFixed(2)}% of GDP · {fmt(amountLocal)}
        </span>
      </div>
      <p className="text-xs text-success">
        Diplomatic standing +{approval.toFixed(1)}% if the legislature approves.
      </p>
      <FiscalBadge fromSurplus={fromSurplus} addedToDebt={addedToDebt} fmt={fmt} />
      <div className="flex gap-2">
        <button
          onClick={() => onPledge(pct)}
          disabled={disabled || amountLocal <= 0}
          className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-medium text-primary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Pledge Aid
        </button>
        <button
          onClick={onDecline}
          disabled={disabled}
          className="rounded-lg border border-card-border px-3 py-2 text-sm text-muted disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Decline
        </button>
      </div>
    </div>
  );
}

function FiscalBadge({
  fromSurplus,
  addedToDebt,
  fmt,
}: {
  fromSurplus: number;
  addedToDebt: number;
  fmt: (n: number) => string;
}) {
  if (addedToDebt <= 0) {
    return <p className="text-xs text-success">Funded from your {fmt(fromSurplus)} surplus.</p>;
  }
  if (fromSurplus > 0) {
    return (
      <p className="text-xs text-warning">
        {fmt(fromSurplus)} from surplus, {fmt(addedToDebt)} added to national debt (covered at next
        bond issuance).
      </p>
    );
  }
  return (
    <p className="text-xs text-warning">
      Adds {fmt(addedToDebt)} to national debt — financed at next bond issuance.
    </p>
  );
}
