"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CROSS_COUNTRY_RELOCATION_MULTIPLIER,
  MIN_CORPORATION_DISSOLUTION_AGE_TURNS,
  RELOCATION_COST_FRACTION,
} from "@/lib/constants/corporations";
import { type CountryId } from "@/lib/constants/countries";
import { LEGAL_STRUCTURES, type LegalStructureId } from "@/lib/constants/legalStructures";
import { getLegalStructureForCorp, isListedOnlyStructure } from "@/lib/corporations/legalStructure";
import { useCountryDisplayName, useEnabledCountries } from "@/contexts/RegisteredCountriesContext";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { useCurrency } from "@/contexts/CurrencyContext";
import { MailComposerModal } from "@/components/MailComposerModal";
import { LocalTime } from "@/components/time/LocalTime";
import { CorporationStructureActions } from "../CorporationStructureActions";
import type { CorporationDetail } from "../CorporationPageTypes";
import {
  DenseSection,
  InlineStatus,
  KVRow,
  SmallButton,
  Td,
  Th,
  useCorpMoney,
} from "../dense/DenseKit";
import { CaretakerCeoCard } from "./CaretakerCeoCard";
import { GovernanceRow } from "./GovernanceRow";
import { SuperShareAdoptionCard } from "./SuperShareAdoptionCard";
import { TickerChangeCard } from "./TickerChangeCard";
import { useCeoAdminState, type DissolvePreviewData, type StateOption } from "./useCeoAdminState";

const ADDRESS_COOLDOWN_MS = 12 * 60 * 60 * 1000;

const selectClass =
  "h-7 min-w-0 rounded-md border border-card-border bg-background px-1.5 text-xs text-foreground focus:border-foreground focus:outline-none disabled:opacity-50";

interface CeoGovernancePanelProps {
  corporation: CorporationDetail;
  corpId: string;
  onRefresh: () => void;
}

/**
 * Governance as one list: each row states where the corporation stands and
 * opens its form in place. Public corporations route structural changes
 * through a shareholder vote; private ones apply them directly.
 */
export default function CeoGovernancePanel({
  corporation,
  corpId,
  onRefresh,
}: CeoGovernancePanelProps) {
  const router = useRouter();
  // Read once per mount: the address cooldown is shown in minutes.
  const [now] = useState(() => Date.now());
  const resolveCountryName = useCountryDisplayName();
  // Relocation targets are player-live countries only.
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
  const { formatFull, toInternalFrom } = useCurrency();
  const money = useCorpMoney(corporation.liquidCurrencyCode);

  const relocationMarketCapBasis = Math.round(corporation.sharePrice * corporation.totalShares);
  const isCrossCountry = relocateCountry !== corporation.countryId;
  const relocationCost = Math.round(
    relocationMarketCapBasis *
      RELOCATION_COST_FRACTION *
      (isCrossCountry ? CROSS_COUNTRY_RELOCATION_MULTIPLIER : 1)
  );
  const canPayCash = corporation.liquidCapital >= relocationCost;
  const destinationName = stateOptions.find((s) => s.id === relocateTarget)?.name ?? relocateTarget;

  // States for the selected destination country. Browsing the home country
  // leaves out the current HQ.
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

  async function postJson(url: string, body?: unknown) {
    const res = await fetch(url, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, data };
  }

  async function handleRelocate() {
    if (!relocateTarget) return;
    dispatch({ type: "SET_RELOCATING", value: true });
    dispatch({ type: "SET_RELOCATE_ERROR", value: "" });
    dispatch({ type: "SET_RELOCATE_SUCCESS", value: "" });
    try {
      const { ok, data } = corporation.isPrivate
        ? await postJson(`/api/corporations/${corpId}/relocate`, {
            targetStateId: relocateTarget,
            targetCountryId: relocateCountry,
            paymentMethod: relocatePayment,
          })
        : await postJson(`/api/corporations/${corpId}/votes`, {
            type: "relocation",
            destinationCountryId: relocateCountry,
            destinationStateCode: relocateTarget,
          });
      if (!ok) {
        dispatch({
          type: "SET_RELOCATE_ERROR",
          value:
            (data.error as string) ||
            (corporation.isPrivate ? "Failed to relocate" : "Failed to open vote"),
        });
        return;
      }
      let message = "Relocation vote opened. Shareholders will be notified.";
      if (corporation.isPrivate) {
        const cost = typeof data.cost === "number" ? money.fmt(data.cost) : "";
        const method =
          data.paymentMethod === "bond"
            ? ` Financed by a 7-year bond at ${data.couponRate}% (${data.creditRating}).`
            : " Paid from cash.";
        const ceoNote = data.ceoVacated
          ? " You were removed as CEO because you do not live in the new headquarters region."
          : "";
        message = `Relocated to ${data.newHeadquartersName}. Cost ${cost}.${method}${ceoNote}`;
      }
      dispatch({ type: "SET_RELOCATE_SUCCESS", value: message });
      dispatch({ type: "SET_SHOW_RELOCATE_CONFIRM", value: false });
      dispatch({ type: "SET_RELOCATE_TARGET", value: "" });
      onRefresh();
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
      const { ok, data } = await postJson(`/api/corporations/${corpId}/ceo/resign`);
      if (ok) {
        dispatch({ type: "SET_RESIGN_SUCCESS", value: "You have resigned as CEO." });
        onRefresh();
      } else {
        dispatch({ type: "SET_RESIGN_ERROR", value: (data.error as string) || "Failed to resign" });
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
      if (corporation.isPrivate) {
        const { ok, data } = await postJson(`/api/corporations/${corpId}/dissolve`);
        if (ok) {
          router.push("/corporations");
          return;
        }
        dispatch({
          type: "SET_ACTION_ERROR",
          value: (data.error as string) || "Failed to dissolve",
        });
      } else {
        const { ok, data } = await postJson(`/api/corporations/${corpId}/votes`, {
          type: "dissolution",
          payload: {},
        });
        if (ok) {
          dispatch({ type: "SET_SHOW_DISSOLVE_CONFIRM", value: false });
          onRefresh();
        } else {
          dispatch({
            type: "SET_ACTION_ERROR",
            value: (data.error as string) || "Failed to open vote",
          });
        }
      }
    } catch {
      dispatch({ type: "SET_ACTION_ERROR", value: "Network error" });
    } finally {
      dispatch({ type: "SET_DISSOLVING", value: false });
    }
  }

  async function handleLegalStructure() {
    if (!selectedStructure) return;
    dispatch({ type: "SET_LEGAL_STRUCTURE_LOADING", value: true });
    dispatch({ type: "SET_LEGAL_STRUCTURE_ERROR", value: "" });
    dispatch({ type: "SET_LEGAL_STRUCTURE_SUCCESS", value: "" });
    try {
      const { ok, data } = corporation.isPrivate
        ? await postJson(`/api/corporations/${corpId}/legal-structure`, {
            legalStructure: selectedStructure,
          })
        : await postJson(`/api/corporations/${corpId}/votes`, {
            type: "governance_change",
            newLegalStructure: selectedStructure,
          });
      if (ok) {
        dispatch({
          type: "SET_LEGAL_STRUCTURE_SUCCESS",
          value: corporation.isPrivate
            ? "Legal structure updated."
            : "Restructuring vote opened. Shareholders will be notified.",
        });
        dispatch({ type: "SET_SELECTED_STRUCTURE", value: "" });
        onRefresh();
      } else {
        dispatch({
          type: "SET_LEGAL_STRUCTURE_ERROR",
          value:
            (data.error as string) ??
            (corporation.isPrivate ? "Failed to change legal structure" : "Failed to open vote"),
        });
      }
    } catch {
      dispatch({ type: "SET_LEGAL_STRUCTURE_ERROR", value: "Network error" });
    } finally {
      dispatch({ type: "SET_LEGAL_STRUCTURE_LOADING", value: false });
    }
  }

  // Shareholder address: one per 12 hours.
  const lastAddressAt = corporation.lastShareholderAddressAt;
  const addressCooldownRemaining = lastAddressAt
    ? Math.max(0, ADDRESS_COOLDOWN_MS - (now - new Date(lastAddressAt).getTime()))
    : 0;
  const addressCooldownMinutes = Math.ceil(addressCooldownRemaining / 60000);

  // A private corp may not elect a listed-only form (PLC, AG), and a public
  // corp should not adopt a private-default one (Ltd, GmbH).
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
  const chosenStructure = countryStructures.find((x) => x.id === selectedStructure);
  const taxLabel = (s: (typeof LEGAL_STRUCTURES)[number]) =>
    s.taxTreatment === "pass_through"
      ? "pass-through, no corporate tax"
      : s.taxTreatment === "preferential"
        ? `preferential tax, ${((s.taxMultiplier ?? 1) * 100).toFixed(0)}% of the standard rate`
        : "standard tax";

  const corpCode = (corporation.liquidCurrencyCode ?? "USD") as CurrencyCode;

  return (
    <DenseSection
      id="ceo-governance"
      title="Governance"
      meta={
        corporation.isPrivate
          ? "private: changes apply at once"
          : "public: changes go to a shareholder vote"
      }
    >
      <GovernanceRow
        label="Shareholder address"
        summary={
          lastAddressAt ? (
            <>
              Last sent{" "}
              <LocalTime
                value={lastAddressAt}
                options={{ dateStyle: "medium", timeStyle: "short" }}
              />
              {addressCooldownRemaining > 0 ? `. Next in ${addressCooldownMinutes} min.` : "."}
            </>
          ) : (
            "Mail every shareholder. Once every 12 hours."
          )
        }
        actionLabel="Compose"
        onAction={() => dispatch({ type: "SET_SHAREHOLDER_ADDRESS_OPEN", value: true })}
        disabled={addressCooldownRemaining > 0}
        disabledReason={`Available in ${addressCooldownMinutes} minutes.`}
      />

      <TickerChangeCard corporation={corporation} corpId={corpId} onRefresh={onRefresh} />

      <GovernanceRow
        label="Legal form"
        summary={
          currentStructure
            ? `${currentStructure.name}, ${taxLabel(currentStructure)}${
                legalStructureOnCooldown
                  ? `. Locked until turn ${corporation.legalStructureChangeCooldownUntilTurn}.`
                  : ""
              }`
            : "Not set"
        }
        actionLabel="Change"
        disabled={corporation.isPrivate && legalStructureOnCooldown}
        disabledReason={`Locked until turn ${corporation.legalStructureChangeCooldownUntilTurn}.`}
      >
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              aria-label="New legal structure"
              value={selectedStructure}
              onChange={(e) =>
                dispatch({
                  type: "SET_SELECTED_STRUCTURE",
                  value: e.target.value as LegalStructureId,
                })
              }
              className={`${selectClass} w-64`}
            >
              <option value="">Choose a structure</option>
              {countryStructures.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <SmallButton
              tone="primary"
              onClick={handleLegalStructure}
              disabled={
                !selectedStructure ||
                legalStructureLoading ||
                selectedStructure === currentStructure?.id ||
                (corporation.isPrivate && legalStructureOnCooldown)
              }
            >
              {legalStructureLoading
                ? "Submitting"
                : corporation.isPrivate
                  ? "Change structure"
                  : "Propose vote"}
            </SmallButton>
          </div>
          {chosenStructure && (
            <p className="max-w-md text-xs text-muted">{chosenStructure.description}</p>
          )}
          {chosenStructure && (
            <dl className="max-w-md">
              <KVRow label="Tax" value={taxLabel(chosenStructure)} mono={false} />
              {chosenStructure.minimumDividendRate != null && (
                <KVRow
                  label="Minimum dividend"
                  value={`${(chosenStructure.minimumDividendRate * 100).toFixed(0)}%`}
                />
              )}
              <KVRow
                label="Vote threshold"
                value={`${(chosenStructure.shareholderVoteThreshold * 100).toFixed(0)}% of shares`}
              />
            </dl>
          )}
          <InlineStatus message={legalStructureError} tone="error" />
          <InlineStatus message={legalStructureSuccess} tone="success" />
        </div>
      </GovernanceRow>

      <GovernanceRow
        label="Headquarters"
        summary={`${corporation.headquartersStateName}. Moving costs ${(RELOCATION_COST_FRACTION * 100).toFixed(0)}% of market cap, doubled abroad.`}
        actionLabel="Relocate"
      >
        <div className="space-y-1.5">
          <p className="text-xs text-warning">
            You stay CEO only if your character already lives in the destination region.
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              aria-label="Destination country"
              value={relocateCountry}
              onChange={(e) =>
                dispatch({ type: "SET_RELOCATE_COUNTRY", value: e.target.value as CountryId })
              }
              className={selectClass}
            >
              {enabledCountries.map((c) => (
                <option key={c} value={c}>
                  {resolveCountryName(c)}
                </option>
              ))}
            </select>
            <select
              aria-label="Destination region"
              value={relocateTarget}
              onChange={(e) => {
                dispatch({ type: "SET_RELOCATE_TARGET", value: e.target.value });
                dispatch({ type: "SET_SHOW_RELOCATE_CONFIRM", value: false });
                dispatch({ type: "SET_RELOCATE_ERROR", value: "" });
              }}
              className={`${selectClass} w-48`}
              disabled={loadingStates}
            >
              <option value="">{loadingStates ? "Loading" : "Choose a region"}</option>
              {stateOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.name}
                </option>
              ))}
            </select>
            {corporation.isPrivate && (
              <select
                aria-label="Payment"
                value={relocatePayment}
                onChange={(e) =>
                  dispatch({
                    type: "SET_RELOCATE_PAYMENT",
                    value: e.target.value as "cash" | "bond",
                  })
                }
                className={selectClass}
              >
                <option value="cash">Pay from cash</option>
                <option value="bond">Finance with a 7-year bond</option>
              </select>
            )}
          </div>
          <dl className="max-w-sm">
            <KVRow
              label={isCrossCountry ? "Cost (abroad, doubled)" : "Cost"}
              value={money.fmt(relocationCost)}
            />
            <KVRow
              label="Cash available"
              value={formatFull(toInternalFrom(corporation.liquidCapital, corpCode), corpCode)}
              hint={
                corporation.isPrivate && relocatePayment === "cash" && !canPayCash ? (
                  <span className="text-error">not enough</span>
                ) : undefined
              }
            />
          </dl>
          {relocateTarget &&
            (showRelocateConfirm ? (
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-foreground">
                  {corporation.isPrivate
                    ? `Move headquarters to ${destinationName} for ${money.fmt(relocationCost)}?`
                    : `Put a move to ${destinationName} to a shareholder vote?`}
                </span>
                <SmallButton tone="primary" onClick={handleRelocate} disabled={relocating}>
                  {relocating ? "Working" : corporation.isPrivate ? "Relocate" : "Open vote"}
                </SmallButton>
                <SmallButton
                  onClick={() => dispatch({ type: "SET_SHOW_RELOCATE_CONFIRM", value: false })}
                >
                  Cancel
                </SmallButton>
              </div>
            ) : (
              <SmallButton
                tone="primary"
                onClick={() => dispatch({ type: "SET_SHOW_RELOCATE_CONFIRM", value: true })}
                disabled={corporation.isPrivate && relocatePayment === "cash" && !canPayCash}
              >
                {corporation.isPrivate
                  ? `Relocate to ${destinationName}`
                  : `Propose ${destinationName}`}
              </SmallButton>
            ))}
          <InlineStatus message={relocateError} tone="error" />
          <InlineStatus message={relocateSuccess} tone="success" />
        </div>
      </GovernanceRow>

      <CorporationStructureActions
        corporation={corporation}
        corpId={corpId}
        isCeo
        onRefresh={onRefresh}
      />

      {!corporation.isPrivate && (
        <SuperShareAdoptionCard corporation={corporation} corpId={corpId} onRefresh={onRefresh} />
      )}

      <CaretakerCeoCard corporation={corporation} corpId={corpId} onRefresh={onRefresh} />

      <GovernanceRow
        label="Resign as CEO"
        summary="The seat falls vacant and shareholders vote for a successor. The corporation continues."
        actionLabel="Resign"
        tone="danger"
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {showResignConfirm ? (
            <>
              <span className="text-xs text-foreground">Step down now?</span>
              <SmallButton tone="danger" onClick={handleResign} disabled={resignLoading}>
                {resignLoading ? "Resigning" : "Yes, resign"}
              </SmallButton>
              <SmallButton
                onClick={() => dispatch({ type: "SET_SHOW_RESIGN_CONFIRM", value: false })}
              >
                Cancel
              </SmallButton>
            </>
          ) : (
            <SmallButton
              tone="danger"
              onClick={() => dispatch({ type: "SET_SHOW_RESIGN_CONFIRM", value: true })}
            >
              Resign as CEO
            </SmallButton>
          )}
          <InlineStatus message={resignError} tone="error" />
          <InlineStatus message={resignSuccess} tone="success" />
        </div>
      </GovernanceRow>

      <GovernanceRow
        label="Dissolve"
        summary={
          corporation.isPrivate
            ? "Wind up the corporation and pay out shareholders. Cannot be undone."
            : "Put winding up the corporation to a shareholder vote."
        }
        actionLabel="Dissolve"
        tone="danger"
      >
        <div className="space-y-2">
          <p className="text-xs text-muted">
            Sectors return to the unowned pool, held bonds are redeemed at face value and holdings
            in other corporations are sold at market. The proceeds go to every shareholder by share
            count: corporate holders to their treasury, the public float to the central bank
            reserve, your share to your personal funds.
          </p>
          {!showDissolveConfirm ? (
            <SmallButton
              tone="danger"
              onClick={() => dispatch({ type: "SET_SHOW_DISSOLVE_CONFIRM", value: true })}
            >
              Preview payout
            </SmallButton>
          ) : (
            <div className="space-y-2">
              {dissolvePreviewLoading && (
                <p className="text-xs text-muted">Loading the payout and market preview.</p>
              )}
              <InlineStatus message={dissolvePreviewError} tone="error" />
              {dissolvePreview && !dissolvePreviewLoading && (
                <DissolvePreview
                  preview={dissolvePreview}
                  corpCode={corpCode}
                  formatFull={(amount, code) => formatFull(toInternalFrom(amount, code), code)}
                />
              )}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-foreground">
                  {corporation.isPrivate
                    ? `Permanently dissolve ${corporation.name}?`
                    : "Open a dissolution vote?"}
                </span>
                <SmallButton
                  tone="danger"
                  onClick={handleDissolve}
                  disabled={
                    dissolving ||
                    (corporation.isPrivate
                      ? dissolvePreviewLoading ||
                        !!dissolvePreviewError ||
                        !dissolvePreview ||
                        !dissolvePreview.canQuickDissolve
                      : (dissolvePreview?.dissolutionAgeTurnsRemaining ?? 0) > 0)
                  }
                >
                  {dissolving
                    ? "Working"
                    : corporation.isPrivate
                      ? "Yes, dissolve"
                      : "Open dissolution vote"}
                </SmallButton>
                <SmallButton
                  onClick={() => dispatch({ type: "SET_SHOW_DISSOLVE_CONFIRM", value: false })}
                >
                  Cancel
                </SmallButton>
              </div>
            </div>
          )}
          <InlineStatus message={actionError} tone="error" />
        </div>
      </GovernanceRow>

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
    </DenseSection>
  );
}

function DissolvePreview({
  preview,
  corpCode,
  formatFull,
}: {
  preview: DissolvePreviewData;
  corpCode: CurrencyCode;
  formatFull: (amount: number, code: CurrencyCode) => string;
}) {
  const showBreakdown =
    preview.corporateRows.length > 0 || preview.publicFloatRow || preview.characterRows.length > 1;
  return (
    <div className="space-y-2">
      <dl className="max-w-md">
        <KVRow
          label="You receive"
          value={formatFull(preview.ceoShareHome, preview.homeCurrency as CurrencyCode)}
        />
        <KVRow
          label="Liquidation pool"
          value={formatFull(preview.returnedCapitalCorp, corpCode)}
          hint={preview.ceoIsSoleShareholder ? "sole shareholder" : undefined}
        />
      </dl>
      {showBreakdown && (
        <div className="max-h-48 max-w-md overflow-y-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Th>Recipient</Th>
                <Th align="right">Shares</Th>
                <Th align="right">Payout</Th>
              </tr>
            </thead>
            <tbody>
              {preview.characterRows.map((row) => (
                <tr key={`c-${row.characterId}`}>
                  <Td>
                    {row.name}
                    {row.isImperial ? " (imperial)" : ""}
                  </Td>
                  <Td align="right">{row.shares.toLocaleString("en-US")}</Td>
                  <Td align="right">{Math.round(row.payout).toLocaleString("en-US")}</Td>
                </tr>
              ))}
              {preview.corporateRows.map((row) => (
                <tr key={`x-${row.corporationId}`}>
                  <Td>{row.name} (corp)</Td>
                  <Td align="right">{row.shares.toLocaleString("en-US")}</Td>
                  <Td align="right">{Math.round(row.payout).toLocaleString("en-US")}</Td>
                </tr>
              ))}
              {preview.publicFloatRow && (
                <tr>
                  <Td>Public float, to the central bank</Td>
                  <Td align="right">{preview.publicFloatRow.shares.toLocaleString("en-US")}</Td>
                  <Td align="right">
                    {Math.round(preview.publicFloatRow.payout).toLocaleString("en-US")}
                  </Td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {!preview.canQuickDissolve &&
        (preview.dissolutionAgeTurnsRemaining > 0 ? (
          <p className="text-xs text-error">
            Too new to dissolve: corporations must be {MIN_CORPORATION_DISSOLUTION_AGE_TURNS} turns
            old ({preview.dissolutionAgeTurnsRemaining} to go).
          </p>
        ) : (
          <p className="text-xs text-error">
            Blocked while {preview.outstandingBonds} bond
            {preview.outstandingBonds === 1 ? " is" : "s are"} outstanding. Settle them through the
            bond default flow first.
          </p>
        ))}
      <div>
        <p className="text-xs text-muted">
          Commodity prices if supply and demand cleared at once (the next turn also applies drift,
          regional blending, pegs and budgets):
        </p>
        {preview.commodityGlobalDeltas.length === 0 ? (
          <p className="text-xs text-muted">No meaningful effect on global prices.</p>
        ) : (
          <div className="max-h-40 max-w-sm overflow-y-auto">
            <table className="w-full border-collapse">
              <tbody>
                {preview.commodityGlobalDeltas.map((row) => (
                  <tr key={row.commodity}>
                    <Td>{row.label}</Td>
                    <Td
                      align="right"
                      className={
                        row.deltaPct > 0.01
                          ? "text-warning"
                          : row.deltaPct < -0.01
                            ? "text-success"
                            : "text-muted"
                      }
                    >
                      {row.deltaPct >= 0 ? "+" : ""}
                      {row.deltaPct.toFixed(2)}%
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
