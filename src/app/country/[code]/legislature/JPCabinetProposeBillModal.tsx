"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/contexts/ToastContext";
import { fetchJson } from "@/lib/observability/fetchJson";
import {
  BILL_CATEGORIES,
  BILL_PROPOSE_ACTION_COST,
  CATEGORY_TO_POLICY_DOMAINS,
  NATIONALIZATION_BILL_CATEGORIES,
  getProvisionCostTotal,
} from "@shared/constants/legislation";
import type { BillCategory } from "@shared/constants/legislation";
import {
  NationalizationProvisionEditor,
  toNatPayload,
  validateNatRows,
  type NatProvisionInput,
} from "@/components/bills/NationalizationProvisionEditor";
import { legislatureApiUrl } from "@/lib/urls";
import type { CountryId } from "@/lib/constants/countries";
import { getNationalStateId } from "@/lib/policy/nationalStateId";
import { PolicyEffectIndicators } from "@/components/legislation/PolicyEffectIndicators";
import {
  BillAutoFailWarningBanner,
  postBillProposalWithElectionConfirmation,
} from "@/components/bills/BillAutoFailWarning";
import type { BillProposalAutoFailWarning } from "@/lib/legislature/billAutoFailWarning";

interface LegislationPolicyOption {
  id: string;
  name: string;
  explanation?: string;
  effectDirection: number;
  economic?: number;
  social?: number;
  archetypeApprovals?: Record<string, number>;
  groupApprovals?: Record<string, number>;
}

interface LegislationTypeOption {
  _id: string;
  name: string;
  description: string;
  explanation?: string;
  policyDomain: string;
  effectTargetsWeighted?: { metricCategoryId: string; metricId: string; weight: number }[];
  policyOptions?: LegislationPolicyOption[];
  /** Set by the era-gated legislation-types API for types unlocked this era. */
  eraNew?: boolean;
}

export function JPCabinetProposeBillModal({
  countryId,
  proposalWarning,
  blockedProvisions,
  allowedPolicyDomains,
  adminOverride,
  onClose,
  onSuccess,
}: {
  countryId: CountryId;
  proposalWarning?: BillProposalAutoFailWarning | null;
  blockedProvisions?: { legislationTypeId: string; policyOptionId: string }[];
  allowedPolicyDomains?: string[] | null;
  adminOverride?: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { showToast } = useToast();
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [category, setCategory] = useState<BillCategory>(BILL_CATEGORIES[0] as BillCategory);
  const [legislationTypes, setLegislationTypes] = useState<LegislationTypeOption[]>([]);
  const [legislationTypeId, setLegislationTypeId] = useState("");
  const [policyOptionId, setPolicyOptionId] = useState("");
  const [effectDirection, setEffectDirection] = useState(0);
  const [currentPolicies, setCurrentPolicies] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const isNatCat = NATIONALIZATION_BILL_CATEGORIES.has(category);
  const [natRows, setNatRows] = useState<NatProvisionInput[]>([{ type: "nationalize" }]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    fetchJson<LegislationTypeOption[]>(
      `/api/game/legislation-types?scope=national&country=${countryId.toLowerCase()}&nocache=1`,
      { feature: "jp-cabinet-legislation-types" }
    )
      .then((types) => {
        if (Array.isArray(types)) {
          setLegislationTypes(types);
        }
      })
      .catch(() => {});
  }, [countryId]);

  useEffect(() => {
    // SSOT for the national policy-store id (US federal, RU su_national, …).
    const policyStoreId = getNationalStateId(countryId);
    fetch(`/api/game/current-policies?stateId=${encodeURIComponent(policyStoreId)}`, {
      cache: "no-store",
    })
      .then((response) => (response.ok ? response.json() : {}))
      .then((data: Record<string, number>) => setCurrentPolicies(data))
      .catch(() => setCurrentPolicies({}));
  }, [countryId]);

  const categoryDomains = (CATEGORY_TO_POLICY_DOMAINS as Record<string, string[]>)[category] ?? [];
  const filteredTypes = legislationTypes.filter((type) => {
    if (!categoryDomains.includes(type.policyDomain)) return false;
    if (allowedPolicyDomains == null) return true;
    return allowedPolicyDomains.includes(type.policyDomain);
  });
  const selectedLegislationType =
    legislationTypes.find((type) => type._id === legislationTypeId) ?? null;
  const selectedPolicyOption =
    selectedLegislationType?.policyOptions?.find((option) => option.id === policyOptionId) ?? null;
  const blockedKeys = new Set(
    (blockedProvisions ?? []).map(
      (provision) => `${provision.legislationTypeId}:${provision.policyOptionId}`
    )
  );
  const submitDisabled =
    submitting ||
    !title.trim() ||
    !summary.trim() ||
    (isNatCat ? false : !legislationTypeId || !policyOptionId || filteredTypes.length === 0);
  const npiCost = getProvisionCostTotal(isNatCat ? natRows.length : 1);

  useEffect(() => {
    if (!legislationTypeId) return;
    if (filteredTypes.some((type) => type._id === legislationTypeId)) return;
    setLegislationTypeId("");
    setPolicyOptionId("");
    setEffectDirection(0);
  }, [filteredTypes, legislationTypeId]);

  function resetPolicySelection(nextLegislationTypeId: string) {
    setLegislationTypeId(nextLegislationTypeId);
    setPolicyOptionId("");
    setEffectDirection(0);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || !summary.trim()) {
      showToast("Title and summary are required.", "error");
      return;
    }
    if (isNatCat) {
      const natErr = validateNatRows(natRows);
      if (natErr) {
        showToast(natErr, "error");
        return;
      }
    } else if (!legislationTypeId || !policyOptionId) {
      showToast("Title, summary, legislation type, and policy option are required.", "error");
      return;
    }

    const body = isNatCat
      ? {
          title: title.trim(),
          summary: summary.trim(),
          category,
          provisions: toNatPayload(natRows),
        }
      : {
          title: title.trim(),
          summary: summary.trim(),
          category,
          legislationTypeId,
          policyOptionId,
          effectDirection,
        };

    setSubmitting(true);
    try {
      const { response, data, cancelled } = await postBillProposalWithElectionConfirmation({
        url: `${legislatureApiUrl(countryId)}/cabinet-bills`,
        body,
      });
      if (cancelled) return;
      if (!response.ok) {
        showToast(data.error ?? "Failed to propose cabinet bill.", "error");
        return;
      }
      showToast("Cabinet bill proposed for cabinet review.", "success");
      onSuccess();
    } catch {
      showToast("Network error. Please try again.", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4 py-8">
      <div className="my-auto w-full max-w-lg rounded-2xl border border-card-border bg-card p-6 shadow-modal">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-lg font-semibold text-foreground">
                Propose Legislation
              </h2>
              {adminOverride ? (
                <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium text-warning">
                  Admin
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-muted">
              Originating in the Cabinet. Costs {BILL_PROPOSE_ACTION_COST} action points and{" "}
              {npiCost} national influence.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted transition-colors hover:text-foreground"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {proposalWarning ? <BillAutoFailWarningBanner warning={proposalWarning} /> : null}

          <div>
            <label className="mb-1 block text-xs text-muted">Bill Title</label>
            <input
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={200}
              placeholder="e.g. National Security Reform Act"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted">Summary</label>
            <textarea
              className="w-full resize-none rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Brief description of what this bill does..."
              required
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-muted">Category</label>
              <select
                className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm capitalize focus:outline-none focus:ring-1 focus:ring-primary"
                value={category}
                onChange={(event) => {
                  setCategory(event.target.value as BillCategory);
                  resetPolicySelection("");
                }}
              >
                {/* Custom (flavor) bills are not offered via the cabinet channel. */}
                {BILL_CATEGORIES.filter((billCategory) => billCategory !== "custom").map(
                  (billCategory) => (
                    <option key={billCategory} value={billCategory} className="capitalize">
                      {billCategory}
                    </option>
                  )
                )}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs text-muted">Originating Chamber</label>
              <select
                disabled
                value="cabinet"
                className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground/80 focus:outline-none"
              >
                <option value="cabinet">Cabinet</option>
              </select>
            </div>
          </div>

          {isNatCat ? (
            <NationalizationProvisionEditor
              countryCode={countryId}
              value={natRows}
              onChange={setNatRows}
            />
          ) : (
            <div className="space-y-3">
              <label className="block text-xs text-muted">Provision (1/1)</label>
              <div className="space-y-2 rounded-lg border border-card-border bg-background/40 p-3">
                <select
                  className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  value={legislationTypeId}
                  onChange={(event) => resetPolicySelection(event.target.value)}
                  disabled={filteredTypes.length === 0}
                >
                  <option value="">Select legislation type...</option>
                  {filteredTypes.map((type) => (
                    <option key={type._id} value={type._id}>
                      {type.name}
                      {type.eraNew ? " — New this era" : ""}
                    </option>
                  ))}
                </select>

                {filteredTypes.length === 0 ? (
                  <p className="text-xs text-muted">
                    No legislation types in the{" "}
                    <span className="font-medium capitalize">{category}</span> category are
                    available for your cabinet portfolio.
                  </p>
                ) : null}

                <select
                  className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  value={policyOptionId}
                  onChange={(event) => {
                    const option = selectedLegislationType?.policyOptions?.find(
                      (candidate) => candidate.id === event.target.value
                    );
                    setPolicyOptionId(event.target.value);
                    setEffectDirection(option?.effectDirection ?? 0);
                  }}
                  disabled={!legislationTypeId || filteredTypes.length === 0}
                >
                  <option value="">Select policy option...</option>
                  {(selectedLegislationType?.policyOptions ?? []).map((option, optIdx) => {
                    const blocked = blockedKeys.has(`${legislationTypeId}:${option.id}`);
                    const isCurrentLevel = currentPolicies[legislationTypeId] === optIdx;
                    const suffix = isCurrentLevel
                      ? " (current law)"
                      : blocked
                        ? " (already in active bill)"
                        : "";
                    return (
                      <option
                        key={option.id}
                        value={option.id}
                        disabled={blocked || isCurrentLevel}
                      >
                        {option.name}
                        {suffix}
                      </option>
                    );
                  })}
                </select>

                {selectedLegislationType ? (
                  <div className="space-y-1 rounded-lg border border-card-border bg-background/50 p-3">
                    {selectedPolicyOption?.explanation || selectedLegislationType.explanation ? (
                      <p className="text-xs italic text-muted/80">
                        {selectedPolicyOption?.explanation ??
                          selectedLegislationType.explanation ??
                          selectedLegislationType.description}
                      </p>
                    ) : null}
                    {selectedPolicyOption ? (
                      <PolicyEffectIndicators
                        effectTargetsWeighted={selectedLegislationType.effectTargetsWeighted}
                        effectDirection={effectDirection}
                        archetypeApprovals={selectedPolicyOption.archetypeApprovals}
                        groupApprovals={selectedPolicyOption.groupApprovals}
                        policyDomain={selectedLegislationType.policyDomain}
                        currentPolicyIndex={currentPolicies[selectedLegislationType._id] ?? 3}
                        proposedPolicyIndex={
                          selectedLegislationType.policyOptions?.findIndex(
                            (option) => option.id === selectedPolicyOption.id
                          ) ?? -1
                        }
                        billCountry={countryId}
                        policyOptions={selectedLegislationType.policyOptions}
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
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
              {submitting ? "Proposing..." : "Propose Bill"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
