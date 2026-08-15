"use client";

import { useState, useEffect } from "react";
import { fetchJson } from "@/lib/observability/fetchJson";
import { regionApiSubUrl } from "@/lib/urls";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import {
  STATE_BILL_CATEGORIES,
  SUBSIDY_BILL_CATEGORIES,
  BILL_PROPOSE_ACTION_COST,
  getProvisionCostTotal,
} from "@shared/constants/legislation";
import type { BillCategory } from "@shared/constants/legislation";
import { PolicyEffectIndicators } from "@/components/legislation/PolicyEffectIndicators";
import {
  LawProvisionComparison,
  BillFiscalImpactStrip,
} from "@/components/bills/LawProvisionComparison";
import {
  LegislationTypeOption,
  MAX_PROVISIONS,
  getEconomicLabel,
  getSocialLabel,
} from "@/lib/legislature/dto/stateLegislature";
import { SubsidySectorSelect } from "@/components/bills/SubsidySectorSelect";
import { TaxRateSliderControl } from "@/components/legislation/TaxRateSliderControl";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";

export function ProposeStateBillModal({
  stateId,
  countryId,
  adminOverride,
  blockedProvisions,
  onClose,
  onSuccess,
}: {
  stateId: string;
  countryId: string;
  adminOverride: boolean;
  blockedProvisions?: { legislationTypeId: string; policyOptionId: string }[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [category, setCategory] = useState<string>(STATE_BILL_CATEGORIES[0]);
  const [legislationTypes, setLegislationTypes] = useState<LegislationTypeOption[]>([]);
  const [provisions, setProvisions] = useState<
    {
      legislationTypeId: string;
      policyOptionId: string;
      effectDirection: number;
      economic: number;
      social: number;
      proposedRate?: number;
    }[]
  >([{ legislationTypeId: "", policyOptionId: "", effectDirection: 0, economic: 0, social: 0 }]);
  const [subsidyProvisions, setSubsidyProvisions] = useState<
    {
      type: "subsidy" | "end_subsidy";
      scopeType: "economy_wide" | "sector";
      targetSectorType: string;
      targetStrategyId: string;
      domesticOnly: boolean;
    }[]
  >([
    {
      type: "subsidy",
      scopeType: "economy_wide",
      targetSectorType: "",
      targetStrategyId: "",
      domesticOnly: false,
    },
  ]);
  const [actions, setActions] = useState<number | null>(null);
  const [nationalInfluence, setNationalInfluence] = useState<number | null>(null);
  const [currentPolicies, setCurrentPolicies] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isSubsidyCat = SUBSIDY_BILL_CATEGORIES.has(category as BillCategory);
  // Custom (flavor/roleplay) bills carry no provisions and have no in-game effect.
  const isCustomCat = category === "custom";

  const blockedProvisionKeys = new Set(
    (blockedProvisions ?? []).map((bp) => `${bp.legislationTypeId}:${bp.policyOptionId}`)
  );
  const countryConfig = getCountryConfig(countryId as CountryId);
  const country = countryConfig.id.toLowerCase();
  // Use "Regional" for regional-model sub-national tiers (e.g. UK Regional Councils);
  // "State" for the US-style state model (which also has a sub-national chamber).
  const billScope = countryConfig.subNationalChamber?.regionalModel ? "Regional" : "State";

  // Fetch legislation types for selected category, scoped to the correct country.
  // regionId prices new-gen fiscal estimates at the Land/region GDP, not national.
  useEffect(() => {
    fetch(
      `/api/game/legislation-types?category=${encodeURIComponent(category)}&scope=state&country=${country}&regionId=${encodeURIComponent(stateId)}&nocache=1`,
      { cache: "no-store" }
    )
      .then((r) => (r.ok ? r.json() : []))
      .then((list: LegislationTypeOption[]) => setLegislationTypes(list || []))
      .catch(() => setLegislationTypes([]));
  }, [category, country, stateId]);

  // Fetch user's action and NPI balance
  useEffect(() => {
    fetchJson<{
      user?: { character?: { actions?: number; nationalInfluence?: number } };
    }>("/api/auth/me", { cache: "no-store", feature: "propose-state-bill-me" })
      .then((data) => {
        setActions(data?.user?.character?.actions ?? null);
        setNationalInfluence(data?.user?.character?.nationalInfluence ?? null);
      })
      .catch(() => {});
  }, []);

  // Fetch current state policies for shift-based approval preview
  useEffect(() => {
    fetch(`/api/game/current-policies?stateId=${encodeURIComponent(stateId)}`, {
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : {}))
      .then((data: Record<string, number>) => setCurrentPolicies(data))
      .catch(() => setCurrentPolicies({}));
  }, [stateId]);

  const actionCost = adminOverride ? 0 : BILL_PROPOSE_ACTION_COST;
  const provisionCountForNpi = isCustomCat
    ? 0
    : isSubsidyCat
      ? subsidyProvisions.length
      : provisions.filter((p) => p.legislationTypeId.trim()).length;
  const npiCost = adminOverride ? 0 : getProvisionCostTotal(provisionCountForNpi);
  const canAffordActions = adminOverride || actions === null || actions >= actionCost;
  const canAffordNpi =
    adminOverride || npiCost === 0 || nationalInfluence === null || nationalInfluence >= npiCost;
  const canAfford = canAffordActions && canAffordNpi;

  function setProvision(index: number, patch: Partial<(typeof provisions)[0]>) {
    setProvisions((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      const lt = legislationTypes.find((t) => t._id === next[index].legislationTypeId);
      if (patch.legislationTypeId != null && lt?.policyOptions?.length) {
        const first = lt.policyOptions[0];
        next[index].policyOptionId = first.id;
        next[index].effectDirection = first.effectDirection;
        next[index].economic = first.economic ?? 0;
        next[index].social = first.social ?? 0;
      }
      if (patch.legislationTypeId != null && lt?.taxSliderEstimate) {
        next[index].proposedRate = lt.taxSliderEstimate.currentRate;
        next[index].policyOptionId = `rate:${lt.taxSliderEstimate.currentRate}`;
      }
      return next;
    });
  }

  function addProvision() {
    if (provisions.length >= MAX_PROVISIONS) return;
    setProvisions((prev) => [
      ...prev,
      { legislationTypeId: "", policyOptionId: "", effectDirection: 0, economic: 0, social: 0 },
    ]);
  }

  function removeProvision(index: number) {
    if (provisions.length <= 1) return;
    setProvisions((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!canAffordActions) {
      setError(`Proposing a bill costs ${actionCost} action points (you have ${actions ?? 0}).`);
      return;
    }
    if (!canAffordNpi) {
      setError(
        `This bill costs ${npiCost} national political influence (you have ${nationalInfluence?.toFixed(0) ?? 0}).`
      );
      return;
    }

    setLoading(true);
    try {
      let bodyProvisions: unknown[];
      if (isCustomCat) {
        bodyProvisions = [];
      } else if (isSubsidyCat) {
        const invalidSector = subsidyProvisions.find(
          (p) => p.scopeType === "sector" && !p.targetSectorType.trim()
        );
        if (invalidSector) {
          setError("Sector-scoped subsidy provisions require a target sector type.");
          setLoading(false);
          return;
        }
        bodyProvisions = subsidyProvisions.map((p) => ({
          type: p.type,
          scopeType: p.scopeType,
          ...(p.scopeType === "sector" && p.targetSectorType
            ? { targetSectorType: p.targetSectorType }
            : {}),
          ...(p.targetStrategyId.trim() ? { targetStrategyId: p.targetStrategyId.trim() } : {}),
          ...(p.type === "subsidy" ? { domesticOnly: p.domesticOnly } : {}),
        }));
      } else {
        const validProvisions = provisions.filter((p) => p.legislationTypeId.trim());
        if (validProvisions.length === 0) {
          setError("At least one provision must have a legislation type selected.");
          setLoading(false);
          return;
        }
        for (const p of validProvisions) {
          const slider = legislationTypes.find(
            (t) => t._id === p.legislationTypeId
          )?.taxSliderEstimate;
          if (!slider) continue;
          const proposed = p.proposedRate ?? slider.currentRate;
          if (Math.abs(proposed - slider.currentRate) < slider.step - 1e-9) {
            setError(`Tax proposals must change the rate by at least ${slider.step}.`);
            setLoading(false);
            return;
          }
        }
        bodyProvisions = validProvisions.map((p) => ({
          legislationTypeId: p.legislationTypeId.trim(),
          policyOptionId: p.policyOptionId || undefined,
          effectDirection: p.effectDirection,
          economic: p.economic,
          social: p.social,
          ...(p.proposedRate !== undefined ? { proposedRate: p.proposedRate } : {}),
        }));
      }

      const res = await fetch(regionApiSubUrl(countryId, stateId, "legislature/bills"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          summary: summary.trim(),
          category,
          provisions: bodyProvisions,
          adminOverride,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to propose bill");
        return;
      }

      onSuccess();
    } catch {
      setError("Failed to propose bill");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto py-8">
      <div className="w-full max-w-lg rounded-2xl border border-card-border bg-card p-6 space-y-5 shadow-modal my-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">
            {adminOverride
              ? `Propose ${billScope} Bill (Admin)`
              : `Propose ${billScope} Legislation`}
          </h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {error && (
          <div className="rounded-lg bg-error/10 border border-error/30 px-4 py-2 text-sm text-error">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-muted mb-1">Bill Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. State Tax Reform Act"
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              required
            />
          </div>

          <div>
            <label className="block text-xs text-muted mb-1">Summary</label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Brief description of what this bill does..."
              rows={3}
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              required
            />
          </div>

          <div>
            <label className="block text-xs text-muted mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm capitalize"
            >
              {STATE_BILL_CATEGORIES.map((c) => (
                <option key={c} value={c} className="capitalize">
                  {c}
                </option>
              ))}
            </select>
          </div>

          {isCustomCat ? (
            /* ── Custom (flavor) bill: no provisions, no in-game effect ── */
            <p className="rounded-lg border border-card-border bg-card/50 px-3 py-2 text-xs text-muted">
              Custom bills have no in-game effect — for flavor / roleplay only. Just give it a title
              and summary.
            </p>
          ) : isSubsidyCat ? (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs text-muted">Subsidy Provisions</label>
                {subsidyProvisions.length < MAX_PROVISIONS && (
                  <button
                    type="button"
                    onClick={() =>
                      setSubsidyProvisions((prev) => [
                        ...prev,
                        {
                          type: "subsidy",
                          scopeType: "economy_wide",
                          targetSectorType: "",
                          targetStrategyId: "",
                          domesticOnly: false,
                        },
                      ])
                    }
                    className="text-xs text-primary hover:underline"
                  >
                    + Add provision
                  </button>
                )}
              </div>
              <div className="space-y-3">
                {subsidyProvisions.map((sp, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-card-border bg-background/50 p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-muted">Provision {i + 1}</span>
                      {subsidyProvisions.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setSubsidyProvisions((prev) => prev.filter((_, j) => j !== i))
                          }
                          className="text-xs text-error hover:underline"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      <select
                        value={sp.type}
                        onChange={(e) =>
                          setSubsidyProvisions((prev) => {
                            const next = [...prev];
                            next[i] = {
                              ...next[i],
                              type: e.target.value as "subsidy" | "end_subsidy",
                            };
                            return next;
                          })
                        }
                        className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
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
                          placeholderLabel="All sectors"
                          className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
                        />
                      )}
                      <input
                        type="text"
                        value={sp.targetStrategyId}
                        onChange={(e) =>
                          setSubsidyProvisions((prev) => {
                            const next = [...prev];
                            next[i] = { ...next[i], targetStrategyId: e.target.value };
                            return next;
                          })
                        }
                        placeholder="Strategy filter (optional, e.g. renewables)"
                        className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
                      />
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
                          />
                          <span>State-headquartered companies only</span>
                        </label>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs text-muted">Provisions (type + policy)</label>
                {provisions.length < MAX_PROVISIONS && (
                  <button
                    type="button"
                    onClick={addProvision}
                    className="text-xs text-primary hover:underline"
                  >
                    + Add provision
                  </button>
                )}
              </div>
              <div className="space-y-3">
                {provisions.map((p, i) => {
                  const type = legislationTypes.find((t) => t._id === p.legislationTypeId);
                  const options = type?.policyOptions ?? [];
                  return (
                    <div
                      key={i}
                      className="rounded-lg border border-card-border bg-background/50 p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-muted">Provision {i + 1}</span>
                        {provisions.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeProvision(i)}
                            className="text-xs text-error hover:underline"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-1 gap-2">
                        <select
                          value={p.legislationTypeId}
                          onChange={(e) =>
                            setProvision(i, {
                              legislationTypeId: e.target.value,
                              policyOptionId: "",
                              effectDirection: 0,
                            })
                          }
                          className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
                        >
                          <option value="">Select type...</option>
                          {legislationTypes.map((lt) => (
                            <option key={lt._id} value={lt._id}>
                              {lt.name}
                              {lt.eraNew ? " — New this era" : ""}
                            </option>
                          ))}
                        </select>
                        {p.legislationTypeId && type?.taxSliderEstimate && (
                          <TaxRateSliderControl
                            slider={type.taxSliderEstimate}
                            proposedRate={p.proposedRate ?? type.taxSliderEstimate.currentRate}
                            currencyCode={COUNTRY_CURRENCY_MAP[countryId as CountryId]}
                            onChange={(rate) =>
                              setProvision(i, {
                                proposedRate: rate,
                                policyOptionId: `rate:${rate}`,
                                effectDirection:
                                  rate > type.taxSliderEstimate!.currentRate ? 1 : -1,
                              })
                            }
                          />
                        )}
                        {p.legislationTypeId &&
                          !type?.taxSliderEstimate &&
                          (options.length > 0 ? (
                            <select
                              value={p.policyOptionId}
                              onChange={(e) => {
                                const opt = options.find((o) => o.id === e.target.value);
                                setProvision(i, {
                                  policyOptionId: e.target.value,
                                  effectDirection: opt?.effectDirection ?? 0,
                                  economic: opt?.economic ?? 0,
                                  social: opt?.social ?? 0,
                                });
                              }}
                              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
                            >
                              {options.map((opt, optIdx) => {
                                const econ = opt.economic ?? 0;
                                const soc = opt.social ?? 0;
                                const posLabel = [
                                  econ !== 0 && `${getEconomicLabel(econ)} econ`,
                                  soc !== 0 && `${getSocialLabel(soc)} social`,
                                ]
                                  .filter(Boolean)
                                  .join(", ");
                                const isBlocked = blockedProvisionKeys.has(
                                  `${p.legislationTypeId}:${opt.id}`
                                );
                                const isCurrentLevel =
                                  currentPolicies[p.legislationTypeId] === optIdx;
                                const disableReason = isCurrentLevel
                                  ? " (current law)"
                                  : isBlocked
                                    ? " (active bill exists)"
                                    : "";
                                return (
                                  <option
                                    key={opt.id}
                                    value={opt.id}
                                    disabled={isBlocked || isCurrentLevel}
                                  >
                                    {opt.name}
                                    {posLabel ? ` — ${posLabel}` : ""}
                                    {disableReason}
                                  </option>
                                );
                              })}
                            </select>
                          ) : (
                            <select
                              value={p.effectDirection}
                              onChange={(e) =>
                                setProvision(i, { effectDirection: Number(e.target.value) })
                              }
                              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
                            >
                              <option value={-1}>Decrease</option>
                              <option value={0}>Neutral</option>
                              <option value={1}>Increase</option>
                            </select>
                          ))}
                      </div>
                      {/* Explanation text below provision */}
                      {p.legislationTypeId && (
                        <div className="text-xs pt-1 border-t border-card-border/50 mt-2">
                          {(() => {
                            const selectedOpt = options.find((o) => o.id === p.policyOptionId);
                            if (type?.politicalMetricTargets?.length) {
                              return (
                                <div className="space-y-1">
                                  {type.description && (
                                    <p className="italic text-muted/80">{type.description}</p>
                                  )}
                                  {selectedOpt?.explanation && (
                                    <p className="text-muted">{selectedOpt.explanation}</p>
                                  )}
                                </div>
                              );
                            }
                            const explanation =
                              selectedOpt?.explanation ?? type?.explanation ?? type?.description;
                            return explanation ? (
                              <span className="italic text-muted/80">{explanation}</span>
                            ) : null;
                          })()}
                        </div>
                      )}
                      {/* New-gen laws: Current law → Proposed with fiscal + metric deltas. */}
                      {p.legislationTypeId && type && !type.taxSliderEstimate && (
                        <div className="pt-2">
                          <LawProvisionComparison
                            countryId={countryId}
                            lt={type}
                            currentIndex={currentPolicies[p.legislationTypeId]}
                            proposedIndex={options.findIndex((o) => o.id === p.policyOptionId)}
                          />
                        </div>
                      )}
                      {p.legislationTypeId && !type?.taxSliderEstimate && (
                        <PolicyEffectIndicators
                          effectTargetsWeighted={type?.effectTargetsWeighted}
                          effectDirection={p.effectDirection}
                          archetypeApprovals={
                            options.find((o) => o.id === p.policyOptionId)?.archetypeApprovals
                          }
                          groupApprovals={
                            options.find((o) => o.id === p.policyOptionId)?.groupApprovals
                          }
                          policyDomain={type?.policyDomain}
                          currentPolicyIndex={currentPolicies[p.legislationTypeId] ?? 3}
                          proposedPolicyIndex={options.findIndex((o) => o.id === p.policyOptionId)}
                          billCountry={countryId}
                          policyOptions={options}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              <BillFiscalImpactStrip
                countryId={countryId}
                rows={provisions.map((row) => {
                  const lt = legislationTypes.find((t) => t._id === row.legislationTypeId);
                  return {
                    lt,
                    currentIndex: currentPolicies[row.legislationTypeId],
                    proposedIndex: (lt?.policyOptions ?? []).findIndex(
                      (o) => o.id === row.policyOptionId
                    ),
                  };
                })}
              />
            </div>
          )}

          <div className="rounded-lg border border-card-border bg-card/50 px-3 py-2 text-xs text-muted">
            {adminOverride ? (
              <span>Cost waived (admin override)</span>
            ) : (
              <>
                <span>
                  Cost: {actionCost} actions + {npiCost} national influence · Voting: 48 hours
                </span>
                <span className="block mt-0.5 text-muted/80">
                  1st provision: 5 NPI; 2nd: 10; 3rd: 15. Refunded if bill passes.
                </span>
                {(nationalInfluence != null || actions != null) && (
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
              </>
            )}
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-card-border bg-card py-2 text-sm font-medium text-muted hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !canAfford}
              className={`flex-1 rounded-lg py-2 text-sm font-medium text-white transition-colors disabled:opacity-50 ${
                adminOverride ? "bg-error hover:bg-error/90" : "bg-primary hover:bg-primary/90"
              }`}
            >
              {loading ? "Proposing..." : "Propose Bill"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
