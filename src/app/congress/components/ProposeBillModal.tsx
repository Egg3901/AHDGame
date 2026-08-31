"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { ladderBounds } from "@/lib/legislature/policyLadder";
import { useToast } from "@/contexts/ToastContext";
import { reserveManpowerLabel } from "@/lib/military/manpower";
import {
  BILL_CATEGORIES,
  SUBSIDY_BILL_CATEGORIES,
  TARIFF_BILL_CATEGORIES,
  NATIONALIZATION_BILL_CATEGORIES,
  ELECTORAL_LAW_BILL_CATEGORIES,
  BILL_PROPOSE_ACTION_COST,
  getProvisionCostTotal,
  getProposableBillCategories,
  MAX_PROVISIONS,
} from "@shared/constants/legislation";
import type { BillCategory } from "@shared/constants/legislation";
import { getEconomicPositionName, getSocialPositionName } from "@/lib/utils/politics";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { formatLocalAmount } from "@/lib/utils/formatters";
import { PolicyEffectIndicators } from "@/components/legislation/PolicyEffectIndicators";
import { LawProvisionComparison } from "@/components/bills/LawProvisionComparison";
import { TaxRateSliderControl } from "@/components/legislation/TaxRateSliderControl";
import { TariffProvisionEditor } from "@/components/bills/TariffProvisionEditor";
import { EmbargoProvisionEditor } from "@/components/bills/EmbargoProvisionEditor";
import { SubsidySectorSelect } from "@/components/bills/SubsidySectorSelect";
import {
  NationalizationProvisionEditor,
  toNatPayload,
  validateNatRows,
  type NatProvisionInput,
} from "@/components/bills/NationalizationProvisionEditor";
import {
  BillAutoFailWarningBanner,
  postBillProposalWithElectionConfirmation,
} from "@/components/bills/BillAutoFailWarning";
import {
  toPayload as tariffToPayload,
  validateRows as validateTariffRows,
  type TariffProvisionInput,
} from "@/components/bills/tariffProvisionTypes";
import {
  toPayload as embargoToPayload,
  validateRows as validateEmbargoRows,
  type EmbargoProvisionInput,
} from "@/components/bills/embargoProvisionTypes";
import type { ChamberTab } from "./CongressConstants";
import type { CountryId } from "@/lib/constants/countries";
import { useEnabledCountryIds } from "@/lib/hooks/useEnabledCountryIds";
import { fetchJson } from "@/lib/observability/fetchJson";
import { formatCurrencyFaceAmount } from "@/lib/currency/formatCurrencyFaceAmount";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { BillProposalAutoFailWarning } from "@/lib/legislature/billAutoFailWarning";

interface LegislationPolicyOption {
  id: string;
  name: string;
  explanation?: string;
  stance: "left" | "center" | "right";
  effectDirection: -1 | 0 | 1;
  economic: number;
  social: number;
  /** @deprecated Use archetypeApprovals instead */
  groupApprovals?: Record<string, number>;
  archetypeApprovals?: Record<string, number>;
}

interface EffectTargetWeighted {
  metricCategoryId: string;
  metricId: string;
  weight: number;
}

interface LegislationTypeOption {
  _id: string;
  name: string;
  description: string;
  explanation?: string;
  policyDomain: string;
  subCategory: string;
  policyOptions?: LegislationPolicyOption[];
  effectTargetsWeighted?: EffectTargetWeighted[];
  /** Set by the era-gated legislation-types API for types unlocked this era. */
  eraNew?: boolean;
  /** Political-legislation v2 (spec §8): live per-level fiscal estimates. */
  estimates?: Array<{ level: number; cost: number; revenue: number; net: number }>;
  /** GDP at the priced scope — annotates cost deltas as %GDP. */
  estimatesGdp?: number;
  /** New-generation catalog laws: political-metric targets (registry family ids). */
  politicalMetricTargets?: { metricId: string; weight: number }[];
  /** Tax-slider laws (ruling #16): slider bounds + live rate + revenue delta. */
  taxSliderEstimate?: {
    minRate: number;
    maxRate: number;
    step: number;
    baselineRate: number;
    currentRate: number;
    waypoints: Array<{ rate: number; label: string }>;
    revenueDeltaPerPoint: number;
  };
}

/**
 * Inline notice for supplementary form loads (bill types, categories, balance,
 * current policies). These fetches used to fail silently, leaving selectors
 * empty with no explanation; this gives the player a message and a retry.
 */
function SupplementaryLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-2 rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-xs text-error"
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="shrink-0 font-medium underline underline-offset-2 hover:no-underline"
      >
        Try again
      </button>
    </div>
  );
}

export function ProposeBillModal({
  chamber,
  adminOverride,
  myChamber,
  countryId,
  blockedProvisions,
  proposalWarnings,
  hasActiveBill = false,
  onClose,
  onSuccess,
}: {
  chamber: ChamberTab;
  adminOverride?: boolean;
  myChamber?: "house" | "senate" | null;
  countryId: CountryId;
  blockedProvisions?: { legislationTypeId: string; policyOptionId: string }[];
  proposalWarnings?: Record<string, BillProposalAutoFailWarning | null>;
  /** Player already has a bill in voting — modal stays browsable, submit blocked. */
  hasActiveBill?: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { showToast } = useToast();
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [cat, setCat] = useState<string>(BILL_CATEGORIES[0]);
  // Use myChamber (the user's actual chamber) if available, otherwise fall back to activeTab
  const effectiveChamber = myChamber ?? chamber;
  const [billChamber, setBillChamber] = useState<"house" | "senate" | "joint">(effectiveChamber);
  const [legislationTypes, setLegislationTypes] = useState<LegislationTypeOption[]>([]);
  // All national legislation types for this country (category-agnostic), fetched
  // once to decide which categories to offer — hides categories the country has
  // no laws for (e.g. agriculture/technology in the US).
  const [allNationalTypes, setAllNationalTypes] = useState<{ policyDomain: string }[]>([]);
  const [provisions, setProvisions] = useState<
    {
      legislationTypeId: string;
      policyOptionId: string;
      effectDirection: number;
      economic: number;
      social: number;
      /** Tax-slider laws (ruling #16): slider-chosen rate. */
      proposedRate?: number;
    }[]
  >([
    {
      legislationTypeId: "",
      policyOptionId: "",
      effectDirection: 0,
      economic: 0,
      social: 0,
    },
  ]);
  const [nationalInfluence, setNationalInfluence] = useState<number | null>(null);
  const [projection, setProjection] = useState<{
    costAmount: number;
    pctOfGdp: number;
    currencyCode: CurrencyCode;
    warning: string | null;
  } | null>(null);
  const [currentPolicies, setCurrentPolicies] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Supplementary-load failures (issue #2792). Each has its own flag so a
  // failed side fetch shows an inline retry instead of silently degrading.
  const [typesError, setTypesError] = useState(false);
  const [categoriesError, setCategoriesError] = useState(false);
  const [budgetError, setBudgetError] = useState(false);
  const [policiesError, setPoliciesError] = useState(false);

  const isSubsidyCat = SUBSIDY_BILL_CATEGORIES.has(cat as BillCategory);
  const isTradeCat = TARIFF_BILL_CATEGORIES.has(cat as BillCategory);
  const isNatCat = NATIONALIZATION_BILL_CATEGORIES.has(cat as BillCategory);
  const isElectoralCat = ELECTORAL_LAW_BILL_CATEGORIES.has(cat as BillCategory);
  // Custom (flavor/roleplay) bills carry no provisions and have no in-game effect.
  const isCustomCat = cat === "custom";
  const [natRows, setNatRows] = useState<NatProvisionInput[]>([{ type: "nationalize" }]);

  const [tariffRows, setTariffRows] = useState<TariffProvisionInput[]>([
    { scopeType: "economy_wide", rate: 10 },
  ]);
  // Trade bills split into two provision families; the sub-type picks the builder.
  const [tradeSubType, setTradeSubType] = useState<"tariff" | "embargo">("tariff");
  const [embargoRows, setEmbargoRows] = useState<EmbargoProvisionInput[]>([
    { action: "embargo", targetCountry: "", commodity: "all", direction: "both", mode: "block" },
  ]);
  const enabledCountryIds = useEnabledCountryIds();

  // Build lookup set for blocked provision options (legislationTypeId:policyOptionId)
  const blockedProvisionKeys = new Set(
    (blockedProvisions ?? []).map((bp) => `${bp.legislationTypeId}:${bp.policyOptionId}`)
  );

  // Subsidy provisions (used when cat is "industry")
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
  // Union-law provision (v3 Phase 7b, industry category). Inclusion is an
  // explicit checkbox (code-review fix #15) — previously inferred from
  // `bias !== 0`, which made it impossible to ever legislate a RESET back to
  // neutral (bias=0 is a valid, meaningful explicit reset once a country has
  // a nonzero law in effect, not just "don't propose one").
  const [includeUnionLaw, setIncludeUnionLaw] = useState(false);
  const [unionLawBias, setUnionLawBias] = useState(0);
  // Electoral law — franchise and registration access. Two independent axes, so
  // each has its own include flag: a bill that only lowers the voting age must
  // not silently reset the registration regime the last law set.
  const [includeVotingAge, setIncludeVotingAge] = useState(false);
  const [votingAge, setVotingAge] = useState(18);
  const [includeRegAccess, setIncludeRegAccess] = useState(false);
  const [registrationAccess, setRegistrationAccess] = useState(0);
  // Union ban (player suggestion #93): "bias" = the slider law; "ban"/"repeal_ban"
  // are standalone actions that leave the bias untouched at enactment.
  const [unionLawAction, setUnionLawAction] = useState<"bias" | "ban" | "repeal_ban">("bias");

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const loadLegislationTypes = useCallback(() => {
    setTypesError(false);
    // Congress can only propose national-scope legislation (not state-level)
    fetch(
      `/api/game/legislation-types?category=${encodeURIComponent(cat)}&scope=national&country=${countryId.toLowerCase()}&nocache=1`,
      { cache: "no-store" }
    )
      .then((r) => {
        if (!r.ok) throw new Error(`legislation-types HTTP ${r.status}`);
        return r.json();
      })
      .then((list: LegislationTypeOption[]) => {
        setLegislationTypes(list || []);
        // Reset provisions when category changes to avoid stale type/policy references
        setProvisions([
          {
            legislationTypeId: "",
            policyOptionId: "",
            effectDirection: 0,
            economic: 0,
            social: 0,
          },
        ]);
      })
      .catch(() => {
        setLegislationTypes([]);
        setTypesError(true);
      });
  }, [cat, countryId]);

  useEffect(() => {
    loadLegislationTypes();
  }, [loadLegislationTypes]);

  const [actions, setActions] = useState<number | null>(null);

  // Category-agnostic national types → which categories the country can propose.
  const loadNationalTypes = useCallback(() => {
    setCategoriesError(false);
    fetchJson<{ policyDomain: string }[]>(
      `/api/game/legislation-types?scope=national&country=${countryId.toLowerCase()}&nocache=1`,
      { feature: "propose-bill-national-types" }
    )
      .then((list) => {
        if (Array.isArray(list)) setAllNationalTypes(list);
      })
      .catch(() => setCategoriesError(true));
  }, [countryId]);

  useEffect(() => {
    loadNationalTypes();
  }, [loadNationalTypes]);

  const availableCategories = useMemo(
    () => getProposableBillCategories(allNationalTypes),
    [allNationalTypes]
  );

  useEffect(() => {
    if (allNationalTypes.length > 0 && !(availableCategories as string[]).includes(cat)) {
      setCat(availableCategories[0] ?? BILL_CATEGORIES[0]);
    }
  }, [availableCategories, cat, allNationalTypes.length]);

  const loadBudget = useCallback(() => {
    setBudgetError(false);
    fetchJson<{
      user?: { character?: { nationalInfluence?: number; actions?: number } };
    }>("/api/auth/me", { cache: "no-store", feature: "propose-bill-me" })
      .then((data) => {
        setNationalInfluence(data?.user?.character?.nationalInfluence ?? null);
        setActions(data?.user?.character?.actions ?? null);
      })
      .catch(() => setBudgetError(true));
  }, []);

  useEffect(() => {
    loadBudget();
  }, [loadBudget]);

  // Fetch current federal policies for shift-based approval preview
  const loadCurrentPolicies = useCallback(() => {
    setPoliciesError(false);
    fetch("/api/game/current-policies?stateId=federal", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`current-policies HTTP ${r.status}`);
        return r.json();
      })
      .then((data: Record<string, number>) => setCurrentPolicies(data))
      .catch(() => {
        setCurrentPolicies({});
        setPoliciesError(true);
      });
  }, []);

  useEffect(() => {
    loadCurrentPolicies();
  }, [loadCurrentPolicies]);

  const provisionCountForInfluenceCost = isCustomCat
    ? 0 // Custom bills have no provisions
    : isTradeCat
      ? 0 // Tariffs do not cost NPI
      : isNatCat
        ? natRows.length
        : isSubsidyCat
          ? subsidyProvisions.length
          : provisions.length;
  const totalCost = getProvisionCostTotal(provisionCountForInfluenceCost);
  const canAffordNpi =
    adminOverride || nationalInfluence === null || nationalInfluence >= totalCost;
  const canAffordActions = adminOverride || actions === null || actions >= BILL_PROPOSE_ACTION_COST;
  const canAfford = canAffordNpi && canAffordActions;
  const selectedProposalWarning = proposalWarnings?.[billChamber] ?? null;

  // Live fiscal projection: the draft bill's annual budget cost. Debounced so
  // rapid provision edits don't hammer the estimate endpoint. Custom (flavor)
  // bills have no fiscal effect, so they clear the panel.
  const projectionProvisions = useMemo(
    () =>
      provisions
        .filter((p) => p.legislationTypeId.trim())
        .map((p) => ({
          legislationTypeId: p.legislationTypeId.trim(),
          policyOptionId: p.policyOptionId || undefined,
          effectDirection: p.effectDirection,
        })),
    [provisions]
  );
  const projectionKey = useMemo(() => JSON.stringify(projectionProvisions), [projectionProvisions]);
  useEffect(() => {
    if (isCustomCat || projectionProvisions.length === 0) {
      setProjection(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const data = await fetchJson<{
          costAmount: number;
          pctOfGdp: number;
          currencyCode: CurrencyCode;
          warning: string | null;
        }>("/api/congress/bills/estimate-cost", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ countryId, provisions: projectionProvisions }),
          feature: "propose-bill-estimate-cost",
        });
        if (!cancelled && data) {
          setProjection({
            costAmount: data.costAmount,
            pctOfGdp: data.pctOfGdp,
            currencyCode: data.currencyCode,
            warning: data.warning ?? null,
          });
        }
      } catch {
        if (!cancelled) setProjection(null);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // projectionKey captures the provision content; countryId/isCustomCat gate it.
  }, [projectionKey, countryId, isCustomCat, projectionProvisions]);

  function setProvision(
    index: number,
    patch: Partial<{
      legislationTypeId: string;
      policyOptionId: string;
      effectDirection: number;
      economic: number;
      social: number;
      proposedRate: number;
    }>
  ) {
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
      // Tax-slider laws start at the live current rate (submit stays disabled
      // until the player moves it at least one step).
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
      {
        legislationTypeId: "",
        policyOptionId: "",
        effectDirection: 0,
        economic: 0,
        social: 0,
      },
    ]);
  }

  function removeProvision(index: number) {
    if (provisions.length <= 1) return;
    setProvisions((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    let provisionPayload: unknown[];
    if (isCustomCat) {
      provisionPayload = [];
    } else if (isNatCat) {
      const err = validateNatRows(natRows);
      if (err) {
        setError(err);
        return;
      }
      provisionPayload = toNatPayload(natRows);
    } else if (isTradeCat) {
      if (tradeSubType === "embargo") {
        const err = validateEmbargoRows(embargoRows);
        if (err) {
          setError(err);
          return;
        }
        provisionPayload = embargoRows.map(embargoToPayload);
      } else {
        const err = validateTariffRows(tariffRows);
        if (err) {
          setError(err);
          return;
        }
        provisionPayload = tariffRows.map(tariffToPayload);
      }
    } else if (isSubsidyCat) {
      // Validate subsidy provisions
      const invalidSubsidy = subsidyProvisions.find(
        (p) => p.scopeType === "sector" && !p.targetSectorType.trim()
      );
      if (invalidSubsidy) {
        setError("Sector-scoped subsidy provisions require a target sector type.");
        return;
      }
      provisionPayload = subsidyProvisions.map((p) => ({
        type: p.type,
        scopeType: p.scopeType,
        ...(p.scopeType === "sector" && p.targetSectorType
          ? { targetSectorType: p.targetSectorType }
          : {}),
        ...(p.targetStrategyId.trim() ? { targetStrategyId: p.targetStrategyId.trim() } : {}),
        ...(p.type === "subsidy" ? { domesticOnly: p.domesticOnly } : {}),
      }));
      if (includeUnionLaw) {
        provisionPayload.push({
          type: "union_law",
          bias: unionLawAction === "bias" ? unionLawBias : 0,
          ...(unionLawAction !== "bias" ? { banAction: unionLawAction } : {}),
        });
      }
    } else {
      const valid = provisions.every((p) => p.legislationTypeId.trim());
      if (!valid) {
        setError("Each provision must have a legislation type selected.");
        return;
      }
      // Tax-slider provisions must move the rate at least one step (ruling #16;
      // the server re-validates against the live rate).
      for (const p of provisions) {
        const slider = legislationTypes.find(
          (t) => t._id === p.legislationTypeId
        )?.taxSliderEstimate;
        if (!slider) continue;
        const proposed = p.proposedRate ?? slider.currentRate;
        if (Math.abs(proposed - slider.currentRate) < slider.step - 1e-9) {
          setError(`Tax proposals must change the rate by at least ${slider.step}.`);
          return;
        }
      }
      if (!canAffordActions) {
        setError(
          `Proposing a bill costs ${BILL_PROPOSE_ACTION_COST} action points (you have ${actions ?? 0}).`
        );
        setLoading(false);
        return;
      }
      if (!canAffordNpi && totalCost > 0) {
        setError(
          `This bill costs ${totalCost} national political influence (you have ${nationalInfluence?.toFixed(0) ?? 0}).`
        );
        return;
      }
      provisionPayload = provisions.map((p) => ({
        legislationTypeId: p.legislationTypeId.trim(),
        policyOptionId: p.policyOptionId || undefined,
        effectDirection: p.effectDirection,
        economic: p.economic,
        social: p.social,
        ...(p.proposedRate !== undefined && { proposedRate: p.proposedRate }),
      }));
      // Electoral law rides alongside the policy provisions of a social bill.
      // Each axis is opt-in separately so a franchise bill does not silently
      // reset the registration regime — the server enforces the same rule.
      if (isElectoralCat && (includeVotingAge || includeRegAccess)) {
        provisionPayload.push({
          type: "electoral_law",
          ...(includeVotingAge ? { votingAge } : {}),
          ...(includeRegAccess ? { registrationAccess } : {}),
        });
      }
    }

    setLoading(true);
    try {
      const body = {
        title: title.trim(),
        summary: summary.trim(),
        chamber: billChamber,
        category: cat,
        provisions: provisionPayload,
      };
      const {
        response: res,
        data,
        cancelled,
      } = await postBillProposalWithElectionConfirmation({
        url: "/api/congress/bills",
        body,
      });
      if (cancelled) {
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "Failed to propose bill");
        return;
      }
      showToast("Bill proposed — voting is now open.");
      onSuccess();
      onClose();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto py-8">
      <div
        className="w-full max-w-lg rounded-2xl border border-card-border bg-card p-6 space-y-5 shadow-modal my-auto"
        role="dialog"
        aria-modal="true"
        aria-label="Propose a bill"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Propose Legislation</h2>
          <button
            type="button"
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
          <div
            role="alert"
            className="rounded-lg border border-error/30 bg-error/10 px-4 py-2 text-sm text-error"
          >
            {error}
          </div>
        )}

        {selectedProposalWarning && <BillAutoFailWarningBanner warning={selectedProposalWarning} />}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="bill-title" className="block text-xs text-muted mb-1">
              Bill Title
            </label>
            <input
              id="bill-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Infrastructure Investment Act"
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              required
            />
          </div>
          <div>
            <label htmlFor="bill-summary" className="block text-xs text-muted mb-1">
              Summary
            </label>
            <textarea
              id="bill-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Brief description of what this bill does..."
              rows={3}
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="bill-category" className="block text-xs text-muted mb-1">
                Category
              </label>
              <select
                id="bill-category"
                value={cat}
                onChange={(e) => setCat(e.target.value)}
                className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm capitalize"
                required
              >
                {availableCategories.map((c) => (
                  <option key={c} value={c} className="capitalize">
                    {c}
                  </option>
                ))}
              </select>
              {categoriesError && (
                <div className="mt-1">
                  <SupplementaryLoadError
                    message="Failed to load bill categories."
                    onRetry={loadNationalTypes}
                  />
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Originating Chamber</label>
              <select
                value={billChamber}
                onChange={(e) => setBillChamber(e.target.value as "house" | "senate" | "joint")}
                className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
                disabled={!adminOverride && !!myChamber}
              >
                {/* Non-admins can only propose to their chamber or joint */}
                {(adminOverride || !myChamber || myChamber === "house") && (
                  <option value="house">House</option>
                )}
                {(adminOverride || !myChamber || myChamber === "senate") && (
                  <option value="senate">Senate</option>
                )}
                <option value="joint">Joint</option>
              </select>
              {!adminOverride && myChamber && (
                <p className="text-[10px] text-muted mt-1">
                  As a {myChamber === "house" ? "Representative" : "Senator"}, you can propose{" "}
                  {myChamber === "house" ? "House" : "Senate"} or Joint bills.
                </p>
              )}
            </div>
          </div>

          <div>
            {isCustomCat ? (
              /* ── Custom (flavor) bill: no provisions, no in-game effect ── */
              <p className="rounded-lg border border-card-border bg-card/50 px-3 py-2 text-xs text-muted">
                Custom bills have no in-game effect — for flavor / roleplay only. Just give it a
                title and summary.
              </p>
            ) : isNatCat ? (
              /* ── State-ownership (nationalization) provision editor ── */
              <NationalizationProvisionEditor
                countryCode={countryId}
                value={natRows}
                onChange={setNatRows}
              />
            ) : isTradeCat ? (
              /* ── Trade restriction editor: tariff or embargo ── */
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs text-muted">Restriction Type</label>
                  <div
                    role="tablist"
                    aria-label="Trade restriction type"
                    className="inline-flex rounded-lg border border-card-border bg-card p-1"
                  >
                    {(["tariff", "embargo"] as const).map((st) => (
                      <button
                        key={st}
                        type="button"
                        role="tab"
                        aria-selected={tradeSubType === st}
                        onClick={() => setTradeSubType(st)}
                        className={`rounded-md px-4 py-1.5 text-sm font-semibold capitalize transition-colors ${
                          tradeSubType === st
                            ? "bg-primary/15 text-foreground"
                            : "text-muted hover:text-foreground"
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                </div>
                {tradeSubType === "embargo" ? (
                  <EmbargoProvisionEditor
                    value={embargoRows}
                    onChange={setEmbargoRows}
                    countryId={countryId}
                    enabledCountryIds={enabledCountryIds}
                  />
                ) : (
                  <TariffProvisionEditor
                    value={tariffRows}
                    onChange={setTariffRows}
                    countryId={countryId}
                    enabledCountryIds={enabledCountryIds}
                  />
                )}
              </div>
            ) : isSubsidyCat ? (
              /* ── Subsidy provision builder ── */
              <div className="space-y-3">
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
                {subsidyProvisions.map((sp, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-card-border bg-background/50 p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
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
                        className="flex-1 rounded-lg border border-card-border bg-background px-2 py-1.5 text-sm"
                      >
                        <option value="subsidy">Grant Subsidy</option>
                        <option value="end_subsidy">End Subsidy</option>
                      </select>
                      {subsidyProvisions.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setSubsidyProvisions((prev) => prev.filter((_, j) => j !== i))
                          }
                          className="text-muted hover:text-red-400 text-xs"
                        >
                          Remove
                        </button>
                      )}
                    </div>
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
                      className="w-full rounded-lg border border-card-border bg-background px-2 py-1.5 text-sm"
                    >
                      <option value="economy_wide">Economy-wide</option>
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
                        className="w-full rounded-lg border border-card-border bg-background px-2 py-1.5 text-sm"
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
                      className="w-full rounded-lg border border-card-border bg-background px-2 py-1.5 text-sm"
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
                        <span className="text-muted text-xs">Domestic corporations only</span>
                      </label>
                    )}
                    {sp.type === "subsidy" && (
                      <p className="text-xs text-emerald-400/80">
                        +7.5% profit margin to qualifying sectors
                      </p>
                    )}
                  </div>
                ))}

                {/* Union-law provision (v3 Phase 7b) — optional, additive to subsidy provisions above. Explicit checkbox controls inclusion (code-review fix #15) so bias=0 can be a real, legislatable reset to neutral. */}
                <div className="rounded-lg border border-dashed border-purple-500/35 bg-purple-500/5 p-3 space-y-2">
                  <label className="flex items-center gap-2 text-xs font-medium text-muted cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeUnionLaw}
                      onChange={(e) => setIncludeUnionLaw(e.target.checked)}
                      className="rounded"
                    />
                    Include union-law provision
                  </label>
                  {/* Union ban (player suggestion #93): bias law vs ban/repeal action. */}
                  <select
                    value={unionLawAction}
                    disabled={!includeUnionLaw}
                    onChange={(e) =>
                      setUnionLawAction(e.target.value as "bias" | "ban" | "repeal_ban")
                    }
                    className="w-full rounded-md border border-card-border bg-card-elevated px-2 py-1.5 text-xs disabled:opacity-40"
                  >
                    <option value="bias">Set union-law bias (slider)</option>
                    <option value="ban">Ban unions nationally</option>
                    <option value="repeal_ban">Repeal the union ban</option>
                  </select>
                  <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted/70">
                    <span>← Right-to-work</span>
                    <span>Neutral (0)</span>
                    <span>Collective bargaining →</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      id="union-law-bias"
                      type="range"
                      min={-50}
                      max={50}
                      step={1}
                      value={unionLawBias}
                      disabled={!includeUnionLaw || unionLawAction !== "bias"}
                      onInput={(e) => setUnionLawBias(Number((e.target as HTMLInputElement).value))}
                      className="flex-1 accent-purple-500 disabled:opacity-40"
                    />
                    <span className="min-w-[64px] rounded-md border border-card-border bg-card-elevated px-2 py-1 text-right font-mono text-xs">
                      {unionLawBias}
                    </span>
                  </div>
                  <p className="text-[11px] italic text-muted/60">
                    {!includeUnionLaw
                      ? "No union-law provision will be included in this bill."
                      : unionLawAction === "ban"
                        ? "Outlaws unions nationally — player unions suspend, unionization decays to zero, and strikes end. Existing bias is preserved for a future repeal."
                        : unionLawAction === "repeal_ban"
                          ? "Lifts the national union ban — suspended unions and normal unionization drift resume."
                          : unionLawBias === 0
                            ? "Explicit reset to neutral — clears any existing union-law bias."
                            : unionLawBias > 0
                              ? `Collective-bargaining strength +${unionLawBias} — biases unionization upward nationally.`
                              : `Right-to-work strength ${unionLawBias} — biases unionization downward nationally.`}
                  </p>
                </div>
              </div>
            ) : (
              <>
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
                {typesError && (
                  <div className="mb-2">
                    <SupplementaryLoadError
                      message="Failed to load bill types for this category."
                      onRetry={loadLegislationTypes}
                    />
                  </div>
                )}
                {policiesError && (
                  <div className="mb-2">
                    <SupplementaryLoadError
                      message="Failed to load current policy levels. Approval previews may be off."
                      onRetry={loadCurrentPolicies}
                    />
                  </div>
                )}
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
                              className="text-xs text-red-400 hover:underline"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                        <div className="grid grid-cols-1 gap-2">
                          <select
                            value={p.legislationTypeId}
                            onChange={(e) => {
                              const id = e.target.value;
                              setProvision(i, {
                                legislationTypeId: id,
                                policyOptionId: "",
                                effectDirection: 0,
                              });
                            }}
                            className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
                            required
                          >
                            <option value="">Select type…</option>
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
                              currencyCode={COUNTRY_CURRENCY_MAP[countryId]}
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
                                    econ !== 0 && `${getEconomicPositionName(econ)} econ`,
                                    soc !== 0 && `${getSocialPositionName(soc)} social`,
                                  ]
                                    .filter(Boolean)
                                    .join(", ");
                                  const estimate = type?.estimates?.[optIdx];
                                  const netLabel =
                                    estimate && (estimate.cost !== 0 || estimate.revenue !== 0)
                                      ? ` · net ${formatLocalAmount(estimate.net, COUNTRY_CURRENCY_MAP[countryId])}/yr`
                                      : "";
                                  // Reserve-forces laws set the nation's replacement manpower:
                                  // show each level's effect on the pool before the bill is filed.
                                  const manpowerLabel = reserveManpowerLabel(
                                    countryId,
                                    p.legislationTypeId,
                                    optIdx,
                                    type?.countryScope
                                  );
                                  const suffix =
                                    (posLabel ? ` — ${posLabel}` : "") + netLabel + manpowerLabel;
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
                                      {suffix}
                                      {disableReason}
                                    </option>
                                  );
                                })}
                              </select>
                            ) : (
                              <select
                                value={p.effectDirection}
                                onChange={(e) =>
                                  setProvision(i, {
                                    effectDirection: Number(e.target.value),
                                  })
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
                              // New-gen catalog laws: flavor line + selected level's
                              // explanation stacked. Legacy: winner-takes-all line.
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
                        {/* New-gen laws: Current law → Proposed comparison with
                            per-level fiscal estimates + metric deltas vs enacted. */}
                        {p.legislationTypeId && type && (
                          <div className="pt-2">
                            <LawProvisionComparison
                              countryId={countryId}
                              lt={type}
                              currentIndex={currentPolicies[p.legislationTypeId]}
                              proposedIndex={options.findIndex((o) => o.id === p.policyOptionId)}
                            />
                          </div>
                        )}
                        {/* Effect indicators — tax-slider laws skip the archetype
                            panel; approval flows through metrics/economy channels. */}
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
                            currentPolicyIndex={
                              currentPolicies[p.legislationTypeId] ??
                              ladderBounds(options.length).centerIndex
                            }
                            proposedPolicyIndex={options.findIndex(
                              (o) => o.id === p.policyOptionId
                            )}
                            policyOptions={options}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
                {/* Electoral law — social bills only. Two independent axes, each
                    with its own checkbox: an electoral bill that touches one must
                    not silently reset the other, which is the rule the server
                    enforces too. */}
                {isElectoralCat && (
                  <div className="mt-3 rounded-lg border border-dashed border-sky-500/35 bg-sky-500/5 p-3 space-y-3">
                    <p className="text-xs font-medium text-muted">Electoral law (optional)</p>

                    <div className="space-y-1.5">
                      <label className="flex items-center gap-2 text-xs text-muted cursor-pointer">
                        <input
                          type="checkbox"
                          checked={includeVotingAge}
                          onChange={(e) => setIncludeVotingAge(e.target.checked)}
                          className="rounded"
                        />
                        Set the voting age
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={16}
                          max={25}
                          step={1}
                          value={votingAge}
                          disabled={!includeVotingAge}
                          onInput={(e) =>
                            setVotingAge(Number((e.target as HTMLInputElement).value))
                          }
                          className="flex-1 accent-sky-500 disabled:opacity-40"
                        />
                        <span className="min-w-[48px] rounded-md border border-card-border bg-card-elevated px-2 py-1 text-right font-mono text-xs">
                          {votingAge}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="flex items-center gap-2 text-xs text-muted cursor-pointer">
                        <input
                          type="checkbox"
                          checked={includeRegAccess}
                          onChange={(e) => setIncludeRegAccess(e.target.checked)}
                          className="rounded"
                        />
                        Set registration access
                      </label>
                      <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted/70">
                        <span>&larr; Restricted</span>
                        <span>Neutral (0)</span>
                        <span>Automatic &rarr;</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={-50}
                          max={50}
                          step={1}
                          value={registrationAccess}
                          disabled={!includeRegAccess}
                          onInput={(e) =>
                            setRegistrationAccess(Number((e.target as HTMLInputElement).value))
                          }
                          className="flex-1 accent-sky-500 disabled:opacity-40"
                        />
                        <span className="min-w-[48px] rounded-md border border-card-border bg-card-elevated px-2 py-1 text-right font-mono text-xs">
                          {registrationAccess}
                        </span>
                      </div>
                    </div>

                    <p className="text-[11px] italic text-muted/60">
                      {!includeVotingAge && !includeRegAccess
                        ? "No electoral-law provision will be included in this bill."
                        : [
                            includeVotingAge ? `Voting age set to ${votingAge}.` : null,
                            includeRegAccess
                              ? registrationAccess === 0
                                ? "Registration access reset to neutral."
                                : registrationAccess > 0
                                  ? `Registration access +${registrationAccess} — voters reach the rolls faster and fewer lapse.`
                                  : `Registration access ${registrationAccess} — the rolls grow slower and lapse faster.`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" ")}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="rounded-lg border border-card-border bg-card/50 px-3 py-2 text-xs text-muted">
            {adminOverride ? (
              <span>Cost waived (admin).</span>
            ) : (
              <>
                <span>
                  Cost: {BILL_PROPOSE_ACTION_COST} actions + {totalCost} national influence
                </span>
                <span className="block mt-0.5 text-muted/80">
                  1st provision: 5 NPI; 2nd: 10; 3rd: 15. Refunded if bill passes.
                </span>
                {projection && projection.costAmount > 0 && (
                  <span className="mt-2 block border-t border-card-border pt-2">
                    <span className="block font-medium text-foreground">
                      Projected annual cost:{" "}
                      {formatCurrencyFaceAmount(projection.costAmount, projection.currencyCode)}{" "}
                      <span className="text-muted/80">
                        ({projection.pctOfGdp.toFixed(1)}% of GDP)
                      </span>
                    </span>
                    {projection.warning === "DEBT_CEILING_EXCEEDED" && (
                      <span className="mt-0.5 block text-red-400">
                        Warning: this would push the budget past its debt ceiling.
                      </span>
                    )}
                    {projection.warning === "HIGH_DEBT" && (
                      <span className="mt-0.5 block text-amber-400">
                        Note: this country is already carrying high debt.
                      </span>
                    )}
                  </span>
                )}
                {(nationalInfluence != null || actions != null) && (
                  <span className="block mt-0.5">
                    Balance: {actions ?? "?"} actions, {nationalInfluence?.toFixed(0) ?? "?"} NPI
                  </span>
                )}
                {!canAffordActions && (
                  <p className="text-error text-xs mt-1">
                    Not enough action points ({actions ?? 0}/{BILL_PROPOSE_ACTION_COST}).
                  </p>
                )}
                {totalCost > 0 && nationalInfluence != null && nationalInfluence < totalCost && (
                  <span className="block mt-1 text-red-400">
                    Not enough national political influence for this many provisions.
                  </span>
                )}
                {budgetError && (
                  <div className="mt-1">
                    <SupplementaryLoadError
                      message="Failed to load your action and influence balance."
                      onRetry={loadBudget}
                    />
                  </div>
                )}
              </>
            )}
          </div>

          {hasActiveBill && !adminOverride && (
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              You already have a bill being voted on — it must resolve before you can propose
              another.
            </div>
          )}
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
              disabled={loading || !canAfford || (hasActiveBill && !adminOverride)}
              className="flex-1 rounded-lg bg-primary py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {loading ? "Proposing…" : "Propose Bill"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
