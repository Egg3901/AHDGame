"use client";

import { useReducer, useCallback, useEffect, useMemo, useState } from "react";
import { Input, Slider } from "@/components/ui";
import { getMessageStyle } from "@/lib/utils/formatters";
import { useToast } from "@/contexts/ToastContext";
import { COUNTRY_CURRENCY_MAP, CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import { partyApiUrl } from "@/lib/urls";
import type { PartyData, PartyMember, UserData } from "./types";
import { treasuryReducer, type TreasuryAction } from "./treasuryReducer";
import { fmt } from "./helpers";
import { TreasuryOverview } from "./TreasuryOverview";
import { TreasuryGotvControl } from "./TreasuryGotvControl";
import { TreasuryRegistrationControl } from "./TreasuryRegistrationControl";
import { TreasurySuppressionControl } from "./TreasurySuppressionControl";
import { TreasuryTransferControls } from "./TreasuryTransferControls";
import { useCurrency } from "@/contexts/CurrencyContext";
import { parseMoneyAmountInput } from "@/lib/utils/parseMoneyAmountInput";
import { contrastTextColor } from "@/lib/utils/colorContrast";
import { TreasuryPlanningCard } from "@/components/party/TreasuryPlanningCard";
import { formatTreasuryReserveInputValue } from "@/lib/currency/treasuryReserveDisplay";
import {
  PS_INVESTMENT_MAX_TIERS,
  NATIONAL_PASSIVE_PS_PER_TURN,
  psInvestmentRate,
} from "@/lib/politicalStrength/strengthConstants";
import { PsInvestmentBlock } from "@/app/country/[code]/region/[id]/party/[partyId]/components/PsInvestmentBlock";
import {
  getNationalTreasuryPresetValues,
  getTreasuryPresetOptions,
  type TreasuryPresetId,
} from "@/lib/treasury/partyTreasuryPresets";
import type { NationalTreasuryInsights } from "@/lib/treasury/partyTreasuryInsights";
import { TreasuryFundingInsightsCard } from "@/components/party/TreasuryFundingInsightsCard";
import { TreasuryOverrideHistoryCard } from "@/components/party/TreasuryOverrideHistoryCard";

// ─── Props ────────────────────────────────────────────────────────────────────

interface TreasuryPanelProps {
  party: PartyData;
  partyId: string;
  countryId: string;
  modViewEnabled?: boolean;
  /**
   * Coarse: admin / chair / VC / treasurer. Gates Send + Transfer and
   * the visibility of the manage card shell. Inside the shell, finer-
   * grained flags below control individual blocks.
   */
  canManageTreasury: boolean;
  /**
   * Treasurer + admin can edit the Treasury Plan. Chair/VC see the plan
   * read-only (per the 2026-05-23 spec) — the card itself is rendered
   * whenever `canManageTreasury` and `canEdit` toggles the input state.
   */
  canManageTreasuryPlan: boolean;
  /**
   * Chair / VC / admin can edit the Tax Rate. Treasurer sees the value
   * read-only — the Tax row renders for anyone in `canManageTreasury`
   * with an inert slider when this flag is false.
   */
  canManageTax: boolean;
  /**
   * Chair / VC / treasurer / admin can edit GOTV / Suppression / PS
   * Investment — same set the budget API routes authorize (see
   * `resolveTreasuryPermissions`).
   */
  canManageBudgets: boolean;
  isInParty: boolean;
  isAdmin: boolean;
  sortedMembers: PartyMember[];
  onPartyRefresh: () => void;
  onUserRefresh?: () => void;
  user?: UserData | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TreasuryPanel({
  party,
  partyId: _partyId,
  countryId,
  modViewEnabled = false,
  canManageTreasury,
  canManageTreasuryPlan,
  canManageTax,
  canManageBudgets,
  isInParty,
  isAdmin,
  sortedMembers,
  onPartyRefresh,
  onUserRefresh,
  user,
}: TreasuryPanelProps) {
  const partyBaseUrl = partyApiUrl(countryId, party.id);
  const { showToast } = useToast();
  const { baseRates } = useCurrency();
  const partyCurrencyCode = COUNTRY_CURRENCY_MAP[party.countryId];
  const presetOptions = useMemo(() => getTreasuryPresetOptions(), []);
  const emptyInsights = useMemo<NationalTreasuryInsights>(
    () => ({
      recentTransferRecipients: [],
      lowestTreasuryStates: [],
      growthLeaders: [],
      overrideHistory: [],
    }),
    []
  );
  const reserveDisplayValues = useMemo(
    () => ({
      transferReserveAmount: formatTreasuryReserveInputValue(party.transferReserveAmount),
      memberSupportReserveAmount: formatTreasuryReserveInputValue(party.memberSupportReserveAmount),
      nppRecruitmentReserveAmount: formatTreasuryReserveInputValue(
        party.nppRecruitmentReserveAmount
      ),
    }),
    [
      party.transferReserveAmount,
      party.memberSupportReserveAmount,
      party.nppRecruitmentReserveAmount,
    ]
  );
  const [treasuryPreset, setTreasuryPreset] = useState<TreasuryPresetId>(
    party.treasuryPreset ?? "custom"
  );
  const [insights, setInsights] = useState<NationalTreasuryInsights | null>(null);
  const canViewTreasuryInsights = canManageTreasury || modViewEnabled;

  // Country-aware PS investment rate, converted to display currency for the
  // input + cap labels (the chair types in display currency).
  // Post-cf-inconsistency-fix Phase 6: psInvestmentRate returns the documented
  // native-local anchor ($250k US, £200k UK, €233k DE, ¥16.67M JP) directly —
  // no forex conversion needed because treasury is now persisted in local
  // currency in the same units.
  const psInvestmentRateDisplay = psInvestmentRate(party.countryId, "national");
  const psInvestmentMaxDisplay = psInvestmentRateDisplay * PS_INVESTMENT_MAX_TIERS;
  const [psInvestmentBudget, setPsInvestmentBudget] = useState<string>(() =>
    formatTreasuryReserveInputValue(party.psInvestmentBudget)
  );
  const [savingPsInvestment, setSavingPsInvestment] = useState(false);

  // Re-sync local input when the persisted value changes (e.g. after save).
  useEffect(() => {
    setPsInvestmentBudget(formatTreasuryReserveInputValue(party.psInvestmentBudget));
  }, [party.psInvestmentBudget, partyCurrencyCode, baseRates]);

  const handleSavePsInvestment = useCallback(async () => {
    // Post-cf-inconsistency-fix Phase 6: budget persists in the party's native
    // local currency, matching the units the chair typed — no conversion.
    const budget = Math.max(0, parseMoneyAmountInput(psInvestmentBudget));
    setSavingPsInvestment(true);
    try {
      const r = await fetch(`${partyBaseUrl}/ps-investment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ budget }),
      });
      const d = await r.json();
      if (!r.ok) {
        showToast(d.error ?? "Failed to set PS investment", "error");
      } else {
        showToast(`PS investment set: +${d.expectedPsPerTurn.toFixed(2)} PS / turn`, "success");
        onPartyRefresh();
      }
    } catch {
      showToast("Network error", "error");
    } finally {
      setSavingPsInvestment(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [psInvestmentBudget, partyCurrencyCode, baseRates, partyBaseUrl, showToast, onPartyRefresh]);

  const [state, dispatch] = useReducer(treasuryReducer, {
    taxForm: { rate: party.nationalTaxRate ?? 0, saving: false },
    gotvForm: {
      percent: party.gotvBudgetPercent ?? 0,
      category: party.gotvTargetCategory ?? "",
      group: party.gotvTargetGroup ?? "",
      saving: false,
    },
    suppressionForm: {
      percent: party.suppressionBudgetPercent ?? 0,
      category: party.suppressionTargetCategory ?? "",
      group: party.suppressionTargetGroup ?? "",
      saving: false,
    },
    registrationForm: {
      percent: party.registrationBudgetPercent ?? 0,
      saving: false,
    },
    reserveForm: {
      transferReserveAmount: reserveDisplayValues.transferReserveAmount,
      memberSupportReserveAmount: reserveDisplayValues.memberSupportReserveAmount,
      nppRecruitmentReserveAmount: reserveDisplayValues.nppRecruitmentReserveAmount,
      saving: false,
    },
    transferForm: { state: "", amount: "", transferring: false },
    sendForm: { memberId: "", amount: "", sending: false },
    donateForm: { amount: "", donating: false },
    msg: "",
  });
  const {
    taxForm,
    gotvForm,
    suppressionForm,
    registrationForm,
    reserveForm,
    transferForm,
    sendForm,
    donateForm,
    msg,
  } = state;

  useEffect(() => {
    dispatch({ type: "SYNC_RESERVE_FORM", payload: reserveDisplayValues });
  }, [reserveDisplayValues]);

  useEffect(() => {
    if (!canViewTreasuryInsights) return;
    let cancelled = false;
    const insightsUrl = modViewEnabled
      ? `${partyBaseUrl}/treasury/insights?modView=1`
      : `${partyBaseUrl}/treasury/insights`;
    fetch(insightsUrl, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as NationalTreasuryInsights;
      })
      .then((payload) => {
        if (!cancelled) setInsights(payload ?? emptyInsights);
      })
      .catch(() => {
        if (!cancelled) setInsights(emptyInsights);
      });
    return () => {
      cancelled = true;
    };
  }, [
    canViewTreasuryInsights,
    modViewEnabled,
    partyBaseUrl,
    party.treasury,
    party.transferReserveAmount,
    party.memberSupportReserveAmount,
    party.nppRecruitmentReserveAmount,
    emptyInsights,
  ]);

  const dispatchWithPreset = useCallback(
    (action: TreasuryAction) => {
      if (
        (action.type === "SET_GOTV" && action.field === "percent") ||
        (action.type === "SET_SUPPRESSION" && action.field === "percent")
      ) {
        setTreasuryPreset("custom");
      }
      dispatch(action);
    },
    [setTreasuryPreset]
  );

  const apiPost = useCallback(
    async (url: string, body: object, options?: { onOk?: () => void; successMessage?: string }) => {
      dispatch({ type: "SET_MSG", payload: "" });
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const d = await r.json();
        dispatch({ type: "SET_MSG", payload: r.ok ? `✓ ${d.message}` : `✗ ${d.error}` });
        if (r.ok) {
          if (options?.successMessage) {
            dispatch({ type: "SET_MSG", payload: `Success: ${options.successMessage}` });
          }
          onPartyRefresh();
          options?.onOk?.();
        }
      } catch {
        dispatch({ type: "SET_MSG", payload: "✗ Network error" });
      }
    },
    [onPartyRefresh]
  );

  const handleSaveTax = useCallback(async () => {
    dispatch({ type: "SET_TAX_SAVING", payload: true });
    await apiPost(`${partyBaseUrl}/tax`, { taxRate: taxForm.rate });
    dispatch({ type: "SET_TAX_SAVING", payload: false });
  }, [apiPost, partyBaseUrl, taxForm.rate]);

  const handleSaveGotv = useCallback(async () => {
    dispatch({ type: "SET_GOTV_SAVING", payload: true });
    try {
      const r = await fetch(`${partyBaseUrl}/gotv`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gotvBudgetPercent: gotvForm.percent,
          gotvTargetCategory: gotvForm.category || undefined,
          gotvTargetGroup: gotvForm.group || undefined,
        }),
      });
      const d = await r.json();
      showToast(r.ok ? d.message : d.error, r.ok ? "success" : "error");
      if (r.ok) onPartyRefresh();
    } catch {
      showToast("Network error", "error");
    }
    dispatch({ type: "SET_GOTV_SAVING", payload: false });
  }, [
    partyBaseUrl,
    gotvForm.percent,
    gotvForm.category,
    gotvForm.group,
    showToast,
    onPartyRefresh,
  ]);

  const handleSaveSuppression = useCallback(async () => {
    dispatch({ type: "SET_SUPPRESSION_SAVING", payload: true });
    try {
      const r = await fetch(`${partyBaseUrl}/suppression`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suppressionBudgetPercent: suppressionForm.percent,
          suppressionTargetCategory: suppressionForm.category || undefined,
          suppressionTargetGroup: suppressionForm.group || undefined,
        }),
      });
      const d = await r.json();
      showToast(r.ok ? d.message : d.error, r.ok ? "success" : "error");
      if (r.ok) onPartyRefresh();
    } catch {
      showToast("Network error", "error");
    }
    dispatch({ type: "SET_SUPPRESSION_SAVING", payload: false });
  }, [
    partyBaseUrl,
    suppressionForm.percent,
    suppressionForm.category,
    suppressionForm.group,
    showToast,
    onPartyRefresh,
  ]);

  const handleSaveRegistration = useCallback(async () => {
    dispatch({ type: "SET_REGISTRATION_SAVING", payload: true });
    try {
      const r = await fetch(`${partyBaseUrl}/registration-drive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registrationBudgetPercent: registrationForm.percent }),
      });
      const d = await r.json();
      showToast(r.ok ? d.message : d.error, r.ok ? "success" : "error");
      if (r.ok) onPartyRefresh();
    } catch {
      showToast("Network error", "error");
    }
    dispatch({ type: "SET_REGISTRATION_SAVING", payload: false });
  }, [partyBaseUrl, registrationForm.percent, showToast, onPartyRefresh]);

  const handleTransfer = useCallback(async () => {
    if (!transferForm.state) {
      dispatch({ type: "SET_MSG", payload: "✗ Select a state" });
      return;
    }
    // Post-Phase-6: treasury endpoints expect amounts in the party's local
    // home currency — same units the user is typing. No anchor conversion.
    const amount = Math.round(parseMoneyAmountInput(transferForm.amount));
    if (!Number.isFinite(amount) || amount <= 0) {
      dispatch({ type: "SET_MSG", payload: "✗ Enter a valid amount" });
      return;
    }
    const partySymbol = CURRENCY_SYMBOLS[partyCurrencyCode];
    if (amount < 1000) {
      dispatch({
        type: "SET_MSG",
        payload: `✗ Minimum transfer is ${partySymbol}1,000`,
      });
      return;
    }
    dispatch({ type: "SET_TRANSFERRING", payload: true });
    await apiPost(
      `${partyBaseUrl}/transfer`,
      { stateId: transferForm.state, amount },
      {
        onOk: () => {
          dispatch({ type: "RESET_TRANSFER" });
        },
        // Server-side message reflects the actual outcome — "Transferred"
        // when in single-approval mode and the transfer executed
        // immediately, or "Proposed ... Awaiting second approver." when
        // in double-approval mode. Don't override with a hardcoded
        // success string.
      }
    );
    dispatch({ type: "SET_TRANSFERRING", payload: false });
  }, [apiPost, partyBaseUrl, transferForm.state, transferForm.amount, partyCurrencyCode]);

  const handleSaveTreasuryPlan = useCallback(async () => {
    // Post-Phase-6: reserves are persisted in the party's local home currency
    // — same units the player typed and the same units the runtime reserve
    // check compares against `party.treasury`. No anchor conversion.
    const transferReserveAmount = Math.max(
      0,
      Math.round(parseMoneyAmountInput(reserveForm.transferReserveAmount) || 0)
    );
    const memberSupportReserveAmount = Math.max(
      0,
      Math.round(parseMoneyAmountInput(reserveForm.memberSupportReserveAmount) || 0)
    );
    const nppRecruitmentReserveAmount = Math.max(
      0,
      Math.round(parseMoneyAmountInput(reserveForm.nppRecruitmentReserveAmount) || 0)
    );

    dispatch({ type: "SET_RESERVE_SAVING", payload: true });
    await apiPost(`${partyBaseUrl}/treasury-plan`, {
      transferReserveAmount,
      memberSupportReserveAmount,
      nppRecruitmentReserveAmount,
      gotvBudgetPercent: gotvForm.percent,
      suppressionBudgetPercent: suppressionForm.percent,
      treasuryPreset,
    });
    dispatch({ type: "SET_RESERVE_SAVING", payload: false });
  }, [
    apiPost,
    partyBaseUrl,
    reserveForm,
    gotvForm.percent,
    suppressionForm.percent,
    treasuryPreset,
  ]);

  const handleApplyPreset = useCallback(
    (preset: Exclude<TreasuryPresetId, "custom">) => {
      const values = getNationalTreasuryPresetValues(preset, {
        expectedHourlyIncome: party.expectedHourlyIncome,
      });
      setTreasuryPreset(preset);
      dispatch({
        type: "SYNC_RESERVE_FORM",
        payload: {
          transferReserveAmount: formatTreasuryReserveInputValue(values.transferReserveAmount),
          memberSupportReserveAmount: formatTreasuryReserveInputValue(
            values.memberSupportReserveAmount
          ),
          nppRecruitmentReserveAmount: formatTreasuryReserveInputValue(
            values.nppRecruitmentReserveAmount
          ),
        },
      });
      dispatch({ type: "SET_GOTV", field: "percent", value: values.gotvBudgetPercent });
      dispatch({
        type: "SET_SUPPRESSION",
        field: "percent",
        value: values.suppressionBudgetPercent,
      });
    },
    [party.expectedHourlyIncome]
  );

  const handleSendToMember = useCallback(async () => {
    if (!sendForm.memberId) {
      dispatch({ type: "SET_MSG", payload: "✗ Select a member" });
      return;
    }
    // Post-Phase-6: treasury and recipient campaign balance are both in the
    // party's local home currency — pass the user's typed amount through.
    const amount = Math.round(parseMoneyAmountInput(sendForm.amount));
    if (!Number.isFinite(amount) || amount <= 0) {
      dispatch({ type: "SET_MSG", payload: "✗ Enter a valid amount" });
      return;
    }
    const partySymbol = CURRENCY_SYMBOLS[partyCurrencyCode];
    if (amount < 1000) {
      dispatch({
        type: "SET_MSG",
        payload: `✗ Minimum send is ${partySymbol}1,000`,
      });
      return;
    }
    dispatch({ type: "SET_SENDING", payload: true });
    await apiPost(
      `${partyBaseUrl}/send`,
      { characterId: sendForm.memberId, amount },
      {
        onOk: () => {
          dispatch({ type: "RESET_SEND" });
        },
        // Server-side message reflects the actual outcome — "Sent ..."
        // when in single-approval mode and the send executed
        // immediately, or "Proposed ... Awaiting second approver." when
        // in double-approval mode. Don't override with a hardcoded
        // success string.
      }
    );
    dispatch({ type: "SET_SENDING", payload: false });
  }, [apiPost, partyBaseUrl, sendForm.memberId, sendForm.amount, partyCurrencyCode]);

  const handleDonate = useCallback(async () => {
    // Post-Phase-6: donor campaign balance and party treasury are both in
    // the party's local home currency (same-country guard on the route).
    const amount = Math.round(parseMoneyAmountInput(donateForm.amount));
    if (!Number.isFinite(amount) || amount <= 0) {
      dispatch({ type: "SET_MSG", payload: "✗ Enter a valid amount" });
      return;
    }
    const partySymbol = CURRENCY_SYMBOLS[partyCurrencyCode];
    if (amount < 1000) {
      dispatch({
        type: "SET_MSG",
        payload: `✗ Minimum donation is ${partySymbol}1,000`,
      });
      return;
    }
    dispatch({ type: "SET_DONATING", payload: true });
    await apiPost(
      `${partyBaseUrl}/donate`,
      { amount },
      {
        onOk: () => {
          dispatch({ type: "RESET_DONATE" });
          onUserRefresh?.();
        },
        successMessage: `Donated ${partySymbol}${amount.toLocaleString("en-US")} to ${party.name}`,
      }
    );
    dispatch({ type: "SET_DONATING", payload: false });
  }, [apiPost, partyBaseUrl, donateForm.amount, onUserRefresh, partyCurrencyCode, party.name]);

  // Computed values for display
  // netIncome uses the server-computed value which includes the psInvestmentBudget debit.
  const netIncome = party.netHourlyTreasuryChange;
  const psEstimatedSpend = Math.max(
    0,
    party.expectedHourlyIncome -
      party.gotvEstimatedSpend -
      party.suppressionEstimatedSpend -
      party.registrationEstimatedSpend -
      netIncome
  );
  const totalSpending =
    party.gotvEstimatedSpend +
    party.suppressionEstimatedSpend +
    party.registrationEstimatedSpend +
    psEstimatedSpend;
  const revenue = party.expectedHourlyIncome;
  const gotvPct = revenue > 0 ? (party.gotvEstimatedSpend / revenue) * 100 : 0;
  const supPct = revenue > 0 ? (party.suppressionEstimatedSpend / revenue) * 100 : 0;
  const psPct = revenue > 0 ? (psEstimatedSpend / revenue) * 100 : 0;
  const netPct = revenue > 0 ? Math.max(0, (netIncome / revenue) * 100) : 100;

  const totalBudgetPct = gotvForm.percent + suppressionForm.percent;
  const treasuryPlanDirty =
    reserveForm.transferReserveAmount !== reserveDisplayValues.transferReserveAmount ||
    reserveForm.memberSupportReserveAmount !== reserveDisplayValues.memberSupportReserveAmount ||
    reserveForm.nppRecruitmentReserveAmount !== reserveDisplayValues.nppRecruitmentReserveAmount ||
    gotvForm.percent !== party.gotvBudgetPercent ||
    suppressionForm.percent !== party.suppressionBudgetPercent ||
    treasuryPreset !== (party.treasuryPreset ?? "custom");

  return (
    <div className="space-y-8">
      {/* Donate to National Party — members only */}
      {isInParty && (
        <div className="rounded-xl border border-card-border bg-card overflow-hidden">
          {msg && (
            <div
              className={`px-6 py-3 border-b border-card-border/40 text-sm ${getMessageStyle(msg)}`}
            >
              {msg}
            </div>
          )}
          <div className="px-6 py-5">
            <div className="flex items-center gap-2 mb-3">
              <svg
                className="h-4 w-4 text-success"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted">
                Donate to National Party
              </div>
            </div>
            <p className="text-[11px] text-muted/60 mb-3">
              Contribute your personal funds to the national party treasury. Funds support GOTV,
              state transfers, and other party operations.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="number"
                placeholder="Amount"
                value={donateForm.amount}
                onChange={(e) => dispatch({ type: "SET_DONATE_AMOUNT", payload: e.target.value })}
                className="w-36 bg-background py-2 text-sm"
              />
              <button
                onClick={handleDonate}
                disabled={donateForm.donating}
                className="rounded-lg px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
                style={{ backgroundColor: party.color, color: contrastTextColor(party.color) }}
              >
                {donateForm.donating ? "Donating…" : "Donate"}
              </button>
            </div>
            <div className="mt-1 text-xs text-muted">
              Your funds: {fmt(user?.character?.funds ?? 0, party.countryId)} · Min.{" "}
              {CURRENCY_SYMBOLS[partyCurrencyCode]}1,000
            </div>
          </div>
        </div>
      )}

      {/* Treasury Overview */}
      <TreasuryOverview
        party={party}
        countryId={countryId}
        isInParty={isInParty}
        isAdmin={isAdmin}
        netIncome={netIncome}
        totalSpending={totalSpending}
        revenue={revenue}
        gotvPct={gotvPct}
        supPct={supPct}
        psPct={psPct}
        netPct={netPct}
      />

      {/* Management Controls — chair/treasurer/admin only */}
      {canManageTreasury && (
        <TreasuryPlanningCard
          title="National Treasurer Dashboard"
          description="The Treasurer sets soft reserve targets for transfers, member support, and NPP recruiting. Chair and Vice Chair still keep emergency spending access, but sends and transfers that pierce the reserve are flagged as override actions."
          canEdit={canManageTreasuryPlan}
          treasury={party.treasury}
          currencyCode={partyCurrencyCode}
          transferReserveAmount={reserveForm.transferReserveAmount}
          memberSupportReserveAmount={reserveForm.memberSupportReserveAmount}
          nppRecruitmentReserveAmount={reserveForm.nppRecruitmentReserveAmount}
          totalReserveTarget={party.totalReserveTarget}
          discretionaryTreasury={party.discretionaryTreasury}
          netHourlyTreasuryChange={party.netHourlyTreasuryChange}
          turnsUntilZero={party.turnsUntilZero}
          turnsUntilReserveFloor={party.turnsUntilReserveFloor}
          turnsToReachReserveFloor={party.turnsToReachReserveFloor}
          saving={reserveForm.saving}
          saveDisabled={!treasuryPlanDirty || reserveForm.saving}
          accentColor={party.color}
          treasuryPreset={treasuryPreset}
          presetOptions={presetOptions}
          budgetSummary={[
            { label: "GOTV", value: `${gotvForm.percent}%` },
            { label: "Suppression", value: `${suppressionForm.percent}%` },
          ]}
          onPresetSelect={handleApplyPreset}
          onFieldChange={(field, value) => {
            setTreasuryPreset("custom");
            dispatch({ type: "SET_RESERVE", field, value });
          }}
          onSave={handleSaveTreasuryPlan}
        />
      )}

      {canViewTreasuryInsights && insights && (
        <>
          <TreasuryFundingInsightsCard
            currencyCode={partyCurrencyCode}
            recentTransferRecipients={insights.recentTransferRecipients}
            lowestTreasuryStates={insights.lowestTreasuryStates}
            growthLeaders={insights.growthLeaders}
          />
          <TreasuryOverrideHistoryCard
            title="Leadership Override Log"
            description="Recent sends and transfers that pierced the Treasurer reserve target. Leadership can still spend through the plan, but those actions are surfaced here for accountability."
            currencyCode={partyCurrencyCode}
            items={insights.overrideHistory}
          />
        </>
      )}

      {canViewTreasuryInsights && !insights && (
        <div className="rounded-xl border border-card-border bg-card p-5 text-sm text-muted">
          Loading treasury insights...
        </div>
      )}

      {canManageTreasury && (
        <div className="rounded-xl border border-card-border bg-card overflow-hidden">
          {msg && (
            <div
              className={`px-6 py-3 border-b border-card-border/40 text-sm ${getMessageStyle(msg)}`}
            >
              {msg}
            </div>
          )}

          {/* Tax Rate — visible to all canManageTreasury; editable only by chair/VC/admin */}
          {canManageTreasury && (
            <div className="px-6 py-5 border-b border-card-border/40">
              <div className="flex items-center gap-2 mb-3">
                <svg
                  className="h-4 w-4 text-muted"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2zM10 8.5a.5.5 0 11-1 0 .5.5 0 011 0zm5 5a.5.5 0 11-1 0 .5.5 0 011 0z"
                  />
                </svg>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted">
                  National Tax Rate
                </div>
                {!canManageTax && (
                  <span className="text-[10px] uppercase tracking-wider text-muted/60">
                    view-only
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4">
                <Slider
                  min={0}
                  max={33}
                  value={taxForm.rate}
                  onChange={(e) =>
                    dispatch({ type: "SET_TAX_RATE", payload: parseInt(e.target.value) })
                  }
                  variant="primary"
                  className={`flex-1 max-w-48 ${!canManageTax ? "opacity-50 cursor-not-allowed pointer-events-none" : ""}`}
                  disabled={!canManageTax}
                />
                <span className="text-lg font-bold tabular-nums w-12 text-right">
                  {taxForm.rate}%
                </span>
                {canManageTax && taxForm.rate !== party.nationalTaxRate && (
                  <button
                    onClick={handleSaveTax}
                    disabled={taxForm.saving}
                    className="rounded-lg px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
                    style={{ backgroundColor: party.color, color: contrastTextColor(party.color) }}
                  >
                    {taxForm.saving ? "Saving…" : "Save"}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* PS Investment Budget — chair/VC/treasurer/admin */}
          {canManageBudgets && (
            <PsInvestmentBlock
              partyColor={party.color}
              psInvestmentBudget={psInvestmentBudget}
              setPsInvestmentBudget={setPsInvestmentBudget}
              savingPsInvestment={savingPsInvestment}
              handleSavePsInvestment={handleSavePsInvestment}
              psInvestmentRateDisplay={psInvestmentRateDisplay}
              psInvestmentMaxDisplay={psInvestmentMaxDisplay}
              flatPassivePerTurn={NATIONAL_PASSIVE_PS_PER_TURN}
              treasury={party.treasury}
              countryId={party.countryId}
            />
          )}

          {/* Budget Total Indicator — chair/VC/treasurer/admin */}
          {canManageBudgets && totalBudgetPct > 0 && (
            <div className="px-6 py-3 border-b border-card-border/40 bg-background/20">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Total Budget Allocation
                </span>
                <span
                  className={`text-sm font-bold tabular-nums ${totalBudgetPct > 50 ? "text-error" : totalBudgetPct > 25 ? "text-warning" : "text-foreground"}`}
                >
                  {totalBudgetPct}%{" "}
                  <span className="text-xs font-normal text-muted">of revenue</span>
                </span>
              </div>
            </div>
          )}

          {/* GOTV Budget — chair/VC/treasurer/admin */}
          {canManageBudgets && (
            <TreasuryGotvControl
              party={party}
              countryId={countryId}
              gotvForm={gotvForm}
              dispatch={dispatchWithPreset}
              onSave={handleSaveGotv}
            />
          )}

          {/* Voter Registration Drive (suggestion #81) — chair/VC/treasurer/admin */}
          {canManageBudgets && (
            <TreasuryRegistrationControl
              party={party}
              registrationForm={registrationForm}
              dispatch={dispatch}
              onSave={handleSaveRegistration}
            />
          )}

          {/* Voter Suppression — chair/VC/treasurer/admin */}
          {canManageBudgets && (
            <TreasurySuppressionControl
              party={party}
              countryId={countryId}
              suppressionForm={suppressionForm}
              dispatch={dispatchWithPreset}
              onSave={handleSaveSuppression}
            />
          )}

          {/* Transfer to State + Send to Member */}
          {canManageTreasury && (
            <TreasuryTransferControls
              party={party}
              countryId={countryId}
              transferForm={transferForm}
              sendForm={sendForm}
              sortedMembers={sortedMembers}
              dispatch={dispatch}
              onTransfer={handleTransfer}
              onSendToMember={handleSendToMember}
            />
          )}
        </div>
      )}
    </div>
  );
}
