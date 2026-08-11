"use client";

import { Input, Slider } from "@/components/ui";
import { PsInvestmentBlock } from "./PsInvestmentBlock";
import { STATE_PASSIVE_PS_PER_TURN } from "@/lib/politicalStrength/strengthConstants";
import {
  DOLLARS_PER_TURNOUT_POINT,
  calculateAlignmentMultiplier,
  getTargetableDemographics,
  getTargetableCategories,
  getCategoryLabels,
  getDemographicLabels,
} from "@/lib/utils/demographicAlignment";
import { getMessageStyle } from "@/lib/utils/formatters";
import type { StatePartyData } from "./types";
import { fmt } from "./helpers";

interface FundraisingManagementSectionProps {
  stateParty: StatePartyData;
  countryId: string;
  canManageTreas: boolean;
  canChangeTax: boolean;
  // Tax rate
  taxRate: number;
  setTaxRate: (v: number) => void;
  savingTax: boolean;
  handleSaveTax: () => void;
  // PS Investment budget (display-currency string input)
  psInvestmentBudget: string;
  setPsInvestmentBudget: (v: string) => void;
  savingPsInvestment: boolean;
  handleSavePsInvestment: () => void;
  /** Per-+1 PS investment cost in the party's local currency (label only). */
  psInvestmentRateDisplay: number;
  /** Maximum acceptable budget in the party's local currency (label / max only). */
  psInvestmentMaxDisplay: number;
  // GOTV
  gotvPercent: number;
  setGotvPercent: (v: number) => void;
  gotvCategory: string;
  setGotvCategory: (v: string) => void;
  gotvGroup: string;
  setGotvGroup: (v: string) => void;
  savingGotv: boolean;
  handleSaveGotv: () => void;
  // Suppression
  suppressionPercent: number;
  setSuppressionPercent: (v: number) => void;
  suppressionCategory: string;
  setSuppressionCategory: (v: string) => void;
  suppressionGroup: string;
  setSuppressionGroup: (v: string) => void;
  savingSuppression: boolean;
  handleSaveSuppression: () => void;
  // Transfer
  transferAmount: string;
  setTransferAmount: (v: string) => void;
  transferring: boolean;
  handleTransfer: () => void;
  // Send to Member
  sendMemberId: string;
  setSendMemberId: (v: string) => void;
  sendAmount: string;
  setSendAmount: (v: string) => void;
  sending: boolean;
  handleSendToMember: () => void;
  // Status message
  msg: string;
  // Sorted members (non-NPP)
  sortedMembers: Array<{ id: string; name: string; isNPP: boolean }>;
  // Computed budget totals
  totalBudgetPct: number;
}

export function FundraisingManagementSection({
  stateParty,
  countryId,
  canManageTreas,
  canChangeTax,
  taxRate,
  setTaxRate,
  savingTax,
  handleSaveTax,
  psInvestmentBudget,
  setPsInvestmentBudget,
  savingPsInvestment,
  handleSavePsInvestment,
  psInvestmentRateDisplay,
  psInvestmentMaxDisplay,
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
  totalBudgetPct,
}: FundraisingManagementSectionProps) {
  // Country-aware demographics
  const targetableDemos = getTargetableDemographics(countryId);
  const targetableCategories = getTargetableCategories(countryId);
  const CATEGORY_LABELS = getCategoryLabels(countryId);
  const DEMOGRAPHIC_LABELS = getDemographicLabels(countryId);

  // GOTV computed
  const gotvSpend = Math.floor(stateParty.expectedHourlyIncome * (gotvPercent / 100));
  const selectedGotvDemo =
    gotvCategory && gotvGroup
      ? targetableDemos.find((d) => d.category === gotvCategory && d.group === gotvGroup)
      : null;
  const gotvAlignMult = selectedGotvDemo
    ? calculateAlignmentMultiplier(
        stateParty.economicPosition,
        stateParty.socialPosition,
        selectedGotvDemo.economicLean,
        selectedGotvDemo.socialLean
      )
    : 0;
  const gotvEstBoost = selectedGotvDemo
    ? (gotvSpend / DOLLARS_PER_TURNOUT_POINT) * gotvAlignMult
    : 0;
  const gotvDirty =
    gotvPercent !== stateParty.gotvBudgetPercent ||
    gotvCategory !== (stateParty.gotvTargetCategory ?? "") ||
    gotvGroup !== (stateParty.gotvTargetGroup ?? "");
  const gotvNeedsTarget = gotvPercent > 0 && (!gotvCategory || !gotvGroup);
  const groupsForGotvCat = targetableDemos.filter((d) => d.category === gotvCategory);

  // Suppression computed
  const supSpend = Math.floor(stateParty.expectedHourlyIncome * (suppressionPercent / 100));
  const selectedSupDemo =
    suppressionCategory && suppressionGroup
      ? targetableDemos.find(
          (d) => d.category === suppressionCategory && d.group === suppressionGroup
        )
      : null;
  const supAlignMult = selectedSupDemo
    ? calculateAlignmentMultiplier(
        stateParty.economicPosition,
        stateParty.socialPosition,
        selectedSupDemo.economicLean,
        selectedSupDemo.socialLean
      )
    : 0;
  const supEstBoost = selectedSupDemo ? (supSpend / DOLLARS_PER_TURNOUT_POINT) * supAlignMult : 0;
  const supDirty =
    suppressionPercent !== stateParty.suppressionBudgetPercent ||
    suppressionCategory !== (stateParty.suppressionTargetCategory ?? "") ||
    suppressionGroup !== (stateParty.suppressionTargetGroup ?? "");
  const supNeedsTarget = suppressionPercent > 0 && (!suppressionCategory || !suppressionGroup);
  const groupsForSupCat = targetableDemos.filter((d) => d.category === suppressionCategory);

  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden">
      {msg && (
        <div className={`px-6 py-3 border-b border-card-border/40 text-sm ${getMessageStyle(msg)}`}>
          {msg}
        </div>
      )}

      {/* Tax Rate */}
      {canChangeTax && (
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
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">Tax Rate</div>
          </div>
          <div className="flex items-center gap-4">
            <Slider
              min={0}
              max={33}
              value={taxRate}
              onChange={(e) => setTaxRate(parseInt(e.target.value))}
              variant="primary"
              className="flex-1 max-w-48"
            />
            <span className="text-lg font-bold tabular-nums w-12 text-right">{taxRate}%</span>
            {taxRate !== stateParty.stateTaxRate && (
              <button
                onClick={handleSaveTax}
                disabled={savingTax}
                className="rounded-lg px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                style={{ backgroundColor: stateParty.partyColor }}
              >
                {savingTax ? "Saving…" : "Save"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* PS Investment Budget */}
      {canManageTreas && (
        <PsInvestmentBlock
          partyColor={stateParty.partyColor}
          psInvestmentBudget={psInvestmentBudget}
          setPsInvestmentBudget={setPsInvestmentBudget}
          savingPsInvestment={savingPsInvestment}
          handleSavePsInvestment={handleSavePsInvestment}
          psInvestmentRateDisplay={psInvestmentRateDisplay}
          psInvestmentMaxDisplay={psInvestmentMaxDisplay}
          flatPassivePerTurn={STATE_PASSIVE_PS_PER_TURN}
          treasury={stateParty.treasury}
          countryId={countryId}
        />
      )}

      {/* Budget Total Indicator */}
      {canChangeTax && totalBudgetPct > 0 && (
        <div className="px-6 py-3 border-b border-card-border/40 bg-background/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">
              Total Budget Allocation
            </span>
            <span
              className={`text-sm font-bold tabular-nums ${
                totalBudgetPct > 50
                  ? "text-error"
                  : totalBudgetPct > 25
                    ? "text-warning"
                    : "text-foreground"
              }`}
            >
              {totalBudgetPct}% <span className="text-xs font-normal text-muted">of revenue</span>
            </span>
          </div>
        </div>
      )}

      {/* GOTV Budget */}
      {canChangeTax && (
        <div className="px-6 py-5 border-b border-card-border/40 border-l-[3px] border-l-primary/40">
          <div className="flex items-center gap-2 mb-1">
            <svg
              className="h-4 w-4 text-primary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"
              />
            </svg>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">
              GOTV — Get Out the Vote
            </div>
          </div>
          <p className="text-[11px] text-muted/60 mb-3 ml-6">
            Rally your base. Boost voter turnout for a targeted demographic through door-knocking,
            phone banking, and voter drives.
          </p>

          <div className="flex items-center gap-4">
            <Slider
              min={0}
              max={25}
              value={gotvPercent}
              onChange={(e) => setGotvPercent(parseInt(e.target.value))}
              variant="primary"
              className="flex-1 max-w-48"
            />
            <span className="text-lg font-bold tabular-nums w-12 text-right">{gotvPercent}%</span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              value={gotvCategory}
              onChange={(e) => {
                setGotvCategory(e.target.value);
                setGotvGroup("");
              }}
              className="rounded-lg border border-card-border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">Category…</option>
              {targetableCategories.map((cat) => (
                <option key={cat} value={cat}>
                  {CATEGORY_LABELS[cat] ?? cat}
                </option>
              ))}
            </select>
            <select
              value={gotvGroup}
              onChange={(e) => setGotvGroup(e.target.value)}
              disabled={!gotvCategory}
              className="rounded-lg border border-card-border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-40"
            >
              <option value="">Demographic…</option>
              {groupsForGotvCat.map((d) => (
                <option key={d.group} value={d.group}>
                  {DEMOGRAPHIC_LABELS[d.group] ?? d.group}
                </option>
              ))}
            </select>
            {gotvDirty && (
              <button
                onClick={handleSaveGotv}
                disabled={savingGotv || gotvNeedsTarget}
                className="rounded-lg px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                style={{ backgroundColor: stateParty.partyColor }}
              >
                {savingGotv ? "Saving…" : "Save"}
              </button>
            )}
          </div>

          {gotvNeedsTarget && (
            <p className="mt-2 text-xs text-error flex items-center gap-1.5 ml-6">
              <svg
                className="h-3 w-3 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              Select a target demographic to activate GOTV spending
            </p>
          )}
          {gotvPercent > 0 && selectedGotvDemo && (
            <div className="mt-3 ml-6 rounded-lg bg-background/50 border border-card-border/30 p-3 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted">Spending</span>
                <span className="font-semibold tabular-nums">{fmt(gotvSpend, countryId)} / hr</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted">Alignment efficacy</span>
                <span
                  className={`font-semibold tabular-nums ${
                    gotvAlignMult >= 0.5 ? "text-success" : "text-warning"
                  }`}
                >
                  {Math.round(gotvAlignMult * 100)}%
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted">Est. turnout boost</span>
                <span className="font-bold tabular-nums text-success">
                  +{gotvEstBoost.toFixed(3)}% / turn
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Voter Suppression */}
      {canChangeTax && (
        <div className="px-6 py-5 border-b border-card-border/40 border-l-[3px] border-l-error/40">
          <div className="flex items-center gap-2 mb-1">
            <svg
              className="h-4 w-4 text-error"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
              />
            </svg>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">
              Voter Suppression
            </div>
          </div>
          <p className="text-[11px] text-muted/60 mb-3 ml-6">
            Dirty tricks. Spread misinformation, intimidate voters, and reduce turnout among an
            opposing demographic.
          </p>

          <div className="flex items-center gap-4">
            <Slider
              min={0}
              max={25}
              value={suppressionPercent}
              onChange={(e) => setSuppressionPercent(parseInt(e.target.value))}
              variant="error"
              className="flex-1 max-w-48"
            />
            <span className="text-lg font-bold tabular-nums w-12 text-right">
              {suppressionPercent}%
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              value={suppressionCategory}
              onChange={(e) => {
                setSuppressionCategory(e.target.value);
                setSuppressionGroup("");
              }}
              className="rounded-lg border border-card-border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">Category…</option>
              {targetableCategories.map((cat) => (
                <option key={cat} value={cat}>
                  {CATEGORY_LABELS[cat] ?? cat}
                </option>
              ))}
            </select>
            <select
              value={suppressionGroup}
              onChange={(e) => setSuppressionGroup(e.target.value)}
              disabled={!suppressionCategory}
              className="rounded-lg border border-card-border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-40"
            >
              <option value="">Demographic…</option>
              {groupsForSupCat.map((d) => (
                <option key={d.group} value={d.group}>
                  {DEMOGRAPHIC_LABELS[d.group] ?? d.group}
                </option>
              ))}
            </select>
            {supDirty && (
              <button
                onClick={handleSaveSuppression}
                disabled={savingSuppression || supNeedsTarget}
                className="rounded-lg px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity bg-error"
              >
                {savingSuppression ? "Saving…" : "Save"}
              </button>
            )}
          </div>

          {supNeedsTarget && (
            <p className="mt-2 text-xs text-error flex items-center gap-1.5 ml-6">
              <svg
                className="h-3 w-3 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              Select a target demographic to activate suppression spending
            </p>
          )}
          {suppressionPercent > 0 && selectedSupDemo && (
            <div className="mt-3 ml-6 rounded-lg bg-background/50 border border-card-border/30 p-3 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted">Spending</span>
                <span className="font-semibold tabular-nums">{fmt(supSpend, countryId)} / hr</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted">Counter-alignment</span>
                <span
                  className={`font-semibold tabular-nums ${
                    supAlignMult >= 0.5 ? "text-error" : "text-warning"
                  }`}
                >
                  {Math.round(supAlignMult * 100)}%
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted">Est. turnout reduction</span>
                <span className="font-bold tabular-nums text-error">
                  -{supEstBoost.toFixed(3)}% / turn
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Transfer to National */}
      {canManageTreas && (
        <div className="px-6 py-5 border-b border-card-border/40">
          <div className="flex items-center gap-2 mb-3">
            <svg
              className="h-4 w-4 text-muted"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 11l5-5m0 0l5 5m-5-5v12" />
            </svg>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">
              Transfer to National Party
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="number"
              placeholder="Amount"
              value={transferAmount}
              onChange={(e) => setTransferAmount(e.target.value)}
              className="w-36 bg-background py-2 text-sm"
            />
            <button
              onClick={handleTransfer}
              disabled={transferring}
              className="rounded-lg px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
              style={{ backgroundColor: stateParty.partyColor }}
            >
              {transferring ? "…" : "Transfer"}
            </button>
          </div>
          <div className="mt-1 text-xs text-muted">
            Available: {fmt(stateParty.treasury, countryId)} · Min. {fmt(1000, countryId)}
          </div>
        </div>
      )}

      {/* Send to Member */}
      <div className="px-6 py-5">
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
              d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
            />
          </svg>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">
            Send to Member
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={sendMemberId}
            onChange={(e) => setSendMemberId(e.target.value)}
            className="rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">Select member…</option>
            {sortedMembers
              .filter((m) => !m.isNPP)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
          <Input
            type="number"
            placeholder="Amount"
            value={sendAmount}
            onChange={(e) => setSendAmount(e.target.value)}
            className="w-32 bg-background py-2 text-sm"
          />
          <button
            onClick={handleSendToMember}
            disabled={sending}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
            style={{ backgroundColor: stateParty.partyColor }}
          >
            {sending ? "…" : "Send"}
          </button>
        </div>
        <div className="mt-1 text-xs text-muted">
          Available: {fmt(stateParty.treasury, countryId)} · Min. {fmt(1000, countryId)}
        </div>
      </div>
    </div>
  );
}
