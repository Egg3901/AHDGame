"use client";

import { useEffect, useState } from "react";
import { fetchJson } from "@/lib/observability/fetchJson";
import {
  STATE_BILL_CATEGORIES,
  BILL_PROPOSE_ACTION_COST,
  SUBSIDY_BILL_CATEGORIES,
  getProvisionCostTotal,
} from "@shared/constants/legislation";
import type { BillCategory } from "@shared/constants/legislation";
import type { LegislationTypeOption } from "@/lib/legislature/dto/stateLegislature";
import { PolicyEffectIndicators } from "@/components/legislation/PolicyEffectIndicators";
import { SubsidySectorSelect } from "@/components/bills/SubsidySectorSelect";

export interface EligibleNpp {
  _id: string;
  name: string;
}

interface Props {
  open: boolean;
  countryId: string;
  stateId: string;
  eligibleNpps: EligibleNpp[];
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * Queue-a-bill modal — mirrors the category → legislation-type → policy-option
 * cascade used by ProposeStateBillModal so governors compose bills with the
 * same shape as a direct sponsor. v1 is single-provision.
 */
export function QueueBillModal({
  open,
  countryId,
  stateId,
  eligibleNpps,
  onClose,
  onSuccess,
}: Props) {
  const [targetNppId, setTargetNppId] = useState("");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [category, setCategory] = useState<string>(STATE_BILL_CATEGORIES[0]);
  const [legislationTypes, setLegislationTypes] = useState<LegislationTypeOption[]>([]);
  const [legId, setLegId] = useState("");
  const [policyOptionId, setPolicyOptionId] = useState("");
  const [effectDirection, setEffectDirection] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actions, setActions] = useState<number | null>(null);
  const [nationalInfluence, setNationalInfluence] = useState<number | null>(null);
  const [currentPolicies, setCurrentPolicies] = useState<Record<string, number>>({});
  const [blockedProvisions, setBlockedProvisions] = useState<
    { legislationTypeId: string; policyOptionId: string }[]
  >([]);
  const [subsidyProvisions, setSubsidyProvisions] = useState([
    {
      type: "subsidy" as "subsidy" | "end_subsidy",
      scopeType: "economy_wide" as "economy_wide" | "sector",
      targetSectorType: "",
      targetStrategyId: "",
      domesticOnly: false,
    },
  ]);

  const isSubsidyCat = SUBSIDY_BILL_CATEGORIES.has(category as BillCategory);

  // Fetch legislation types for the selected category, scoped to country + state.
  useEffect(() => {
    if (!open) return;
    const country = countryId.toLowerCase();
    fetch(
      `/api/game/legislation-types?category=${encodeURIComponent(category)}&scope=state&country=${country}&nocache=1`,
      { cache: "no-store" }
    )
      .then((r) => (r.ok ? r.json() : []))
      .then((list: LegislationTypeOption[]) => {
        setLegislationTypes(list || []);
        setLegId("");
        setPolicyOptionId("");
        setEffectDirection(0);
      })
      .catch(() => setLegislationTypes([]));
  }, [open, category, countryId]);

  // Fetch the governor's action / NPI balance to drive cost affordability.
  useEffect(() => {
    if (!open) return;
    fetchJson<{
      user?: { character?: { actions?: number; nationalInfluence?: number } };
    }>("/api/auth/me", { cache: "no-store", feature: "queue-bill-me" })
      .then((data) => {
        setActions(data?.user?.character?.actions ?? null);
        setNationalInfluence(data?.user?.character?.nationalInfluence ?? null);
      })
      .catch(() => {});
  }, [open]);

  // Current state policy levels — used to gray out the option already in force.
  useEffect(() => {
    if (!open) return;
    fetch(`/api/game/current-policies?stateId=${encodeURIComponent(stateId)}`, {
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : {}))
      .then((data: Record<string, number>) => setCurrentPolicies(data || {}))
      .catch(() => setCurrentPolicies({}));
  }, [open, stateId]);

  // Active state bills' provisions — used to gray out options already in flight.
  useEffect(() => {
    if (!open) return;
    fetch(
      `/api/country/${countryId.toLowerCase()}/region/${stateId.toLowerCase()}/legislature/bills`,
      { cache: "no-store" }
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setBlockedProvisions(data?.blockedProvisions ?? []);
      })
      .catch(() => setBlockedProvisions([]));
  }, [open, countryId, stateId]);

  const blockedProvisionKeys = new Set(
    blockedProvisions.map((bp) => `${bp.legislationTypeId}:${bp.policyOptionId}`)
  );

  const actionCost = BILL_PROPOSE_ACTION_COST;
  const npiCost = getProvisionCostTotal(isSubsidyCat ? subsidyProvisions.length : legId ? 1 : 0);
  const canAffordActions = actions === null || actions >= actionCost;
  const canAffordNpi = npiCost === 0 || nationalInfluence === null || nationalInfluence >= npiCost;
  const canAfford = canAffordActions && canAffordNpi;

  if (!open) return null;

  if (eligibleNpps.length === 0) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        role="dialog"
        aria-modal="true"
      >
        <div className="w-full max-w-md rounded-2xl border border-card-border bg-card p-6 shadow-modal">
          <h2 className="text-lg font-semibold mb-2">No eligible NPPs</h2>
          <p className="text-sm text-muted mb-4">
            No state-legislature NPPs from your party hold seats in this state. Recruit or elect one
            before you can queue legislation.
          </p>
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-background/60"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  const selectedType = legislationTypes.find((t) => t._id === legId);
  const policyOptions = selectedType?.policyOptions ?? [];

  async function submit() {
    if (!targetNppId || !title.trim() || !summary.trim()) return;
    setSubmitting(true);
    setError(null);
    const body: Record<string, unknown> = {
      targetNppId,
      title: title.trim(),
      summary: summary.trim(),
      category,
    };
    if (isSubsidyCat) {
      const invalidSector = subsidyProvisions.find(
        (p) => p.scopeType === "sector" && !p.targetSectorType.trim()
      );
      if (invalidSector) {
        setError("Sector-scoped subsidy provisions require a target sector type.");
        setSubmitting(false);
        return;
      }
      body.provisions = subsidyProvisions.map((p) => ({
        type: p.type,
        scopeType: p.scopeType,
        ...(p.scopeType === "sector" && p.targetSectorType
          ? { targetSectorType: p.targetSectorType }
          : {}),
        ...(p.targetStrategyId.trim() ? { targetStrategyId: p.targetStrategyId.trim() } : {}),
        ...(p.type === "subsidy" ? { domesticOnly: p.domesticOnly } : {}),
      }));
    } else if (legId) {
      body.provisions = [
        {
          legislationTypeId: legId,
          ...(policyOptionId ? { policyOptionId } : {}),
          effectDirection,
        },
      ];
      body.legislationTypeId = legId;
      body.effectDirection = effectDirection;
    }
    const res = await fetch(
      `/api/country/${countryId.toLowerCase()}/region/${stateId.toLowerCase()}/office/legislation/queue`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    if (res.ok) onSuccess();
    else {
      const data = await res.json().catch(() => ({}));
      setError(data?.error ?? "Failed to queue.");
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="queue-bill-title"
    >
      <div className="w-full max-w-2xl rounded-2xl border border-card-border bg-card p-6 shadow-modal max-h-[90vh] overflow-y-auto">
        <h2 id="queue-bill-title" className="text-lg font-semibold mb-3">
          Queue a bill
        </h2>
        <p className="text-xs text-muted mb-4">
          The chosen NPP will introduce this bill next turn. Costs the same as proposing a state
          bill directly; refunded on cancellation or auto-cancellation.
        </p>

        <label className="block text-xs text-muted mb-1">Proposing NPP</label>
        <select
          value={targetNppId}
          onChange={(e) => setTargetNppId(e.target.value)}
          className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm mb-3"
          disabled={submitting}
        >
          <option value="">Select an NPP…</option>
          {eligibleNpps.map((n) => (
            <option key={n._id} value={n._id}>
              {n.name}
            </option>
          ))}
        </select>

        <label className="block text-xs text-muted mb-1">Title</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm mb-3"
          maxLength={200}
          disabled={submitting}
        />

        <label className="block text-xs text-muted mb-1">Summary</label>
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm mb-3"
          maxLength={2000}
          disabled={submitting}
        />

        <label className="block text-xs text-muted mb-1">Category</label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm mb-3"
          disabled={submitting}
        >
          {/* Custom (flavor) bills are not offered via the governor queue channel. */}
          {STATE_BILL_CATEGORIES.filter((c) => c !== "custom").map((c) => (
            <option key={c} value={c}>
              {c.charAt(0).toUpperCase() + c.slice(1)}
            </option>
          ))}
        </select>

        {isSubsidyCat ? (
          <div className="mb-3 space-y-3">
            <label className="block text-xs text-muted">Subsidy provisions</label>
            {subsidyProvisions.map((sp, i) => (
              <div
                key={i}
                className="rounded-lg border border-card-border bg-background/50 p-3 space-y-2"
              >
                <select
                  value={sp.type}
                  onChange={(e) =>
                    setSubsidyProvisions((prev) => {
                      const next = [...prev];
                      next[i] = { ...next[i], type: e.target.value as "subsidy" | "end_subsidy" };
                      return next;
                    })
                  }
                  className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
                  disabled={submitting}
                >
                  <option value="subsidy">Grant Subsidy (+7.5% margin)</option>
                  <option value="end_subsidy">End Subsidy</option>
                </select>
                <select
                  value={sp.scopeType}
                  onChange={(e) =>
                    setSubsidyProvisions((prev) => {
                      const next = [...prev];
                      next[i] = {
                        ...next[i],
                        scopeType: e.target.value as "economy_wide" | "sector",
                        targetSectorType: "",
                      };
                      return next;
                    })
                  }
                  className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
                  disabled={submitting}
                >
                  <option value="economy_wide">Economy-Wide</option>
                  <option value="sector">Specific Sector</option>
                </select>
                {sp.scopeType === "sector" && (
                  <SubsidySectorSelect
                    value={sp.targetSectorType}
                    onChange={(value) =>
                      setSubsidyProvisions((prev) => {
                        const next = [...prev];
                        next[i] = { ...next[i], targetSectorType: value };
                        return next;
                      })
                    }
                    className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
                  />
                )}
                {sp.type === "subsidy" && (
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sp.domesticOnly}
                      onChange={(e) =>
                        setSubsidyProvisions((prev) => {
                          const next = [...prev];
                          next[i] = { ...next[i], domesticOnly: e.target.checked };
                          return next;
                        })
                      }
                      className="rounded"
                      disabled={submitting}
                    />
                    <span>State-headquartered companies only</span>
                  </label>
                )}
              </div>
            ))}
          </div>
        ) : (
          <>
            <label className="block text-xs text-muted mb-1">Legislation type</label>
            <select
              value={legId}
              onChange={(e) => {
                setLegId(e.target.value);
                const t = legislationTypes.find((lt) => lt._id === e.target.value);
                const options = t?.policyOptions ?? [];
                const currentIdx = currentPolicies[e.target.value];
                const firstEligible = options.find((opt, idx) => {
                  const isCurrent = currentIdx === idx;
                  const isBlocked = blockedProvisionKeys.has(`${e.target.value}:${opt.id}`);
                  return !isCurrent && !isBlocked;
                });
                setPolicyOptionId(firstEligible?.id ?? "");
                setEffectDirection(firstEligible?.effectDirection ?? 0);
              }}
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm mb-3"
              disabled={submitting || legislationTypes.length === 0}
            >
              <option value="">— None (general bill) —</option>
              {legislationTypes.map((t) => (
                <option key={t._id} value={t._id}>
                  {t.name}
                  {t.eraNew ? " — New this era" : ""}
                </option>
              ))}
            </select>
          </>
        )}

        {!isSubsidyCat && legId && policyOptions.length > 0 && (
          <>
            <label className="block text-xs text-muted mb-1">Policy option</label>
            <select
              value={policyOptionId}
              onChange={(e) => {
                setPolicyOptionId(e.target.value);
                const opt = policyOptions.find((o) => o.id === e.target.value);
                setEffectDirection(opt?.effectDirection ?? 0);
              }}
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm mb-2"
              disabled={submitting}
            >
              {policyOptions.map((opt, optIdx) => {
                const isCurrentLevel = currentPolicies[legId] === optIdx;
                const isBlocked = blockedProvisionKeys.has(`${legId}:${opt.id}`);
                const disableReason = isCurrentLevel
                  ? " (current law)"
                  : isBlocked
                    ? " (active bill exists)"
                    : "";
                return (
                  <option key={opt.id} value={opt.id} disabled={isCurrentLevel || isBlocked}>
                    {opt.name}
                    {disableReason}
                  </option>
                );
              })}
            </select>
            {(() => {
              const selectedOpt = policyOptions.find((o) => o.id === policyOptionId);
              const explanation =
                selectedOpt?.explanation ??
                selectedType?.explanation ??
                selectedType?.description ??
                null;
              return explanation ? (
                <p className="text-xs text-muted/80 italic mb-2 pb-2 border-b border-card-border/50">
                  {explanation}
                </p>
              ) : null;
            })()}
            <div className="mb-3">
              <PolicyEffectIndicators
                effectTargetsWeighted={selectedType?.effectTargetsWeighted}
                effectDirection={effectDirection}
                archetypeApprovals={
                  policyOptions.find((o) => o.id === policyOptionId)?.archetypeApprovals
                }
                groupApprovals={policyOptions.find((o) => o.id === policyOptionId)?.groupApprovals}
                policyDomain={selectedType?.policyDomain}
                currentPolicyIndex={currentPolicies[legId] ?? 3}
                proposedPolicyIndex={policyOptions.findIndex((o) => o.id === policyOptionId)}
                billCountry={countryId.toUpperCase()}
                policyOptions={policyOptions}
              />
            </div>
          </>
        )}

        <div className="rounded-lg border border-card-border bg-card/50 px-3 py-2 text-xs text-muted mb-3">
          <span>
            Cost: {actionCost} actions + {npiCost} national influence · Voting: 24 hours
          </span>
          <span className="block mt-0.5 text-muted/80">
            Refunded on cancellation or auto-cancellation.
          </span>
          {(actions != null || nationalInfluence != null) && (
            <span className="block mt-0.5">
              Balance: {actions ?? "?"} actions, {nationalInfluence?.toFixed(0) ?? "?"} NPI
            </span>
          )}
          {!canAffordActions && (
            <span className="block mt-1 text-error">
              Not enough action points ({actions ?? 0}/{actionCost}).
            </span>
          )}
          {!canAffordNpi && npiCost > 0 && (
            <span className="block mt-1 text-error">
              Not enough national influence ({nationalInfluence?.toFixed(0) ?? 0}/{npiCost}).
            </span>
          )}
        </div>

        {error && <p className="text-sm text-error mb-3">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-background/60"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting || !canAfford || !targetNppId || !title.trim() || !summary.trim()}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/80 disabled:opacity-50"
          >
            {submitting ? "Queuing…" : "Queue bill"}
          </button>
        </div>
      </div>
    </div>
  );
}
