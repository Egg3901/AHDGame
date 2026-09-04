"use client";

import { useEffect } from "react";
import {
  RELOCATION_COST_FRACTION,
  CROSS_COUNTRY_RELOCATION_MULTIPLIER,
  MIN_CORPORATION_DISSOLUTION_AGE_TURNS,
} from "@/lib/constants/corporations";
import { type CountryId } from "@/lib/constants/countries";
import { useEnabledCountries } from "@/contexts/RegisteredCountriesContext";
import { LEGAL_STRUCTURES, type LegalStructureId } from "@/lib/constants/legalStructures";
import { getLegalStructureForCorp, isListedOnlyStructure } from "@/lib/corporations/legalStructure";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { MailComposerModal } from "@/components/MailComposerModal";
import { CorporationStructureActions } from "../CorporationStructureActions";
import type { CorporationDetail } from "../CorporationPageTypes";
import { useCeoAdminState, type StateOption, type DissolvePreviewData } from "./useCeoAdminState";
import { CaretakerCeoCard } from "./CaretakerCeoCard";
import { TickerChangeCard } from "./TickerChangeCard";
import { SuperShareAdoptionCard } from "./SuperShareAdoptionCard";
import { useCountryDisplayName } from "@/contexts/RegisteredCountriesContext";

interface CeoAdminSubtabProps {
  corporation: CorporationDetail;
  corpId: string;
  onRefresh: () => void;
  onResign: () => Promise<void>;
  onRelocate: () => Promise<void>;
  onDissolve: () => Promise<void>;
}

export default function CeoAdminSubtab({
  corporation,
  corpId,
  onRefresh,
  onResign,
  onRelocate: _onRelocate,
  onDissolve,
}: CeoAdminSubtabProps) {
  const resolveCountryName = useCountryDisplayName();
  // Relocation targets are player-live countries only — a CEO can't move a corp to a
  // registered-but-not-yet-enabled country.
  const enabledCountries = useEnabledCountries();
  const [state, dispatch] = useCeoAdminState(corporation.countryId as CountryId);
  const {
    relocateTarget,
    relocatePayment,
    relocating,
    showRelocateConfirm,
    relocateError,
    relocateSuccess,
    stateOptions,
    loadingStates,
    relocateCountry,
    resignLoading,
    resignError,
    resignSuccess,
    showResignConfirm,
    dissolving,
    showDissolveConfirm,
    actionError,
    dissolvePreviewLoading,
    dissolvePreviewError,
    dissolvePreview,
    selectedStructure,
    legalStructureLoading,
    legalStructureError,
    legalStructureSuccess,
    shareholderAddressOpen,
  } = state;
  const { formatAmount, formatFull, toInternalFrom } = useCurrency();

  const relocationMarketCapBasis = Math.round(corporation.sharePrice * corporation.totalShares);
  const isCrossCountry = relocateCountry !== corporation.countryId;
  const relocationMultiplier = isCrossCountry ? CROSS_COUNTRY_RELOCATION_MULTIPLIER : 1;
  const relocationCost = Math.round(
    relocationMarketCapBasis * RELOCATION_COST_FRACTION * relocationMultiplier
  );
  const canPayCash = corporation.liquidCapital >= relocationCost;

  // Fetch states for the selected destination country (defaults to corp's
  // current country). Same-country browsing filters out the current HQ.
  useEffect(() => {
    dispatch({ type: "SET_LOADING_STATES", value: true });
    fetch(`/api/country/${relocateCountry.toLowerCase()}/states`)
      .then((res) => res.json())
      .then((data) => {
        const states = data.states as StateOption[];
        const filtered =
          relocateCountry === corporation.countryId
            ? states.filter((s) => s.id !== corporation.headquartersState)
            : states;
        dispatch({
          type: "SET_STATE_OPTIONS",
          value: filtered.sort((a, b) => a.name.localeCompare(b.name)),
        });
      })
      .catch(() => dispatch({ type: "SET_STATE_OPTIONS", value: [] }))
      .finally(() => dispatch({ type: "SET_LOADING_STATES", value: false }));
    dispatch({ type: "SET_RELOCATE_TARGET", value: "" });
    dispatch({ type: "SET_SHOW_RELOCATE_CONFIRM", value: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relocateCountry, corporation.countryId, corporation.headquartersState]);

  useEffect(() => {
    if (!showDissolveConfirm) return;
    let cancelled = false;
    dispatch({ type: "SET_DISSOLVE_PREVIEW_LOADING", value: true });
    dispatch({ type: "SET_DISSOLVE_PREVIEW_ERROR", value: "" });
    dispatch({ type: "SET_DISSOLVE_PREVIEW", value: null });
    void fetch(`/api/corporations/${corpId}/dissolve`)
      .then(async (res) => {
        const data = (await res.json()) as {
          success?: boolean;
          preview?: DissolvePreviewData;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || "Could not load dissolve preview");
        if (!data.preview) throw new Error("Invalid preview response");
        if (!cancelled) dispatch({ type: "SET_DISSOLVE_PREVIEW", value: data.preview });
      })
      .catch((e: Error) => {
        if (!cancelled)
          dispatch({ type: "SET_DISSOLVE_PREVIEW_ERROR", value: e.message || "Preview failed" });
      })
      .finally(() => {
        if (!cancelled) dispatch({ type: "SET_DISSOLVE_PREVIEW_LOADING", value: false });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDissolveConfirm, corpId]);

  async function handleRelocate() {
    if (!relocateTarget) return;
    dispatch({ type: "SET_RELOCATING", value: true });
    dispatch({ type: "SET_RELOCATE_ERROR", value: "" });
    dispatch({ type: "SET_RELOCATE_SUCCESS", value: "" });
    try {
      const res = await fetch(`/api/corporations/${corpId}/relocate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetStateId: relocateTarget,
          targetCountryId: relocateCountry,
          paymentMethod: relocatePayment,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        const methodNote =
          data.paymentMethod === "bond"
            ? ` Financed via 7-year bond at ${data.couponRate}% (${data.creditRating}).`
            : " Paid from Liquid Capital.";
        const ceoNote = data.ceoVacated
          ? " You were removed as CEO because you do not live in the new headquarters region."
          : "";
        dispatch({
          type: "SET_RELOCATE_SUCCESS",
          value: `Relocated to ${data.newHeadquartersName}. Cost: $${data.cost.toLocaleString("en-US")}.${methodNote}${ceoNote}`,
        });
        dispatch({ type: "SET_SHOW_RELOCATE_CONFIRM", value: false });
        dispatch({ type: "SET_RELOCATE_TARGET", value: "" });
        onRefresh();
      } else {
        dispatch({ type: "SET_RELOCATE_ERROR", value: data.error || "Failed to relocate" });
      }
    } catch {
      dispatch({ type: "SET_RELOCATE_ERROR", value: "Network error" });
    } finally {
      dispatch({ type: "SET_RELOCATING", value: false });
    }
  }

  async function handleResign() {
    dispatch({ type: "SET_RESIGN_LOADING", value: true });
    dispatch({ type: "SET_RESIGN_ERROR", value: "" });
    dispatch({ type: "SET_RESIGN_SUCCESS", value: "" });
    try {
      const res = await fetch(`/api/corporations/${corpId}/ceo/resign`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        dispatch({ type: "SET_RESIGN_SUCCESS", value: "You have resigned as CEO." });
        onRefresh();
        await onResign();
      } else {
        dispatch({ type: "SET_RESIGN_ERROR", value: data.error || "Failed to resign" });
      }
    } catch {
      dispatch({ type: "SET_RESIGN_ERROR", value: "Network error" });
    } finally {
      dispatch({ type: "SET_RESIGN_LOADING", value: false });
    }
  }

  async function handleDissolve() {
    dispatch({ type: "SET_DISSOLVING", value: true });
    dispatch({ type: "SET_ACTION_ERROR", value: "" });
    try {
      const res = await fetch(`/api/corporations/${corpId}/dissolve`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok) {
        window.location.href = "/corporations";
        await onDissolve();
      } else {
        dispatch({ type: "SET_ACTION_ERROR", value: data.error || "Failed to dissolve" });
      }
    } catch {
      dispatch({ type: "SET_ACTION_ERROR", value: "Network error" });
    } finally {
      dispatch({ type: "SET_DISSOLVING", value: false });
      dispatch({ type: "SET_SHOW_DISSOLVE_CONFIRM", value: false });
    }
  }

  async function handleChangeLegalStructure() {
    if (!selectedStructure) return;
    dispatch({ type: "SET_LEGAL_STRUCTURE_LOADING", value: true });
    dispatch({ type: "SET_LEGAL_STRUCTURE_ERROR", value: "" });
    dispatch({ type: "SET_LEGAL_STRUCTURE_SUCCESS", value: "" });
    try {
      const res = await fetch(`/api/corporations/${corpId}/legal-structure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ legalStructure: selectedStructure }),
      });
      const data = await res.json();
      if (res.ok) {
        dispatch({
          type: "SET_LEGAL_STRUCTURE_SUCCESS",
          value: "Legal structure updated successfully.",
        });
        dispatch({ type: "SET_SELECTED_STRUCTURE", value: "" });
        onRefresh();
      } else {
        dispatch({
          type: "SET_LEGAL_STRUCTURE_ERROR",
          value: (data as { error?: string }).error ?? "Failed to change legal structure",
        });
      }
    } catch {
      dispatch({ type: "SET_LEGAL_STRUCTURE_ERROR", value: "Network error" });
    } finally {
      dispatch({ type: "SET_LEGAL_STRUCTURE_LOADING", value: false });
    }
  }

  async function handleProposeLegalStructureVote() {
    if (!selectedStructure) return;
    dispatch({ type: "SET_LEGAL_STRUCTURE_LOADING", value: true });
    dispatch({ type: "SET_LEGAL_STRUCTURE_ERROR", value: "" });
    dispatch({ type: "SET_LEGAL_STRUCTURE_SUCCESS", value: "" });
    try {
      const res = await fetch(`/api/corporations/${corpId}/votes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "governance_change",
          newLegalStructure: selectedStructure,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        dispatch({
          type: "SET_LEGAL_STRUCTURE_SUCCESS",
          value: "Restructuring vote opened. Shareholders will be notified.",
        });
        dispatch({ type: "SET_SELECTED_STRUCTURE", value: "" });
        onRefresh();
      } else {
        dispatch({
          type: "SET_LEGAL_STRUCTURE_ERROR",
          value: (data as { error?: string }).error ?? "Failed to open vote",
        });
      }
    } catch {
      dispatch({ type: "SET_LEGAL_STRUCTURE_ERROR", value: "Network error" });
    } finally {
      dispatch({ type: "SET_LEGAL_STRUCTURE_LOADING", value: false });
    }
  }

  async function handleProposeRelocation() {
    if (!relocateTarget) return;
    dispatch({ type: "SET_RELOCATING", value: true });
    dispatch({ type: "SET_RELOCATE_ERROR", value: "" });
    dispatch({ type: "SET_RELOCATE_SUCCESS", value: "" });
    try {
      const res = await fetch(`/api/corporations/${corpId}/votes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "relocation",
          destinationCountryId: relocateCountry,
          destinationStateCode: relocateTarget,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        dispatch({
          type: "SET_RELOCATE_SUCCESS",
          value: "Relocation vote opened. Shareholders will be notified.",
        });
        dispatch({ type: "SET_SHOW_RELOCATE_CONFIRM", value: false });
        dispatch({ type: "SET_RELOCATE_TARGET", value: "" });
        onRefresh();
      } else {
        dispatch({
          type: "SET_RELOCATE_ERROR",
          value: (data as { error?: string }).error ?? "Failed to open vote",
        });
      }
    } catch {
      dispatch({ type: "SET_RELOCATE_ERROR", value: "Network error" });
    } finally {
      dispatch({ type: "SET_RELOCATING", value: false });
    }
  }

  async function handleProposeDissolution() {
    dispatch({ type: "SET_DISSOLVING", value: true });
    dispatch({ type: "SET_ACTION_ERROR", value: "" });
    try {
      const res = await fetch(`/api/corporations/${corpId}/votes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "dissolution", payload: {} }),
      });
      const data = await res.json();
      if (res.ok) {
        dispatch({ type: "SET_SHOW_DISSOLVE_CONFIRM", value: false });
        onRefresh();
      } else {
        dispatch({
          type: "SET_ACTION_ERROR",
          value: (data as { error?: string }).error ?? "Failed to open vote",
        });
      }
    } catch {
      dispatch({ type: "SET_ACTION_ERROR", value: "Network error" });
    } finally {
      dispatch({ type: "SET_DISSOLVING", value: false });
    }
  }

  // Shareholder address cooldown (12 hours)
  const lastAddressAt = corporation.lastShareholderAddressAt;
  const canSendAddress =
    !lastAddressAt || Date.now() - new Date(lastAddressAt).getTime() > 12 * 60 * 60 * 1000;
  const addressCooldownRemaining = lastAddressAt
    ? Math.max(0, 12 * 60 * 60 * 1000 - (Date.now() - new Date(lastAddressAt).getTime()))
    : 0;
  const addressCooldownMinutes = Math.ceil(addressCooldownRemaining / 60000);

  // Legal structure derived values
  // Only offer structures that fit the corp's current listing state: a private
  // corp can't elect a listed-only form (PLC/AG/…), and a public corp shouldn't
  // adopt a private-default form (Ltd/GmbH/…). Public corps route the change
  // through a shareholder vote, private corps change it directly.
  const countryStructures = LEGAL_STRUCTURES.filter(
    (s) =>
      s.countryId === corporation.countryId &&
      (corporation.isPrivate ? !isListedOnlyStructure(s) : !s.isPrivateDefault)
  );
  const currentStructure = getLegalStructureForCorp({
    countryId: corporation.countryId as CountryId,
    legalStructure: corporation.legalStructure as LegalStructureId | undefined,
    isPrivate: corporation.isPrivate,
  });
  const legalStructureOnCooldown =
    corporation.legalStructureChangeCooldownUntilTurn != null &&
    corporation.currentTurn < corporation.legalStructureChangeCooldownUntilTurn;

  return (
    <>
      <CorporationStructureActions
        corporation={corporation}
        corpId={corpId}
        isCeo={true}
        onRefresh={onRefresh}
      />

      {/* Legal Structure */}
      <div className="rounded-xl border border-card-border bg-card p-6">
        <h2 className="text-lg font-bold text-foreground mb-2">Legal Structure</h2>
        <p className="text-sm text-muted mb-4">
          {currentStructure ? (
            <>
              Currently structured as <strong>{currentStructure.name}</strong> —{" "}
              {currentStructure.description}.
            </>
          ) : (
            "Change your corporation&apos;s legal structure."
          )}
        </p>
        {legalStructureError && (
          <div className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error mb-3">
            {legalStructureError}
          </div>
        )}
        {legalStructureSuccess && (
          <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success mb-3">
            {legalStructureSuccess}
          </div>
        )}
        {legalStructureOnCooldown && (
          <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning mb-3">
            Legal structure change on cooldown until turn{" "}
            {corporation.legalStructureChangeCooldownUntilTurn}.
          </div>
        )}
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">New Structure</label>
            <select
              value={selectedStructure}
              onChange={(e) =>
                dispatch({
                  type: "SET_SELECTED_STRUCTURE",
                  value: e.target.value as LegalStructureId,
                })
              }
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:border-primary/60 focus:outline-none"
            >
              <option value="">Select a legal structure…</option>
              {countryStructures.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.taxTreatment === "pass_through"
                    ? " (pass-through)"
                    : s.taxTreatment === "preferential"
                      ? " (preferential tax)"
                      : ""}
                </option>
              ))}
            </select>
          </div>
          {selectedStructure &&
            (() => {
              const s = countryStructures.find((x) => x.id === selectedStructure);
              if (!s) return null;
              return (
                <div className="rounded-lg border border-card-border bg-card-elevated p-3 text-xs text-muted space-y-1">
                  <p>{s.description}</p>
                  <p>
                    Tax treatment:{" "}
                    <strong>
                      {s.taxTreatment === "pass_through"
                        ? "Pass-through (0% corporate tax)"
                        : s.taxTreatment === "preferential"
                          ? `Preferential (${((s.taxMultiplier ?? 1) * 100).toFixed(0)}% of standard rate)`
                          : "Standard"}
                    </strong>
                  </p>
                  {s.minimumDividendRate != null && (
                    <p>
                      Minimum dividend: <strong>{(s.minimumDividendRate * 100).toFixed(0)}%</strong>
                    </p>
                  )}
                  <p>
                    Vote threshold:{" "}
                    <strong>{(s.shareholderVoteThreshold * 100).toFixed(0)}% of shares</strong>
                  </p>
                </div>
              );
            })()}
          {selectedStructure &&
            (corporation.isPrivate ? (
              <button
                onClick={handleChangeLegalStructure}
                disabled={
                  legalStructureLoading ||
                  legalStructureOnCooldown ||
                  selectedStructure === currentStructure?.id
                }
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {legalStructureLoading ? "Changing…" : "Change Structure"}
              </button>
            ) : (
              <button
                onClick={handleProposeLegalStructureVote}
                disabled={legalStructureLoading || selectedStructure === currentStructure?.id}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {legalStructureLoading ? "Proposing…" : "Propose Restructuring (shareholder vote)"}
              </button>
            ))}
        </div>
      </div>

      {/* Dual-class supershares (public corps only) */}
      {!corporation.isPrivate && (
        <SuperShareAdoptionCard corporation={corporation} corpId={corpId} onRefresh={onRefresh} />
      )}

      {/* Stock Ticker */}
      <TickerChangeCard corporation={corporation} corpId={corpId} onRefresh={onRefresh} />

      {/* Relocate Corporation */}
      <div className="rounded-xl border border-card-border bg-card p-6">
        <h2 className="text-lg font-bold text-foreground mb-2">Relocate Headquarters</h2>
        <p className="text-sm text-muted mb-1">
          Move your corporate headquarters to a new state or region. Cost:{" "}
          <strong>{(RELOCATION_COST_FRACTION * 100).toFixed(0)}% of market capitalization</strong>{" "}
          in-country, <strong>doubled</strong> for moves to another country.
        </p>
        <p className="text-sm text-muted mb-4">
          Current HQ: <strong>{corporation.headquartersStateName}</strong> - Market cap:{" "}
          <strong>
            {(() => {
              // `relocationMarketCapBasis` is sharePrice × totalShares in corp LOCAL;
              // anchor-normalize before display so viewer wallet-pref conversion lands
              // correctly.
              const code = corporation.liquidCurrencyCode as CurrencyCode | undefined;
              const anchor = code
                ? toInternalFrom(relocationMarketCapBasis, code)
                : relocationMarketCapBasis;
              return formatAmount(anchor, code);
            })()}
          </strong>{" "}
          — Relocation cost:{" "}
          <strong>
            {(() => {
              const code = corporation.liquidCurrencyCode as CurrencyCode | undefined;
              const anchor = code ? toInternalFrom(relocationCost, code) : relocationCost;
              return formatAmount(anchor, code);
            })()}
          </strong>
          {isCrossCountry && (
            <span className="ml-2 inline-block rounded bg-warning/20 px-2 py-0.5 text-xs font-medium text-warning">
              Cross-country move — cost doubled
            </span>
          )}
        </p>
        <div className="mb-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
          <p className="font-medium text-foreground">CEO residency warning</p>
          <p className="mt-1 text-muted">
            This panel only moves the corporation. You keep the CEO role only if your character
            already lives in the destination state or region; otherwise relocating headquarters here
            will remove you as CEO.
          </p>
        </div>

        {relocateError && (
          <div className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error mb-3">
            {relocateError}
          </div>
        )}
        {relocateSuccess && (
          <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success mb-3">
            {relocateSuccess}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Country</label>
            <select
              value={relocateCountry}
              onChange={(e) =>
                dispatch({ type: "SET_RELOCATE_COUNTRY", value: e.target.value as CountryId })
              }
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:border-primary/60 focus:outline-none"
            >
              {enabledCountries.map((c) => (
                <option key={c} value={c}>
                  {resolveCountryName(c)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Destination</label>
            <select
              value={relocateTarget}
              onChange={(e) => {
                dispatch({ type: "SET_RELOCATE_TARGET", value: e.target.value });
                dispatch({ type: "SET_SHOW_RELOCATE_CONFIRM", value: false });
                dispatch({ type: "SET_RELOCATE_ERROR", value: "" });
              }}
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:border-primary/60 focus:outline-none"
              disabled={loadingStates}
            >
              <option value="">
                {loadingStates ? "Loading..." : "Select a state or region..."}
              </option>
              {stateOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.name}
                </option>
              ))}
            </select>
          </div>

          {relocateTarget && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Payment Method
              </label>
              <div className="flex gap-3">
                <label
                  className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm cursor-pointer transition-colors ${
                    relocatePayment === "cash"
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-card-border text-muted hover:border-primary/40"
                  }`}
                >
                  <input
                    type="radio"
                    name="relocatePayment"
                    value="cash"
                    checked={relocatePayment === "cash"}
                    onChange={() => dispatch({ type: "SET_RELOCATE_PAYMENT", value: "cash" })}
                    className="accent-primary"
                  />
                  <div>
                    <div className="font-medium">Liquid Capital</div>
                    <div className="text-xs text-muted">
                      {(() => {
                        const code = (corporation.liquidCurrencyCode ?? "USD") as CurrencyCode;
                        return formatFull(toInternalFrom(corporation.liquidCapital, code), code);
                      })()}{" "}
                      available
                      {!canPayCash && <span className="text-error ml-1">(insufficient)</span>}
                    </div>
                  </div>
                </label>
                <label
                  className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm cursor-pointer transition-colors ${
                    relocatePayment === "bond"
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-card-border text-muted hover:border-primary/40"
                  }`}
                >
                  <input
                    type="radio"
                    name="relocatePayment"
                    value="bond"
                    checked={relocatePayment === "bond"}
                    onChange={() => dispatch({ type: "SET_RELOCATE_PAYMENT", value: "bond" })}
                    className="accent-primary"
                  />
                  <div>
                    <div className="font-medium">Bond issuance</div>
                    <div className="text-xs text-muted">7-year bond at market rate</div>
                  </div>
                </label>
              </div>

              {relocatePayment === "cash" && !canPayCash && (
                <p className="text-xs text-warning mt-2">
                  You don&apos;t have enough Liquid Capital to pay for this relocation. Consider
                  using bond financing instead.
                </p>
              )}
            </div>
          )}

          {relocateTarget && !showRelocateConfirm && (
            <button
              onClick={() => dispatch({ type: "SET_SHOW_RELOCATE_CONFIRM", value: true })}
              disabled={relocatePayment === "cash" && !canPayCash}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              Relocate to{" "}
              {stateOptions.find((s) => s.id === relocateTarget)?.name ?? relocateTarget}
            </button>
          )}

          {showRelocateConfirm && (
            <div className="rounded-lg border border-warning/30 bg-warning/5 p-4">
              <p className="text-sm text-warning font-medium mb-2">
                Confirm relocation to{" "}
                <strong>
                  {stateOptions.find((s) => s.id === relocateTarget)?.name ?? relocateTarget}
                </strong>
                ?
              </p>
              <p className="text-xs text-muted mb-3">
                This will cost{" "}
                <strong>
                  {(() => {
                    const code = corporation.liquidCurrencyCode as CurrencyCode | undefined;
                    const anchor = code ? toInternalFrom(relocationCost, code) : relocationCost;
                    return formatAmount(anchor, code);
                  })()}
                </strong>
                {relocatePayment === "bond"
                  ? " financed via a 7-year bond at the current market rate."
                  : " deducted from Liquid Capital."}
                {isCrossCountry && " Cross-country move — cost doubled."}
              </p>
              <div className="flex items-center gap-3">
                {corporation.isPrivate ? (
                  <button
                    onClick={handleRelocate}
                    disabled={relocating}
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {relocating ? "Relocating..." : "Yes, Relocate"}
                  </button>
                ) : (
                  <button
                    onClick={handleProposeRelocation}
                    disabled={relocating}
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {relocating ? "Proposing..." : "Propose Relocation (shareholder vote)"}
                  </button>
                )}
                <button
                  onClick={() => dispatch({ type: "SET_SHOW_RELOCATE_CONFIRM", value: false })}
                  className="rounded-lg border border-card-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Resign as CEO */}
      <div className="rounded-xl border border-warning/30 bg-warning/5 p-6">
        <h2 className="text-lg font-bold text-warning mb-2">Resign as CEO</h2>
        <p className="text-sm text-muted mb-4">
          Step down from the CEO position. The position will become vacant and shareholders can vote
          for a new CEO. This does not dissolve the corporation.
        </p>
        {resignError && (
          <div className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error mb-3">
            {resignError}
          </div>
        )}
        {resignSuccess && (
          <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success mb-3">
            {resignSuccess}
          </div>
        )}
        {!showResignConfirm ? (
          <button
            onClick={() => dispatch({ type: "SET_SHOW_RESIGN_CONFIRM", value: true })}
            className="rounded-lg border border-warning/50 bg-warning/10 px-4 py-2 text-sm font-medium text-warning hover:bg-warning/20 transition-colors"
          >
            Resign as CEO
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-sm text-warning font-medium">Are you sure?</span>
            <button
              onClick={handleResign}
              disabled={resignLoading}
              className="rounded-lg bg-warning px-4 py-2 text-sm font-medium text-black hover:bg-warning/90 transition-colors disabled:opacity-50"
            >
              {resignLoading ? "Resigning..." : "Yes, Resign"}
            </button>
            <button
              onClick={() => dispatch({ type: "SET_SHOW_RESIGN_CONFIRM", value: false })}
              className="rounded-lg border border-card-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Caretaker CEO (NPP-autonomy V2.1) */}
      <CaretakerCeoCard corporation={corporation} corpId={corpId} onRefresh={onRefresh} />

      {/* CEO self-serve quick dissolve (POST /api/corporations/[id]/dissolve) — not admin force-liquidate */}
      <div className="rounded-xl border border-error/30 bg-error/5 p-6">
        <h2 className="text-lg font-bold text-error mb-2">Dissolve Corporation</h2>
        <p className="text-sm text-muted mb-4">
          Permanently dissolve the corporation as CEO. This action cannot be undone. All sectors are
          restored to unowned, held bonds are redeemed at face value, and equity positions in other
          corporations are sold at market price. Liquidation proceeds are then distributed pro-rata
          to every shareholder by share count — corporate equity holders are credited to their
          liquid capital, the public float slice is paid to the country&apos;s central bank reserve,
          and your share lands in your personal funds.
        </p>
        {actionError && (
          <div className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error mb-3">
            {actionError}
          </div>
        )}
        {!showDissolveConfirm ? (
          <button
            onClick={() => dispatch({ type: "SET_SHOW_DISSOLVE_CONFIRM", value: true })}
            className="rounded-lg border border-error/50 bg-error/10 px-4 py-2 text-sm font-medium text-error hover:bg-error/20 transition-colors"
          >
            Dissolve Corporation
          </button>
        ) : (
          <div className="rounded-lg border border-error/30 bg-error/5 p-4 space-y-4">
            <p className="text-sm text-error font-medium">
              ⚠️ This will permanently dissolve {corporation.name}. Are you absolutely sure?
            </p>

            {dissolvePreviewLoading && (
              <p className="text-xs text-muted">Loading payout and market preview…</p>
            )}
            {dissolvePreviewError && (
              <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                {dissolvePreviewError}
              </div>
            )}

            {dissolvePreview && !dissolvePreviewLoading && (
              <div className="space-y-3 rounded-lg border border-card-border bg-card/80 p-3 text-sm">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted font-medium mb-1">
                    Cash you personally receive
                  </p>
                  <p className="text-base font-semibold text-foreground">
                    {formatFull(
                      toInternalFrom(
                        dissolvePreview.ceoShareHome,
                        dissolvePreview.homeCurrency as CurrencyCode
                      ),
                      dissolvePreview.homeCurrency as CurrencyCode
                    )}
                  </p>
                  <p className="text-xs text-muted mt-1">
                    Your pro-rata share of the{" "}
                    {formatFull(
                      toInternalFrom(
                        dissolvePreview.returnedCapitalCorp,
                        (corporation.liquidCurrencyCode ?? "USD") as CurrencyCode
                      ),
                      (corporation.liquidCurrencyCode ?? "USD") as CurrencyCode
                    )}{" "}
                    total liquidation pool
                    {dissolvePreview.ceoIsSoleShareholder
                      ? " (you are the sole shareholder, so this is the full pool)"
                      : `, split across ${dissolvePreview.characterRows.length} character${dissolvePreview.characterRows.length === 1 ? "" : "s"}${dissolvePreview.corporateRows.length > 0 ? ` + ${dissolvePreview.corporateRows.length} corporate shareholder${dissolvePreview.corporateRows.length === 1 ? "" : "s"}` : ""}${dissolvePreview.publicFloatRow ? " + public float" : ""}`}
                    .
                  </p>
                </div>

                {(dissolvePreview.corporateRows.length > 0 ||
                  dissolvePreview.publicFloatRow ||
                  dissolvePreview.characterRows.length > 1) && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted font-medium mb-1">
                      Full distribution breakdown
                    </p>
                    <div className="overflow-x-auto max-h-40 overflow-y-auto rounded border border-card-border/60">
                      <table className="w-full text-xs">
                        <thead className="bg-card-muted/50 text-left text-[10px] uppercase text-muted sticky top-0">
                          <tr>
                            <th className="px-2 py-1.5 font-medium">Recipient</th>
                            <th className="px-2 py-1.5 font-medium text-right">Shares</th>
                            <th className="px-2 py-1.5 font-medium text-right">Payout (₳)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dissolvePreview.characterRows.map((row) => (
                            <tr
                              key={`c-${row.characterId}`}
                              className="border-t border-card-border/40"
                            >
                              <td className="px-2 py-1.5 text-foreground">
                                {row.name}
                                {row.isImperial ? " (imperial)" : ""}
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{row.shares}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">
                                {Math.round(row.payout).toLocaleString("en-US")}
                              </td>
                            </tr>
                          ))}
                          {dissolvePreview.corporateRows.map((row) => (
                            <tr
                              key={`x-${row.corporationId}`}
                              className="border-t border-card-border/40"
                            >
                              <td className="px-2 py-1.5 text-foreground">{row.name} (corp)</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{row.shares}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">
                                {Math.round(row.payout).toLocaleString("en-US")}
                              </td>
                            </tr>
                          ))}
                          {dissolvePreview.publicFloatRow && (
                            <tr className="border-t border-card-border/40">
                              <td className="px-2 py-1.5 text-foreground">
                                Public float → central bank reserve
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums">
                                {dissolvePreview.publicFloatRow.shares}
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums">
                                {Math.round(dissolvePreview.publicFloatRow.payout).toLocaleString(
                                  "en-US"
                                )}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {!dissolvePreview.canQuickDissolve &&
                  (dissolvePreview.dissolutionAgeTurnsRemaining > 0 ? (
                    <div className="rounded border border-error/40 bg-error/10 px-2 py-1.5 text-xs text-error">
                      This corporation is too new to dissolve — it must be at least{" "}
                      {MIN_CORPORATION_DISSOLUTION_AGE_TURNS} turns old (
                      {dissolvePreview.dissolutionAgeTurnsRemaining} more turn
                      {dissolvePreview.dissolutionAgeTurnsRemaining === 1 ? "" : "s"} to go).
                    </div>
                  ) : (
                    <div className="rounded border border-error/40 bg-error/10 px-2 py-1.5 text-xs text-error">
                      Quick dissolve is blocked while {dissolvePreview.outstandingBonds} bond
                      {dissolvePreview.outstandingBonds === 1 ? "" : "s"} remain outstanding — use
                      the bond default flow first.
                    </div>
                  ))}

                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted font-medium mb-1">
                    Global commodity prices (illustrative)
                  </p>
                  <p className="text-xs text-muted mb-2 leading-relaxed">
                    Direction if supply and demand cleared instantly. The next hourly tick also
                    applies drift, regional blending, pegs, and budgets — actual moves may differ.
                  </p>
                  {dissolvePreview.commodityGlobalDeltas.length === 0 ? (
                    <p className="text-xs text-muted">Negligible effect on global benchmarks.</p>
                  ) : (
                    <div className="overflow-x-auto max-h-48 overflow-y-auto rounded border border-card-border/60">
                      <table className="w-full text-xs">
                        <thead className="bg-card-muted/50 text-left text-[10px] uppercase text-muted sticky top-0">
                          <tr>
                            <th className="px-2 py-1.5 font-medium">Commodity</th>
                            <th className="px-2 py-1.5 font-medium text-right">Δ price</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dissolvePreview.commodityGlobalDeltas.map((row) => (
                            <tr key={row.commodity} className="border-t border-card-border/40">
                              <td className="px-2 py-1.5 text-foreground">{row.label}</td>
                              <td
                                className={`px-2 py-1.5 text-right tabular-nums font-medium ${
                                  row.deltaPct > 0.01
                                    ? "text-amber-400"
                                    : row.deltaPct < -0.01
                                      ? "text-emerald-400"
                                      : "text-muted"
                                }`}
                              >
                                {row.deltaPct >= 0 ? "+" : ""}
                                {row.deltaPct.toFixed(2)}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center gap-3">
              {corporation.isPrivate ? (
                <button
                  onClick={handleDissolve}
                  disabled={
                    dissolving ||
                    dissolvePreviewLoading ||
                    !!dissolvePreviewError ||
                    !dissolvePreview ||
                    !dissolvePreview.canQuickDissolve
                  }
                  className="rounded-lg bg-error px-4 py-2 text-sm font-medium text-white hover:bg-error/90 transition-colors disabled:opacity-50"
                >
                  {dissolving ? "Dissolving..." : "Yes, Dissolve"}
                </button>
              ) : (
                <button
                  onClick={handleProposeDissolution}
                  disabled={dissolving || (dissolvePreview?.dissolutionAgeTurnsRemaining ?? 0) > 0}
                  className="rounded-lg bg-error px-4 py-2 text-sm font-medium text-white hover:bg-error/90 transition-colors disabled:opacity-50"
                >
                  {dissolving ? "Proposing..." : "Propose Dissolution (shareholder vote)"}
                </button>
              )}
              <button
                onClick={() => dispatch({ type: "SET_SHOW_DISSOLVE_CONFIRM", value: false })}
                className="rounded-lg border border-card-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Shareholder Address */}
      <div className="rounded-xl border border-card-border bg-card p-6">
        <h2 className="text-lg font-bold text-foreground mb-2">Shareholder Address</h2>
        <p className="text-sm text-muted mb-4">
          Send an in-game mail message to all shareholders. This can be used for announcements,
          dividend updates, or other important information. (12-hour cooldown)
        </p>
        <button
          onClick={() => dispatch({ type: "SET_SHAREHOLDER_ADDRESS_OPEN", value: true })}
          disabled={!canSendAddress}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {canSendAddress ? "Compose Address" : `Cooldown (${addressCooldownMinutes}m remaining)`}
        </button>
      </div>

      {shareholderAddressOpen && (
        <MailComposerModal
          mode={{
            type: "shareholder-address",
            corporationId: corpId,
            corporationName: corporation.name,
          }}
          onClose={() => {
            dispatch({ type: "SET_SHAREHOLDER_ADDRESS_OPEN", value: false });
            onRefresh();
          }}
        />
      )}
    </>
  );
}
