"use client";

import { useState, useEffect, useMemo } from "react";
import { Slider } from "@/components/ui";
import { useToast } from "@/contexts/ToastContext";
import {
  BILL_CATEGORIES,
  BILL_PROPOSE_ACTION_COST,
  CATEGORY_TO_POLICY_DOMAINS,
  MAX_PROVISIONS,
  NATIONALIZATION_BILL_CATEGORIES,
  ELECTORAL_LAW_BILL_CATEGORIES,
  CENTRAL_BANK_INDEPENDENCE_BILL_CATEGORIES,
  SUBSIDY_BILL_CATEGORIES,
  TARIFF_BILL_CATEGORIES,
  getProvisionCostTotal,
  getProposableBillCategories,
} from "@shared/constants/legislation";
import type { BillCategory } from "@shared/constants/legislation";
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
import { legislatureApiUrl } from "@/lib/urls";
import { PolicyEffectIndicators } from "@/components/legislation/PolicyEffectIndicators";
import {
  BillFiscalImpactStrip,
  LawProvisionComparison,
} from "@/components/bills/LawProvisionComparison";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { getNationalStateId } from "@/lib/policy/nationalStateId";
import { TaxRateSliderControl } from "@/components/legislation/TaxRateSliderControl";
import { useEnabledCountryIds } from "@/lib/hooks/useEnabledCountryIds";
import type { BillProposalAutoFailWarning } from "@/lib/legislature/billAutoFailWarning";
import { fetchJson } from "@/lib/observability/fetchJson";

interface LegislationTypeOption {
  _id: string;
  name: string;
  /** Set by the era-gated legislation-types API for types unlocked this era. */
  eraNew?: boolean;
  description?: string;
  explanation?: string;
  policyDomain: string;
  effectTargetsWeighted?: { metricCategoryId: string; metricId: string; weight: number }[];
  policyOptions?: {
    id: string;
    name: string;
    explanation?: string;
    effectDirection: number;
    economic?: number;
    social?: number;
    archetypeApprovals?: Record<string, number>;
    groupApprovals?: Record<string, number>;
  }[];
  /** New-generation catalog laws (US/UK/RU/DD): API-attached per-level fiscal estimates. */
  estimates?: { level: number; cost: number; revenue: number; net: number }[];
  /** GDP at the priced scope — annotates cost deltas as %GDP. */
  estimatesGdp?: number;
  /** New-generation catalog laws: political-metric targets (registry family ids). */
  politicalMetricTargets?: { metricId: string; weight: number }[];
  /** New-generation tax laws: API-attached live slider state (rate range + current rate). */
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

interface ProvisionRow {
  legislationTypeId: string;
  policyOptionId: string;
  effectDirection: number;
  economic: number;
  social: number;
  proposedRate?: number;
}

const EMPTY_PROVISION_ROW: ProvisionRow = {
  legislationTypeId: "",
  policyOptionId: "",
  effectDirection: 0,
  economic: 0,
  social: 0,
};

export interface ProposeChamberOption {
  value: string;
  label: string;
}

const EMPTY_SUBSIDY = {
  type: "subsidy" as "subsidy" | "end_subsidy",
  scopeType: "economy_wide" as "economy_wide" | "sector",
  targetSectorType: "",
  targetStrategyId: "",
  domesticOnly: false,
};

/**
 * Unified "Propose Legislation" modal for the country legislatures (UK, DE, JP,
 * IE, CN). Generalises the formerly-duplicated per-country modals: the body,
 * fetches, provision/tariff/subsidy builders, cost ledger and submit flow are
 * identical; per-country differences come in through config props:
 *   - `chambers`      — originating-chamber options (JP selects Shūgiin/Sangiin;
 *                       single-chamber legislatures pass one, rendered fixed)
 *   - `domesticOnlyLabel` — wording of the subsidy "domestic corporations only" toggle
 *   - `proposalWarning` / `proposalWarnings` — single or per-chamber auto-fail warning
 * Submits to `${legislatureApiUrl(countryId)}/bills`.
 */
export function ProposeLegislationModal({
  countryId,
  adminOverride = false,
  blockedProvisions,
  proposalWarning,
  proposalWarnings,
  chambers,
  defaultChamber,
  domesticOnlyLabel = "Domestic corporations only",
  hasActiveBill = false,
  onClose,
  onSuccess,
}: {
  countryId: CountryId;
  adminOverride?: boolean;
  blockedProvisions?: { legislationTypeId: string; policyOptionId: string }[];
  proposalWarning?: BillProposalAutoFailWarning | null;
  proposalWarnings?: Record<string, BillProposalAutoFailWarning | null>;
  chambers: ProposeChamberOption[];
  defaultChamber?: string;
  domesticOnlyLabel?: string;
  /** Player already has a bill in voting — modal stays browsable, submit blocked. */
  hasActiveBill?: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { showToast } = useToast();
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [cat, setCat] = useState(BILL_CATEGORIES[0] as string);
  const [billChamber, setBillChamber] = useState<string>(
    defaultChamber ?? chambers[0]?.value ?? ""
  );
  const [legislationTypes, setLegislationTypes] = useState<LegislationTypeOption[]>([]);
  const [rows, setRows] = useState<ProvisionRow[]>([{ ...EMPTY_PROVISION_ROW }]);
  const [submitting, setSubmitting] = useState(false);
  const [currentPolicies, setCurrentPolicies] = useState<Record<string, number>>({});
  const [tariffRows, setTariffRows] = useState<TariffProvisionInput[]>([
    { scopeType: "economy_wide", rate: 10 },
  ]);
  // Trade bills split into two provision families; the sub-type picks the builder.
  const [tradeSubType, setTradeSubType] = useState<"tariff" | "embargo">("tariff");
  const [embargoRows, setEmbargoRows] = useState<EmbargoProvisionInput[]>([
    { action: "embargo", targetCountry: "", commodity: "all", direction: "both", mode: "block" },
  ]);
  const enabledCountryIds = useEnabledCountryIds();

  const isTradeCat = TARIFF_BILL_CATEGORIES.has(cat as BillCategory);
  const isSubsidyCat = SUBSIDY_BILL_CATEGORIES.has(cat as BillCategory);
  const isNatCat = NATIONALIZATION_BILL_CATEGORIES.has(cat as BillCategory);
  const isElectoralCat = ELECTORAL_LAW_BILL_CATEGORIES.has(cat as BillCategory);
  const isCentralBankCat = CENTRAL_BANK_INDEPENDENCE_BILL_CATEGORIES.has(cat as BillCategory);
  // Custom (flavor/roleplay) bills carry no provisions and have no in-game effect.
  const isCustomCat = cat === "custom";
  const [natRows, setNatRows] = useState<NatProvisionInput[]>([{ type: "nationalize" }]);

  const [subsidyProvisions, setSubsidyProvisions] = useState([{ ...EMPTY_SUBSIDY }]);
  // Union-law provision (v3 Phase 7b, industry category). Inclusion is an
  // explicit checkbox (code-review fix #15) — bias=0 is a valid, legislatable
  // reset to neutral, not just "don't propose one" (see ProposeBillModal.tsx).
  const [includeUnionLaw, setIncludeUnionLaw] = useState(false);
  const [unionLawBias, setUnionLawBias] = useState(0);
  // Electoral law — franchise and registration access, each opt-in separately so
  // a bill touching one axis does not silently reset the other.
  const [includeVotingAge, setIncludeVotingAge] = useState(false);
  const [votingAge, setVotingAge] = useState(18);
  const [includeRegAccess, setIncludeRegAccess] = useState(false);
  const [registrationAccess, setRegistrationAccess] = useState(0);
  // Central bank independence — opt-in, economy category. grant hands
  // rate-setting to the bank; revoke returns it to the government.
  const [includeCbIndependence, setIncludeCbIndependence] = useState(false);
  const [cbIndependenceAction, setCbIndependenceAction] = useState<"grant" | "revoke">("grant");
  // Union ban (player suggestion #93): "bias" = the slider law; "ban"/"repeal_ban"
  // are standalone actions that leave the bias untouched at enactment.
  const [unionLawAction, setUnionLawAction] = useState<"bias" | "ban" | "repeal_ban">("bias");

  const blockedProvisionKeys = new Set(
    (blockedProvisions ?? []).map((bp) => `${bp.legislationTypeId}:${bp.policyOptionId}`)
  );

  const selectedProposalWarning = proposalWarnings?.[billChamber] ?? proposalWarning ?? null;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    fetchJson<LegislationTypeOption[]>(
      `/api/game/legislation-types?scope=national&country=${countryId.toLowerCase()}&nocache=1`,
      { feature: "propose-legislation-types" }
    )
      .then((types) => {
        if (Array.isArray(types)) setLegislationTypes(types);
      })
      .catch(() => {});
  }, [countryId]);

  useEffect(() => {
    // SSOT for the national policy-store id — RU stores under su_national,
    // US under federal; a raw `${cc}_national` template reads an id nothing
    // writes, so the "(current law)" markers silently vanish.
    const policyStoreId = getNationalStateId(countryId);
    fetch(`/api/game/current-policies?stateId=${encodeURIComponent(policyStoreId)}`, {
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : {}))
      .then((data: Record<string, number>) => setCurrentPolicies(data))
      .catch(() => setCurrentPolicies({}));
  }, [countryId]);

  const allowedDomains: string[] =
    (CATEGORY_TO_POLICY_DOMAINS as Record<string, string[]>)[cat] ?? [];
  const filteredTypes = legislationTypes.filter((lt) => allowedDomains.includes(lt.policyDomain));

  // Only offer categories this country actually has laws for. Trade/industry
  // always qualify (own builders); policy categories require a matching
  // legislation type — so e.g. agriculture/technology are hidden for countries
  // without those laws (UK/US) but shown where they exist (JP/DE/CN).
  const availableCategories = useMemo(
    () => getProposableBillCategories(legislationTypes),
    [legislationTypes]
  );

  // If the current category became unavailable once types loaded, fall back to
  // the first available one so the form never sits on a hidden category.
  useEffect(() => {
    if (legislationTypes.length > 0 && !(availableCategories as string[]).includes(cat)) {
      handleCategoryChange(availableCategories[0] ?? BILL_CATEGORIES[0]);
    }
  }, [availableCategories, cat, legislationTypes.length]);

  function handleCategoryChange(nextCat: string) {
    setCat(nextCat);
    setRows([{ ...EMPTY_PROVISION_ROW }]);
    setSubsidyProvisions([{ ...EMPTY_SUBSIDY }]);
  }

  function updateRow(index: number, patch: Partial<ProvisionRow>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function addRow() {
    if (rows.length >= MAX_PROVISIONS) return;
    setRows((prev) => [...prev, { ...EMPTY_PROVISION_ROW }]);
  }

  function removeRow(index: number) {
    if (rows.length <= 1) return;
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !summary.trim()) {
      showToast("Title and summary are required.", "error");
      return;
    }

    let provisionsPayload: unknown[];
    if (isCustomCat) {
      provisionsPayload = [];
    } else if (isNatCat) {
      const err = validateNatRows(natRows);
      if (err) {
        showToast(err, "error");
        return;
      }
      provisionsPayload = toNatPayload(natRows);
    } else if (isTradeCat) {
      if (tradeSubType === "embargo") {
        const err = validateEmbargoRows(embargoRows);
        if (err) {
          showToast(err, "error");
          return;
        }
        provisionsPayload = embargoRows.map(embargoToPayload);
      } else {
        const err = validateTariffRows(tariffRows);
        if (err) {
          showToast(err, "error");
          return;
        }
        provisionsPayload = tariffRows.map(tariffToPayload);
      }
    } else if (isSubsidyCat) {
      const invalid = subsidyProvisions.find(
        (p) => p.scopeType === "sector" && !p.targetSectorType.trim()
      );
      if (invalid) {
        showToast("Sector-scoped subsidy provisions require a target sector type.", "error");
        return;
      }
      provisionsPayload = subsidyProvisions.map((p) => ({
        type: p.type,
        scopeType: p.scopeType,
        ...(p.scopeType === "sector" && p.targetSectorType
          ? { targetSectorType: p.targetSectorType }
          : {}),
        ...(p.targetStrategyId.trim() ? { targetStrategyId: p.targetStrategyId.trim() } : {}),
        ...(p.type === "subsidy" ? { domesticOnly: p.domesticOnly } : {}),
      }));
      if (includeUnionLaw) {
        provisionsPayload.push({
          type: "union_law",
          bias: unionLawAction === "bias" ? unionLawBias : 0,
          ...(unionLawAction !== "bias" ? { banAction: unionLawAction } : {}),
        });
      }
    } else {
      if (rows.some((r) => !r.legislationTypeId)) {
        showToast("Every provision needs a policy type.", "error");
        return;
      }
      for (const r of rows) {
        const lt = legislationTypes.find((t) => t._id === r.legislationTypeId);
        if (lt?.policyOptions?.length && !r.policyOptionId) {
          showToast("Every provision needs a policy option selected.", "error");
          return;
        }
        // Tax-slider provisions must move the rate at least one step (the
        // server re-validates against the live rate).
        const slider = lt?.taxSliderEstimate;
        if (slider) {
          const proposed = r.proposedRate ?? slider.currentRate;
          if (Math.abs(proposed - slider.currentRate) < slider.step - 1e-9) {
            showToast(`Tax proposals must change the rate by at least ${slider.step}.`, "error");
            return;
          }
        }
      }
      provisionsPayload = rows.map((r) => ({
        legislationTypeId: r.legislationTypeId,
        ...(r.policyOptionId ? { policyOptionId: r.policyOptionId } : {}),
        effectDirection: r.effectDirection,
        economic: r.economic,
        social: r.social,
        ...(r.proposedRate !== undefined ? { proposedRate: r.proposedRate } : {}),
      }));
      if (isElectoralCat && (includeVotingAge || includeRegAccess)) {
        provisionsPayload.push({
          type: "electoral_law",
          ...(includeVotingAge ? { votingAge } : {}),
          ...(includeRegAccess ? { registrationAccess } : {}),
        });
      }
      if (isCentralBankCat && includeCbIndependence) {
        provisionsPayload.push({
          type: "central_bank_independence",
          action: cbIndependenceAction,
        });
      }
    }

    setSubmitting(true);
    try {
      const {
        response: res,
        data,
        cancelled,
      } = await postBillProposalWithElectionConfirmation({
        url: `${legislatureApiUrl(countryId)}/bills`,
        body: {
          title: title.trim(),
          summary: summary.trim(),
          chamber: billChamber,
          category: cat,
          provisions: provisionsPayload,
        },
      });
      if (cancelled) {
        return;
      }
      if (!res.ok) {
        showToast(data.error ?? "Failed to propose bill.", "error");
      } else {
        showToast("Bill proposed and opened for voting.", "success");
        onSuccess();
      }
    } catch {
      showToast("Network error. Please try again.", "error");
    } finally {
      setSubmitting(false);
    }
  }

  const npiCost = getProvisionCostTotal(
    isCustomCat
      ? 0
      : isTradeCat
        ? 0
        : isNatCat
          ? natRows.length
          : isSubsidyCat
            ? subsidyProvisions.length
            : rows.length
  );
  const submitBlockedByActiveBill = hasActiveBill && !adminOverride;
  const submitDisabled =
    submitBlockedByActiveBill ||
    submitting ||
    !title.trim() ||
    !summary.trim() ||
    // Custom (flavor) bills carry no provisions, so the default empty provision
    // row must not gate submission (#910 — Propose button dead for custom bills).
    (!isCustomCat &&
      !isTradeCat &&
      !isSubsidyCat &&
      !isNatCat &&
      rows.some((r) => !r.legislationTypeId));

  const chamberSelectable = chambers.length > 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4 py-8">
      <div className="my-auto w-full max-w-lg space-y-5 rounded-2xl border border-card-border bg-card p-6 shadow-modal">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold">Propose Legislation</h2>
            <p className="text-xs text-muted">
              Costs {BILL_PROPOSE_ACTION_COST} action points and {npiCost} national influence.
            </p>
          </div>
          {adminOverride && (
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium text-warning">
              Admin
            </span>
          )}
          <button
            onClick={onClose}
            className="text-muted transition-colors hover:text-foreground"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {selectedProposalWarning && (
            <BillAutoFailWarningBanner warning={selectedProposalWarning} />
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Title *</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              placeholder="e.g. National Health Service Reform Act"
              className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted/60 focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Summary *</label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Briefly describe what this bill does…"
              className="w-full resize-none rounded-lg border border-card-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted/60 focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Category *</label>
              <select
                value={cat}
                onChange={(e) => handleCategoryChange(e.target.value)}
                className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm capitalize text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {availableCategories.map((c) => (
                  <option key={c} value={c} className="capitalize">
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">
                Originating Chamber
              </label>
              <select
                value={billChamber}
                disabled={!chamberSelectable}
                onChange={(e) => setBillChamber(e.target.value)}
                className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-default disabled:opacity-100"
              >
                {chambers.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {isCustomCat ? (
            /* ── Custom (flavor) bill: no provisions, no in-game effect ── */
            <p className="rounded-lg border border-card-border bg-card/50 px-3 py-2 text-xs text-muted">
              Custom bills have no in-game effect — for flavor / roleplay only. Just give it a title
              and summary.
            </p>
          ) : isNatCat ? (
            <NationalizationProvisionEditor
              countryCode={countryId}
              value={natRows}
              onChange={setNatRows}
            />
          ) : isTradeCat ? (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted">
                  Restriction Type
                </label>
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
            <div className="space-y-3">
              <div className="mb-2 flex items-center justify-between">
                <label className="block text-xs text-muted">Subsidy Provisions</label>
                {subsidyProvisions.length < MAX_PROVISIONS && (
                  <button
                    type="button"
                    onClick={() => setSubsidyProvisions((prev) => [...prev, { ...EMPTY_SUBSIDY }])}
                    className="text-xs text-primary hover:underline"
                  >
                    + Add provision
                  </button>
                )}
              </div>
              {subsidyProvisions.map((sp, i) => (
                <div
                  key={i}
                  className="space-y-2 rounded-lg border border-card-border bg-background/50 p-3"
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
                      className="flex-1 rounded-lg border border-card-border bg-card px-2 py-1.5 text-sm"
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
                        className="text-xs text-muted hover:text-red-400"
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
                    className="w-full rounded-lg border border-card-border bg-card px-2 py-1.5 text-sm"
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
                      className="w-full rounded-lg border border-card-border bg-card px-2 py-1.5 text-sm"
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
                    placeholder="Strategy filter (optional)"
                    className="w-full rounded-lg border border-card-border bg-card px-2 py-1.5 text-sm"
                  />
                  {sp.type === "subsidy" && (
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
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
                      <span className="text-xs text-muted">{domesticOnlyLabel}</span>
                    </label>
                  )}
                  {sp.type === "subsidy" && (
                    <p className="text-xs text-emerald-400/80">
                      +7.5% profit margin to qualifying sectors
                    </p>
                  )}
                </div>
              ))}

              {/* Union-law provision (v3 Phase 7b) — optional, additive to subsidy provisions above.
                  Inclusion is an explicit checkbox (code-review fix #15) — bias=0 is a valid,
                  legislatable reset to neutral, not just "don't propose one". */}
              <div className="space-y-2 rounded-lg border border-dashed border-purple-500/35 bg-purple-500/5 p-3">
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
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">
                  Provisions ({rows.length}/{MAX_PROVISIONS})
                </label>
                <button
                  type="button"
                  onClick={addRow}
                  disabled={rows.length >= MAX_PROVISIONS}
                  className="rounded-lg bg-primary px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                >
                  + Add Provision
                </button>
              </div>
              {rows.map((row, idx) => {
                const lt = legislationTypes.find((t) => t._id === row.legislationTypeId);
                const options = lt?.policyOptions ?? [];
                const selectedOption = options.find((o) => o.id === row.policyOptionId);
                return (
                  <div
                    key={idx}
                    className="space-y-2 rounded-lg border border-card-border bg-background/40 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                        Provision {idx + 1}
                      </span>
                      {rows.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeRow(idx)}
                          className="text-xs text-red-500 hover:underline"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <select
                      className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm text-foreground"
                      value={row.legislationTypeId}
                      onChange={(e) => {
                        const nextId = e.target.value;
                        const nextLt = legislationTypes.find((t) => t._id === nextId);
                        const first = nextLt?.policyOptions?.[0];
                        // Tax-slider laws start at the live current rate (submit
                        // stays blocked until the player moves it a full step).
                        const slider = nextLt?.taxSliderEstimate;
                        updateRow(idx, {
                          legislationTypeId: nextId,
                          policyOptionId: slider ? `rate:${slider.currentRate}` : (first?.id ?? ""),
                          effectDirection: first?.effectDirection ?? 0,
                          economic: first?.economic ?? 0,
                          social: first?.social ?? 0,
                          proposedRate: slider ? slider.currentRate : undefined,
                        });
                      }}
                    >
                      <option value="">Select policy type…</option>
                      {filteredTypes.map((t) => (
                        <option key={t._id} value={t._id}>
                          {t.name}
                          {t.eraNew ? " — New this era" : ""}
                        </option>
                      ))}
                    </select>
                    {lt?.taxSliderEstimate ? (
                      <TaxRateSliderControl
                        slider={lt.taxSliderEstimate}
                        proposedRate={row.proposedRate ?? lt.taxSliderEstimate.currentRate}
                        currencyCode={COUNTRY_CURRENCY_MAP[countryId]}
                        onChange={(rate) =>
                          updateRow(idx, {
                            proposedRate: rate,
                            policyOptionId: `rate:${rate}`,
                            effectDirection: rate > lt.taxSliderEstimate!.currentRate ? 1 : -1,
                          })
                        }
                      />
                    ) : lt && options.length > 0 ? (
                      <select
                        className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm text-foreground"
                        value={row.policyOptionId}
                        onChange={(e) => {
                          const nextId = e.target.value;
                          const opt = options.find((o) => o.id === nextId);
                          updateRow(idx, {
                            policyOptionId: nextId,
                            effectDirection: opt?.effectDirection ?? 0,
                            economic: opt?.economic ?? 0,
                            social: opt?.social ?? 0,
                          });
                        }}
                      >
                        <option value="">Select policy option…</option>
                        {options.map((option, optIdx) => {
                          const isBlocked = blockedProvisionKeys.has(
                            `${row.legislationTypeId}:${option.id}`
                          );
                          const isCurrentLevel = currentPolicies[row.legislationTypeId] === optIdx;
                          const disableReason = isCurrentLevel
                            ? " (current law)"
                            : isBlocked
                              ? " (active bill exists)"
                              : "";
                          return (
                            <option
                              key={option.id}
                              value={option.id}
                              disabled={isBlocked || isCurrentLevel}
                            >
                              {option.name}
                              {disableReason}
                            </option>
                          );
                        })}
                      </select>
                    ) : lt ? (
                      <div>
                        <label className="mb-1 block text-xs font-medium text-muted">
                          Direction:{" "}
                          {row.effectDirection === -1
                            ? "Left / Reduce"
                            : row.effectDirection === 1
                              ? "Right / Increase"
                              : "Neutral / Center"}
                        </label>
                        <Slider
                          min={-1}
                          max={1}
                          step={1}
                          value={row.effectDirection}
                          onChange={(e) =>
                            updateRow(idx, { effectDirection: Number(e.target.value) })
                          }
                          variant="primary"
                        />
                        <div className="mt-0.5 flex justify-between text-[10px] text-muted">
                          <span>Left / Reduce</span>
                          <span>Neutral</span>
                          <span>Right / Increase</span>
                        </div>
                      </div>
                    ) : null}
                    {lt && (
                      <div className="space-y-1 rounded-lg border border-card-border bg-background/50 p-3">
                        {(() => {
                          // New-gen catalog laws: the law's flavor line always shows,
                          // with the selected level's explanation stacked under it.
                          // Legacy types keep the single winner-takes-all line.
                          const isNewGen = Boolean(lt.politicalMetricTargets?.length);
                          if (isNewGen) {
                            return (
                              <div className="space-y-1">
                                {lt.description && (
                                  <p className="text-xs italic text-muted/80">{lt.description}</p>
                                )}
                                {selectedOption?.explanation && (
                                  <p className="text-xs text-muted">{selectedOption.explanation}</p>
                                )}
                              </div>
                            );
                          }
                          const explanation =
                            selectedOption?.explanation ?? lt.explanation ?? lt.description;
                          return explanation ? (
                            <p className="text-xs italic text-muted/80">{explanation}</p>
                          ) : null;
                        })()}
                        {/* New-gen laws: Current law → Proposed comparison with
                            per-level fiscal estimates + metric deltas vs enacted. */}
                        <LawProvisionComparison
                          countryId={countryId}
                          lt={lt}
                          currentIndex={currentPolicies[row.legislationTypeId]}
                          proposedIndex={options.findIndex((o) => o.id === row.policyOptionId)}
                        />
                        {/* Tax-slider laws skip the archetype panel — approval
                            flows through the metrics/economy channels instead. */}
                        {!lt.taxSliderEstimate && (
                          <PolicyEffectIndicators
                            effectTargetsWeighted={lt.effectTargetsWeighted}
                            effectDirection={row.effectDirection}
                            archetypeApprovals={selectedOption?.archetypeApprovals}
                            groupApprovals={selectedOption?.groupApprovals}
                            policyDomain={lt.policyDomain}
                            currentPolicyIndex={currentPolicies[row.legislationTypeId] ?? 3}
                            proposedPolicyIndex={options.findIndex(
                              (o) => o.id === row.policyOptionId
                            )}
                            billCountry={countryId}
                            policyOptions={options}
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {/* Bill-level fiscal roll-up across the new-gen provisions. */}
              <BillFiscalImpactStrip
                countryId={countryId}
                rows={rows.map((row) => {
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
          {/* Central bank independence — economy bills only. */}
          {isCentralBankCat && (
            <div className="rounded-lg border border-dashed border-amber-500/35 bg-amber-500/5 p-3 space-y-3">
              <p className="text-xs font-medium text-muted">Central bank (optional)</p>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={includeCbIndependence}
                  onChange={(e) => setIncludeCbIndependence(e.target.checked)}
                  className="rounded"
                />
                Change who sets the policy rate
              </label>
              <div className="flex items-center gap-3 text-xs text-muted">
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="radio"
                    name="cb-independence-action"
                    checked={cbIndependenceAction === "grant"}
                    disabled={!includeCbIndependence}
                    onChange={() => setCbIndependenceAction("grant")}
                  />
                  Grant the bank independence
                </label>
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="radio"
                    name="cb-independence-action"
                    checked={cbIndependenceAction === "revoke"}
                    disabled={!includeCbIndependence}
                    onChange={() => setCbIndependenceAction("revoke")}
                  />
                  Return rate-setting to the government
                </label>
              </div>
              <p className="text-[11px] italic text-muted/60">
                {!includeCbIndependence
                  ? "No central-bank provision will be included in this bill."
                  : cbIndependenceAction === "grant"
                    ? "On enactment the bank sets its own rate through its policy committee."
                    : "On enactment the head of government and the finance minister set the rate."}
              </p>
            </div>
          )}
          {/* Electoral law — social bills only. Each axis is opt-in on its own:
              a bill touching the franchise must not silently reset the
              registration regime, which is what the server enforces too. */}
          {isElectoralCat && (
            <div className="rounded-lg border border-dashed border-sky-500/35 bg-sky-500/5 p-3 space-y-3">
              <p className="text-xs font-medium text-muted">Electoral law (optional)</p>
              <div className="space-y-1.5">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
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
                    onInput={(e) => setVotingAge(Number((e.target as HTMLInputElement).value))}
                    className="flex-1 accent-sky-500 disabled:opacity-40"
                  />
                  <span className="min-w-[48px] rounded-md border border-card-border bg-card-elevated px-2 py-1 text-right font-mono text-xs">
                    {votingAge}
                  </span>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
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
          {submitBlockedByActiveBill && (
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              You already have a bill being voted on — it must resolve before you can propose
              another.
            </div>
          )}
          <div className="rounded-lg border border-card-border bg-card/50 px-3 py-2 text-xs text-muted">
            {adminOverride ? (
              <span>Cost waived (admin).</span>
            ) : (
              <span>
                Cost: {BILL_PROPOSE_ACTION_COST} actions + {npiCost} national influence
              </span>
            )}
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-card-border bg-card py-2 text-sm font-medium text-muted transition-colors hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitDisabled}
              className="flex-1 rounded-lg bg-primary py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? "Proposing…" : "Propose Bill"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
