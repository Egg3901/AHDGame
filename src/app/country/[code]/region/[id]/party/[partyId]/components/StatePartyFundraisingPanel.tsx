"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui";
import { TreasuryPlanningCard } from "@/components/party/TreasuryPlanningCard";
import { TreasuryOverrideHistoryCard } from "@/components/party/TreasuryOverrideHistoryCard";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { formatTreasuryReserveInputValue } from "@/lib/currency/treasuryReserveDisplay";
import {
  PS_INVESTMENT_MAX_TIERS,
  psInvestmentRate,
} from "@/lib/politicalStrength/strengthConstants";
import { getMessageStyle } from "@/lib/utils/formatters";
import { contrastTextColor } from "@/lib/utils/colorContrast";
import {
  getStateTreasuryPresetValues,
  getTreasuryPresetOptions,
} from "@/lib/treasury/partyTreasuryPresets";
import type { StateTreasuryInsights } from "@/lib/treasury/partyTreasuryInsights";
import { regionPartyApiUrl } from "@/lib/urls";
import type { StatePartyFundraisingPanelProps } from "./fundraisingTypes";
import { fmt } from "./helpers";
import { FundraisingManagementSection } from "./FundraisingManagementSection";
import { TreasuryOverviewSection } from "./TreasuryOverviewSection";

export function StatePartyFundraisingPanel({
  stateParty,
  user,
  isMember,
  canManageTreas,
  canManageTreasuryPlan,
  canChangeTax,
  taxRate,
  setTaxRate,
  savingTax,
  handleSaveTax,
  psInvestmentBudget,
  setPsInvestmentBudget,
  savingPsInvestment,
  handleSavePsInvestment,
  gotvPercent,
  setGotvPercent,
  gotvCategory,
  setGotvCategory,
  gotvGroup,
  setGotvGroup,
  savingGotv,
  handleSaveGotv,
  suppressionPercent,
  setSuppressionPercent,
  suppressionCategory,
  setSuppressionCategory,
  suppressionGroup,
  setSuppressionGroup,
  savingSuppression,
  handleSaveSuppression,
  transferReserveAmount,
  setTransferReserveAmount,
  memberSupportReserveAmount,
  setMemberSupportReserveAmount,
  nppRecruitmentReserveAmount,
  setNppRecruitmentReserveAmount,
  treasuryPreset,
  setTreasuryPreset,
  savingTreasuryPlan,
  handleSaveTreasuryPlan,
  transferAmount,
  setTransferAmount,
  transferring,
  handleTransfer,
  sendMemberId,
  setSendMemberId,
  sendAmount,
  setSendAmount,
  sending,
  handleSendToMember,
  msg,
  sortedMembers,
  donateAmount,
  setDonateAmount,
  donating,
  handleDonate,
}: StatePartyFundraisingPanelProps) {
  const partyApiBase = regionPartyApiUrl(
    stateParty.countryId,
    stateParty.stateId,
    stateParty.partyId
  );
  // netIncome uses the server-computed value which includes the psInvestmentBudget debit.
  const netIncome = stateParty.netHourlyTreasuryChange;
  const psEstimatedSpend = Math.max(
    0,
    stateParty.expectedHourlyIncome -
      stateParty.gotvEstimatedSpend -
      stateParty.suppressionEstimatedSpend -
      netIncome
  );
  const totalSpending =
    stateParty.gotvEstimatedSpend + stateParty.suppressionEstimatedSpend + psEstimatedSpend;
  const revenue = stateParty.expectedHourlyIncome;
  const gotvPct = revenue > 0 ? (stateParty.gotvEstimatedSpend / revenue) * 100 : 0;
  const supPct = revenue > 0 ? (stateParty.suppressionEstimatedSpend / revenue) * 100 : 0;
  const psPct = revenue > 0 ? (psEstimatedSpend / revenue) * 100 : 0;
  const netPct = revenue > 0 ? Math.max(0, (netIncome / revenue) * 100) : 100;

  const totalBudgetPct = gotvPercent + suppressionPercent;
  const characterFunds = user?.character?.funds ?? 0;
  const currencyCode = COUNTRY_CURRENCY_MAP[stateParty.countryId];
  const presetOptions = useMemo(() => getTreasuryPresetOptions(), []);
  // Post-Phase-6: reserves persist in the state party's local home currency,
  // matching the units the form input and the runtime reserve check use.
  const reserveDisplayValues = useMemo(
    () => ({
      transferReserveAmount: formatTreasuryReserveInputValue(stateParty.transferReserveAmount),
      memberSupportReserveAmount: formatTreasuryReserveInputValue(
        stateParty.memberSupportReserveAmount
      ),
      nppRecruitmentReserveAmount: formatTreasuryReserveInputValue(
        stateParty.nppRecruitmentReserveAmount
      ),
    }),
    [
      stateParty.transferReserveAmount,
      stateParty.memberSupportReserveAmount,
      stateParty.nppRecruitmentReserveAmount,
    ]
  );
  // Post-cf-inconsistency-fix Phase 6: psInvestmentRate returns the documented
  // native-local anchor ($125k US state, £100k UK state, etc.) directly — no
  // forex conversion needed because treasury is now persisted in local
  // currency in the same units.
  const psInvestmentRateDisplay = psInvestmentRate(stateParty.countryId, "state");
  const psInvestmentMaxDisplay = psInvestmentRateDisplay * PS_INVESTMENT_MAX_TIERS;

  const [insights, setInsights] = useState<StateTreasuryInsights | null>(null);
  const emptyInsights = useMemo<StateTreasuryInsights>(() => ({ overrideHistory: [] }), []);

  useEffect(() => {
    if (!canManageTreas) return;
    let cancelled = false;
    fetch(`${partyApiBase}/treasury/insights`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as StateTreasuryInsights;
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
    canManageTreas,
    partyApiBase,
    stateParty.treasury,
    stateParty.transferReserveAmount,
    stateParty.memberSupportReserveAmount,
    stateParty.nppRecruitmentReserveAmount,
    emptyInsights,
  ]);

  const handlePresetSelect = useCallback(
    (preset: "growth" | "election_push" | "member_support" | "reserve_first") => {
      const values = getStateTreasuryPresetValues(preset, {
        expectedHourlyIncome: stateParty.expectedHourlyIncome,
      });
      setTreasuryPreset(preset);
      setTransferReserveAmount(formatTreasuryReserveInputValue(values.transferReserveAmount));
      setMemberSupportReserveAmount(
        formatTreasuryReserveInputValue(values.memberSupportReserveAmount)
      );
      setNppRecruitmentReserveAmount(
        formatTreasuryReserveInputValue(values.nppRecruitmentReserveAmount)
      );
      setGotvPercent(values.gotvBudgetPercent);
      setSuppressionPercent(values.suppressionBudgetPercent);
    },
    [
      stateParty.expectedHourlyIncome,
      setTreasuryPreset,
      setTransferReserveAmount,
      setMemberSupportReserveAmount,
      setNppRecruitmentReserveAmount,
      setGotvPercent,
      setSuppressionPercent,
    ]
  );

  const treasuryPlanDirty =
    transferReserveAmount !== reserveDisplayValues.transferReserveAmount ||
    memberSupportReserveAmount !== reserveDisplayValues.memberSupportReserveAmount ||
    nppRecruitmentReserveAmount !== reserveDisplayValues.nppRecruitmentReserveAmount ||
    gotvPercent !== stateParty.gotvBudgetPercent ||
    suppressionPercent !== stateParty.suppressionBudgetPercent ||
    treasuryPreset !== (stateParty.treasuryPreset ?? "custom");

  return (
    <div className="space-y-5">
      <TreasuryOverviewSection
        stateParty={stateParty}
        countryId={stateParty.countryId}
        user={user}
        isMember={isMember}
        netIncome={netIncome}
        totalSpending={totalSpending}
        revenue={revenue}
        gotvPct={gotvPct}
        supPct={supPct}
        psPct={psPct}
        netPct={netPct}
      />

      {canManageTreas && (
        <TreasuryPlanningCard
          title="State Treasurer Dashboard"
          description="The State Treasurer sets soft reserve targets for transfers, member support, and NPP recruiting. State and national leadership still keep emergency spending access, but sends and transfers that pierce the reserve are flagged as override actions."
          canEdit={canManageTreasuryPlan}
          treasury={stateParty.treasury}
          currencyCode={currencyCode}
          transferReserveAmount={transferReserveAmount}
          memberSupportReserveAmount={memberSupportReserveAmount}
          nppRecruitmentReserveAmount={nppRecruitmentReserveAmount}
          totalReserveTarget={stateParty.totalReserveTarget}
          discretionaryTreasury={stateParty.discretionaryTreasury}
          netHourlyTreasuryChange={stateParty.netHourlyTreasuryChange}
          turnsUntilZero={stateParty.turnsUntilZero}
          turnsUntilReserveFloor={stateParty.turnsUntilReserveFloor}
          turnsToReachReserveFloor={stateParty.turnsToReachReserveFloor}
          saving={savingTreasuryPlan}
          saveDisabled={!treasuryPlanDirty || savingTreasuryPlan}
          accentColor={stateParty.partyColor}
          treasuryPreset={treasuryPreset}
          presetOptions={presetOptions}
          budgetSummary={[
            { label: "GOTV", value: `${gotvPercent}%` },
            { label: "Suppression", value: `${suppressionPercent}%` },
          ]}
          onPresetSelect={handlePresetSelect}
          onFieldChange={(field, value) => {
            setTreasuryPreset("custom");
            if (field === "transferReserveAmount") setTransferReserveAmount(value);
            if (field === "memberSupportReserveAmount") setMemberSupportReserveAmount(value);
            if (field === "nppRecruitmentReserveAmount") setNppRecruitmentReserveAmount(value);
          }}
          onSave={handleSaveTreasuryPlan}
        />
      )}

      {canManageTreas && insights && (
        <TreasuryOverrideHistoryCard
          title="State Leadership Override Log"
          description="Recent sends and transfers that pierced the Treasurer reserve target for this state party. Leadership keeps emergency spending access, and those override actions are surfaced here."
          currencyCode={currencyCode}
          items={insights.overrideHistory}
        />
      )}

      {canManageTreas && !insights && (
        <div className="rounded-xl border border-card-border bg-card p-5 text-sm text-muted">
          Loading treasury insights...
        </div>
      )}

      {isMember && (
        <div className="rounded-xl border border-card-border bg-card overflow-hidden">
          {msg && (
            <div
              className={`px-6 py-3 border-b border-card-border/40 text-sm ${getMessageStyle(msg)}`}
            >
              {msg}
            </div>
          )}
          <div className="px-6 py-5">
            <div className="mb-3 flex items-center gap-2">
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
                Donate to State Party
              </div>
            </div>
            <p className="mb-3 text-[11px] text-muted/60">
              Contribute your campaign funds to the state party treasury. Funds support GOTV,
              organization building, and other party operations.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="number"
                placeholder="Amount"
                value={donateAmount}
                onChange={(e) => setDonateAmount(e.target.value)}
                className="w-36 bg-background py-2 text-sm"
              />
              <button
                onClick={handleDonate}
                disabled={donating}
                className="rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{
                  backgroundColor: stateParty.partyColor,
                  color: contrastTextColor(stateParty.partyColor),
                }}
              >
                {donating ? "Donating..." : "Donate"}
              </button>
            </div>
            <div className="mt-1 text-xs text-muted">
              Campaign funds: {fmt(characterFunds, stateParty.countryId)} | Min.{" "}
              {fmt(1000, stateParty.countryId)}
            </div>
          </div>
        </div>
      )}

      {canManageTreas && (
        <FundraisingManagementSection
          stateParty={stateParty}
          countryId={stateParty.countryId}
          canManageTreas={canManageTreas}
          canChangeTax={canChangeTax}
          taxRate={taxRate}
          setTaxRate={setTaxRate}
          savingTax={savingTax}
          handleSaveTax={handleSaveTax}
          psInvestmentBudget={psInvestmentBudget}
          setPsInvestmentBudget={setPsInvestmentBudget}
          savingPsInvestment={savingPsInvestment}
          handleSavePsInvestment={handleSavePsInvestment}
          psInvestmentRateDisplay={psInvestmentRateDisplay}
          psInvestmentMaxDisplay={psInvestmentMaxDisplay}
          gotvPercent={gotvPercent}
          setGotvPercent={(value) => {
            setTreasuryPreset("custom");
            setGotvPercent(value);
          }}
          gotvCategory={gotvCategory}
          setGotvCategory={setGotvCategory}
          gotvGroup={gotvGroup}
          setGotvGroup={setGotvGroup}
          savingGotv={savingGotv}
          handleSaveGotv={handleSaveGotv}
          suppressionPercent={suppressionPercent}
          setSuppressionPercent={(value) => {
            setTreasuryPreset("custom");
            setSuppressionPercent(value);
          }}
          suppressionCategory={suppressionCategory}
          setSuppressionCategory={setSuppressionCategory}
          suppressionGroup={suppressionGroup}
          setSuppressionGroup={setSuppressionGroup}
          savingSuppression={savingSuppression}
          handleSaveSuppression={handleSaveSuppression}
          transferAmount={transferAmount}
          setTransferAmount={setTransferAmount}
          transferring={transferring}
          handleTransfer={handleTransfer}
          sendMemberId={sendMemberId}
          setSendMemberId={setSendMemberId}
          sendAmount={sendAmount}
          setSendAmount={setSendAmount}
          sending={sending}
          handleSendToMember={handleSendToMember}
          msg={msg}
          sortedMembers={sortedMembers}
          totalBudgetPct={totalBudgetPct}
        />
      )}
    </div>
  );
}
