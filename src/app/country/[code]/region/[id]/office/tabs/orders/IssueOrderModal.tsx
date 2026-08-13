"use client";

import { useEffect, useState } from "react";
import type { LegislationTypeOption } from "@/lib/legislature/dto/stateLegislature";
import { PolicyEffectIndicators } from "@/components/legislation/PolicyEffectIndicators";
import { LawProvisionComparison } from "@/components/bills/LawProvisionComparison";
import {
  EXEC_ORDER_AP_COST_PER_STEP,
  EXEC_ORDER_DURATION_TURNS,
  EXEC_ORDER_MAX_STEPS,
} from "@/lib/constants/governorOffice";
import { BILL_CATEGORIES, STATE_BILL_CATEGORIES } from "@shared/constants/legislation";
import { getExecutiveOrderName, type CountryId } from "@/lib/constants/countries";

interface Props {
  open: boolean;
  countryId: string;
  /**
   * The "stateId" the order targets. For Governor's Office: the state code
   * (e.g. "AZ"). For White House (federal): "federal" or the country's national
   * pseudo-state id.
   */
  stateId: string;
  /**
   * Scope of the order. "state" = governor-issued (default), "national" =
   * president-issued. Controls the API path used to issue + the legislation-types
   * filter that drives the policy dropdown.
   */
  scope?: "state" | "national";
  /**
   * When true the modal renders in admin-override mode: AP cost waived, red
   * theme, title flagged, and the POST body carries `adminOverride: true`.
   * Caller is responsible for only enabling this when the viewer is admin.
   */
  adminOverride?: boolean;
  existingOrderTypeIds: Set<string>;
  gubernatorialActions: number;
  onClose: () => void;
  onSuccess: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Signed shift value — negative loosens, positive tightens. ±1 or ±2. */
type Shift = -2 | -1 | 1 | 2;

const SHIFT_BUTTONS: { shift: Shift; arrows: string; label: string }[] = [
  { shift: -2, arrows: "▼▼", label: "Loosen 2 steps" },
  { shift: -1, arrows: "▼", label: "Loosen 1 step" },
  { shift: 1, arrows: "▲", label: "Tighten 1 step" },
  { shift: 2, arrows: "▲▲", label: "Tighten 2 steps" },
];

export function IssueOrderModal({
  open,
  countryId,
  stateId,
  scope = "state",
  adminOverride = false,
  existingOrderTypeIds,
  gubernatorialActions,
  onClose,
  onSuccess,
}: Props) {
  // "custom" is a bill-only flavor category; it has no meaning as an order category.
  const categoryList = (scope === "national" ? BILL_CATEGORIES : STATE_BILL_CATEGORIES).filter(
    (c) => c !== "custom"
  );
  // The order label follows the country's government type at BOTH scopes:
  // presidential systems issue "Executive Orders" (governor + president alike),
  // parliamentary systems issue "Orders in Council" (FM / Minister-President /
  // regional governor + national PM alike). A UK FM doesn't sign Executive
  // Orders any more than the UK PM does.
  const orderName = getExecutiveOrderName(countryId.toUpperCase() as CountryId);
  const [category, setCategory] = useState<string>(categoryList[0]);
  const [legId, setLegId] = useState<string>("");
  const [shift, setShift] = useState<Shift>(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typesForCategory, setTypesForCategory] = useState<LegislationTypeOption[]>([]);
  const [currentPolicies, setCurrentPolicies] = useState<Record<string, number>>({});

  // Fetch legislation types for the selected category. Mirrors the cascade
  // ProposeStateBillModal / QueueBillModal use. regionId prices new-gen
  // fiscal estimates at the Land/region GDP for state-scoped orders.
  useEffect(() => {
    if (!open) return;
    const regionParam = scope === "state" ? `&regionId=${encodeURIComponent(stateId)}` : "";
    fetch(
      `/api/game/legislation-types?category=${encodeURIComponent(category)}&scope=${scope}&country=${countryId.toLowerCase()}${regionParam}&nocache=1`,
      { cache: "no-store" }
    )
      .then((r) => (r.ok ? r.json() : []))
      .then((list: LegislationTypeOption[]) => {
        // Orders can only modify policy-option-based types — tariff/subsidy
        // categories surface no usable rows here.
        setTypesForCategory(list.filter((t) => (t.policyOptions?.length ?? 0) > 0));
      })
      .catch(() => setTypesForCategory([]));
  }, [open, countryId, scope, category, stateId]);

  // Reset selection when the user switches categories.
  function pickCategory(newCategory: string) {
    setCategory(newCategory);
    setLegId("");
  }

  useEffect(() => {
    if (!open) return;
    fetch(`/api/game/current-policies?stateId=${encodeURIComponent(stateId)}`, {
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : {}))
      .then((data: Record<string, number>) => setCurrentPolicies(data || {}))
      .catch(() => setCurrentPolicies({}));
  }, [open, stateId]);

  const selectedType: LegislationTypeOption | undefined = legId
    ? typesForCategory.find((t) => t._id === legId)
    : undefined;
  const policyOptions = selectedType?.policyOptions ?? [];
  const currentIndex = legId ? (currentPolicies[legId] ?? 3) : 3;
  const proposedIndex = clamp(currentIndex + shift, 0, 6);
  const actualSteps = Math.abs(proposedIndex - currentIndex);
  const wouldClamp = proposedIndex !== currentIndex + shift;
  const wouldNoOp = proposedIndex === currentIndex;
  const currentOption = policyOptions[currentIndex];
  const proposedOption = policyOptions[proposedIndex];

  const apCost = adminOverride ? 0 : Math.abs(shift) * EXEC_ORDER_AP_COST_PER_STEP;
  const canAffordAp = adminOverride || gubernatorialActions >= apCost;
  const canSubmit = Boolean(legId) && !wouldNoOp && !wouldClamp && canAffordAp && !submitting;

  if (!open) return null;

  function pickType(newId: string) {
    setLegId(newId);
    // Snap shift to a viable side if the picked type sits at a boundary.
    if (!newId) return;
    const curIdx = currentPolicies[newId] ?? 3;
    if (curIdx <= 0) setShift(1);
    else if (curIdx >= 6) setShift(-1);
  }

  /** Returns true if a given shift would clamp at the policy boundary for the
   *  current type/index, so the modal can disable those buttons up front. */
  function shiftWouldClamp(s: Shift): boolean {
    if (!legId) return false;
    const target = currentIndex + s;
    return target < 0 || target > 6;
  }

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const direction: 1 | -1 = shift > 0 ? 1 : -1;
    const steps = Math.abs(shift) as 1 | 2;
    const endpoint =
      scope === "national"
        ? `/api/country/${countryId.toLowerCase()}/executive/orders`
        : `/api/country/${countryId.toLowerCase()}/region/${stateId.toLowerCase()}/office/orders`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        legislationTypeId: legId,
        effectDirection: direction,
        steps,
        ...(adminOverride ? { adminOverride: true } : {}),
      }),
    });
    if (res.ok) {
      onSuccess();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data?.error ?? "Failed to issue order.");
      setSubmitting(false);
    }
  }

  return (
    // Extra bottom padding on mobile keeps the whole dialog above the sticky
    // turn-status bar, which otherwise covers the Cancel/Issue row and leaves
    // the order unsubmittable on a phone.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 pb-28 sm:pb-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="issue-order-title"
    >
      <div className="w-full max-w-2xl rounded-2xl border border-card-border bg-card p-6 shadow-modal max-h-[85dvh] overflow-y-auto">
        <h2 id="issue-order-title" className="text-lg font-semibold mb-3">
          {adminOverride ? `Issue ${orderName} (Admin)` : `Issue ${orderName}`}
        </h2>
        <p className="text-xs text-muted mb-4">
          {`An ${orderName} nudges a ${scope === "national" ? "national" : "state"} policy by up to ${EXEC_ORDER_MAX_STEPS} steps for ${EXEC_ORDER_DURATION_TURNS} turns, or until rescinded or superseded by legislation.`}
          {adminOverride
            ? " Admin override bypasses AP cost."
            : ` Costs ${EXEC_ORDER_AP_COST_PER_STEP} office AP per step.`}
        </p>

        <label className="block text-xs text-muted mb-1">Category</label>
        <select
          value={category}
          onChange={(e) => pickCategory(e.target.value)}
          className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm mb-3 capitalize"
          disabled={submitting}
          aria-label="Category"
        >
          {categoryList.map((c) => (
            <option key={c} value={c} className="capitalize">
              {c}
            </option>
          ))}
        </select>

        <label className="block text-xs text-muted mb-1">Policy</label>
        <select
          value={legId}
          onChange={(e) => pickType(e.target.value)}
          className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm mb-3"
          disabled={submitting || typesForCategory.length === 0}
          aria-label="Policy"
        >
          <option value="">
            {typesForCategory.length === 0
              ? "No policy types available for this category"
              : "Select a policy…"}
          </option>
          {typesForCategory.map((t) => (
            <option key={t._id} value={t._id} disabled={existingOrderTypeIds.has(t._id)}>
              {t.name}
              {existingOrderTypeIds.has(t._id) ? " (already active)" : ""}
            </option>
          ))}
        </select>

        {legId && (
          <>
            <label className="block text-xs text-muted mb-1">Shift</label>
            <div className="grid grid-cols-2 gap-2 mb-3 sm:grid-cols-4">
              {SHIFT_BUTTONS.map((b) => {
                const clamped = shiftWouldClamp(b.shift);
                const destIdx = clamp(currentIndex + b.shift, 0, 6);
                const destName = policyOptions[destIdx]?.name;
                const cost = Math.abs(b.shift);
                return (
                  <button
                    key={b.shift}
                    type="button"
                    onClick={() => setShift(b.shift)}
                    disabled={submitting || clamped}
                    className={`rounded-lg border px-3 py-2 text-xs text-left transition-colors disabled:opacity-50 ${
                      shift === b.shift
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-card-border text-muted"
                    }`}
                    title={clamped ? "Would clamp at policy boundary" : ""}
                  >
                    <div className="font-semibold text-sm">
                      {b.arrows} {cost} AP
                    </div>
                    <div className="text-[11px] mt-0.5">
                      {destName ? (
                        <>
                          Toward <span className="font-medium">{destName}</span>
                        </>
                      ) : (
                        b.label
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {policyOptions.length > 0 ? (
              <div className="mb-3 rounded-lg border border-card-border bg-background/40 p-3 text-xs">
                <div className="flex flex-col gap-1">
                  <div>
                    <span className="text-muted">Current law: </span>
                    <span className="font-medium">
                      {currentOption?.name ?? `index ${currentIndex}`}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted">After order: </span>
                    {wouldNoOp ? (
                      <span className="text-error">Would no-op — already at this level</span>
                    ) : wouldClamp ? (
                      <span className="text-error">
                        Would clamp at boundary — pick {actualSteps} step
                        {actualSteps === 1 ? "" : "s"} instead
                      </span>
                    ) : (
                      <span className="font-medium text-primary">
                        {proposedOption?.name ?? `index ${proposedIndex}`}
                      </span>
                    )}
                  </div>
                </div>
                {proposedOption?.explanation && !wouldNoOp && !wouldClamp && (
                  <p className="mt-2 pt-2 border-t border-card-border/50 text-muted/80 italic">
                    {proposedOption.explanation}
                  </p>
                )}
              </div>
            ) : null}

            {!wouldNoOp && !wouldClamp && proposedOption && (
              <div className="mb-3 space-y-2">
                {selectedType && (
                  <LawProvisionComparison
                    countryId={countryId}
                    lt={selectedType}
                    currentIndex={currentIndex}
                    proposedIndex={proposedIndex}
                  />
                )}
                <PolicyEffectIndicators
                  effectTargetsWeighted={selectedType?.effectTargetsWeighted}
                  effectDirection={shift > 0 ? 1 : -1}
                  archetypeApprovals={proposedOption.archetypeApprovals}
                  groupApprovals={proposedOption.groupApprovals}
                  policyDomain={selectedType?.policyDomain}
                  currentPolicyIndex={currentIndex}
                  proposedPolicyIndex={proposedIndex}
                  billCountry={countryId.toUpperCase()}
                  policyOptions={selectedType?.policyOptions}
                />
              </div>
            )}
          </>
        )}

        <div className="rounded-lg border border-card-border bg-card/50 px-3 py-2 text-xs text-muted mb-3">
          {adminOverride ? (
            <span>Cost waived (admin override) · Duration: {EXEC_ORDER_DURATION_TURNS} turns</span>
          ) : (
            <>
              <span>
                Cost: {apCost} office AP · Duration: {EXEC_ORDER_DURATION_TURNS} turns
              </span>
              <span className="block mt-0.5">Balance: {gubernatorialActions} office AP</span>
              {!canAffordAp && (
                <span className="block mt-1 text-error">
                  Not enough office AP ({gubernatorialActions}/{apCost}).
                </span>
              )}
            </>
          )}
        </div>

        {error && <p className="mb-3 text-sm text-error">{error}</p>}
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
            disabled={!canSubmit}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${
              adminOverride ? "bg-error hover:bg-error/80" : "bg-primary hover:bg-primary/80"
            }`}
          >
            {submitting ? "Issuing…" : adminOverride ? "Issue (admin)" : `Issue (${apCost} AP)`}
          </button>
        </div>
      </div>
    </div>
  );
}
