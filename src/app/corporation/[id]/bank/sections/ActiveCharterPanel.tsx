"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { EmptyState, Tooltip } from "@/components/ui";
import { formatBankMoney, formatRatePercent } from "@/components/banking/formatBankMoney";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { assessCapital, borrowingsFromCharter } from "@/lib/banking/capitalAdequacy";
import { Segmented } from "@/components/corporation/dense/DenseKit";
import { BankPanel } from "../components/BankSection";
import type { BankTab, ConsolePayload, ShowToast } from "../types";
import { charterLabel } from "../lib/helpers";
import { StatCell } from "../components/StatCell";
import { HealthCard } from "./HealthCard";
import { RiskPanel } from "./RiskPanel";
import { OutlookStrip } from "./OutlookStrip";
import { RateOffsetEditor } from "./RateOffsetEditor";
import { LoanBookTable } from "./LoanBookTable";
import { BlacklistEditor } from "./BlacklistEditor";
import { CapacityAllocationEditor } from "./CapacityAllocationEditor";
import { DiscountWindowPanel } from "./DiscountWindowPanel";
import { RecapitalizePanel } from "./RecapitalizePanel";
import { PropBookPanel } from "./PropBookPanel";
import { InterbankPanel } from "./InterbankPanel";
import { RevokeCharterForm } from "./RevokeCharterForm";
import { CharterSwitchForm } from "./CharterSwitchForm";
import { CustomerBankPanel } from "./CustomerBankPanel";
import { BankTreasuryPanel } from "./BankTreasuryPanel";

/** CEO toggle for opt-in loan approval. When on, new loans queue as pending. */
function LoanApprovalToggle({
  corporationId,
  requireApproval,
  pendingCount,
  canMutate,
  onChanged,
  showToast,
}: {
  corporationId: string;
  requireApproval: boolean;
  pendingCount: number;
  canMutate: boolean;
  onChanged: () => Promise<void>;
  showToast: ShowToast;
}) {
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/corporations/${corporationId}/bank/approval`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requireApproval: !requireApproval }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(json.error ?? "Could not update approval mode", "error");
        return;
      }
      showToast(
        json.requireApproval
          ? `New loans now need your approval${pendingCount > 0 ? `, starting with the ${pendingCount} waiting` : ""}`
          : "Loans auto-approve again: qualifying requests fund without waiting for you",
        "success"
      );
      await onChanged();
    } catch {
      showToast("Could not update approval mode", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <BankPanel
      kind="ceoControl"
      title="Loan approval"
      actions={
        <Segmented
          ariaLabel="Loan approval"
          options={[
            { value: "auto", label: "Auto-approve" },
            { value: "manual", label: "Approval required" },
          ]}
          value={requireApproval ? "manual" : "auto"}
          onChange={(v) => {
            if ((v === "manual") !== requireApproval) void toggle();
          }}
          disabled={!canMutate || busy}
        />
      }
    >
      <p className="py-1.5 text-xs text-muted">
        {requireApproval
          ? "New loan requests wait for you to approve or decline them in the loan book."
          : "Loan requests are granted automatically when the borrower qualifies."}
      </p>
    </BankPanel>
  );
}

/**
 * Per-turn interest split from the last banking pass: what the bank paid its
 * depositors and lenders versus what its loans earned, and the net interest
 * between them. Every figure is a ledgered amount in the charter currency for
 * one turn, not a rate. Earned and paid lines are magnitudes; only the net
 * and the bottom line carry a sign.
 */
function EarningsBreakdown({ data, onTreasury }: { data: ConsolePayload; onTreasury: () => void }) {
  const t = useTranslations("corporations.bankConsole");
  const charter = data.charter!;
  const depositInterest = charter.lastBankingDepositInterest ?? 0;
  const loanInterest = charter.lastBankingLoanInterest ?? 0;
  const fees = charter.lastBankingLoanOriginationFees ?? 0;
  const underwritingFees = charter.lastBankingUnderwritingFees ?? 0;
  const sovereignCoupons = charter.lastBankingSovereignCoupons ?? 0;
  const ibPaid = charter.lastBankingInterbankInterestPaid ?? 0;
  const ibReceived = charter.lastBankingInterbankInterestReceived ?? 0;
  const facility = charter.lastBankingFacilityInterest ?? 0;
  const premium = charter.lastBankingInsurancePremium ?? 0;
  const writeoffs = charter.lastBankingWriteoffs ?? 0;
  const earned = loanInterest + ibReceived;
  const paid = depositInterest + ibPaid + facility;
  const net = earned - paid;
  const currency = charter.currency;
  // Headline percentages beside the dollar net: annualised over the book that
  // produced it, so the CEO reads margin, not just money.
  const loanBase = Math.max(0, charter.totalLoans);
  const depositBase = Math.max(0, charter.totalDeposits);
  const nim = loanBase > 0 ? (net * TURNS_PER_YEAR * 100) / loanBase : null;
  const costOfFunds = depositBase > 0 ? (paid * TURNS_PER_YEAR * 100) / depositBase : null;

  return (
    <BankPanel
      kind="monitor"
      title={
        <>
          Last turn earnings
          <Tooltip
            content={t("tooltips.netInterest")}
            label={t("about", { label: "Last turn earnings" })}
          />
        </>
      }
    >
      <table className="w-full border-collapse">
        <tbody>
          <EarningsRow
            label="Interest earned"
            detail={`loans ${formatBankMoney(loanInterest, currency)}, interbank received ${formatBankMoney(ibReceived, currency)}`}
            value={formatBankMoney(earned, currency)}
            tooltip={t("tooltips.interestEarned")}
            aboutLabel={t("about", { label: "Interest earned" })}
          />
          <EarningsRow
            label="Interest paid"
            detail={`deposits ${formatBankMoney(depositInterest, currency)}, interbank paid ${formatBankMoney(ibPaid, currency)}, central-bank facilities ${formatBankMoney(facility, currency)}${costOfFunds != null ? `, cost of funds ${costOfFunds.toFixed(2)}%` : ""}`}
            value={formatBankMoney(paid, currency)}
            tooltip={t("tooltips.interestPaid")}
            aboutLabel={t("about", { label: "Interest paid" })}
          />
          <EarningsRow
            label="Net interest"
            detail={
              charter.lastBankingIncomeTurn != null
                ? `banking pass T${charter.lastBankingIncomeTurn}${nim != null ? `, margin ${nim.toFixed(2)}%` : ""}`
                : "awaiting first banking pass"
            }
            value={formatBankMoney(net, currency)}
            tone={net < 0 ? "text-error" : "text-success"}
            tooltip={t("tooltips.netInterest")}
            aboutLabel={t("about", { label: "Net interest" })}
            strong
          />
          <EarningsRow
            label="Insurance and write-offs"
            detail={`premium ${formatBankMoney(premium, currency)}, defaults ${formatBankMoney(writeoffs, currency)}`}
            value={formatBankMoney(premium + writeoffs, currency)}
            tooltip={t("tooltips.otherCharges")}
            aboutLabel={t("about", { label: "Insurance and write-offs" })}
          />
          <EarningsRow
            label={t("originationFees")}
            detail={t("originationFeesDetail", {
              lifetime: formatBankMoney(charter.loanOriginationFeesLifetime ?? 0, currency),
            })}
            value={formatBankMoney(fees, currency)}
            tooltip={t("originationFeesTooltip")}
            aboutLabel={t("about", { label: t("originationFees") })}
          />
          <EarningsRow
            label="Underwriting fees"
            detail="Funded IPO and corporate bond placements"
            value={formatBankMoney(underwritingFees, currency)}
            tooltip="Fees are counted only for proceeds funded by completed market fills."
            aboutLabel="Underwriting fees"
          />
          <EarningsRow
            label="Treasury bill coupons"
            detail="Funded sovereign coupons paid to this charter. Maturity principal is not income."
            value={formatBankMoney(sovereignCoupons, currency)}
            tooltip="Counted only when the Treasury has funded the coupon and the bank vault is credited."
            aboutLabel="Treasury bill coupons"
          />
          <EarningsRow
            label="Bottom line"
            detail={t("feeBottomLine")}
            value={formatBankMoney(charter.lastBankingIncome, currency)}
            tone={charter.lastBankingIncome < 0 ? "text-error" : "text-success"}
            tooltip={t("tooltips.otherCharges")}
            aboutLabel={t("about", { label: "Bottom line" })}
            strong
          />
        </tbody>
      </table>
      <p className="pt-1.5 text-xs text-muted">
        {t("tooltips.takeProfits")}{" "}
        <button
          type="button"
          onClick={onTreasury}
          className="text-foreground underline decoration-card-border underline-offset-2 hover:decoration-foreground"
        >
          Withdraw in Treasury
        </button>
      </p>
    </BankPanel>
  );
}

function EarningsRow({
  label,
  detail,
  value,
  tone,
  tooltip,
  aboutLabel,
  strong = false,
}: {
  label: string;
  detail: string;
  value: string;
  tone?: string;
  tooltip: string;
  aboutLabel: string;
  strong?: boolean;
}) {
  return (
    <tr className={strong ? "font-medium" : undefined}>
      <td className="border-b border-card-border/60 py-1.5 pr-2 text-[13px] text-foreground">
        {label}
        <Tooltip content={tooltip} label={aboutLabel} />
      </td>
      <td className="hidden border-b border-card-border/60 px-2 py-1.5 text-xs text-muted md:table-cell">
        {detail}
      </td>
      <td
        className={`whitespace-nowrap border-b border-card-border/60 py-1.5 pl-2 text-right font-mono text-[13px] tabular-nums ${tone ?? "text-foreground"}`}
      >
        {value}
      </td>
    </tr>
  );
}

export function ActiveCharterPanel({
  data,
  canMutate,
  onChanged,
  showToast,
}: {
  data: ConsolePayload;
  canMutate: boolean;
  onChanged: () => Promise<void>;
  showToast: ShowToast;
}) {
  const t = useTranslations("corporations.bankConsole");
  const charter = data.charter!;
  const depositTaking = charter.type === "retail" || charter.type === "universal";
  const propEligible = charter.type === "investment" || charter.type === "universal";
  const playerPointerDeposits = Math.max(
    0,
    charter.pointerDeposits ?? Math.max(0, charter.totalDeposits - charter.npcDeposits)
  );
  const householdCash = Math.max(0, charter.npcDeposits);
  const investingVisible = propEligible;
  const [tab, setTab] = useState<BankTab>("overview");

  // Attention routing: each red dot names the job that needs the CEO, so the
  // console answers "what needs me?" before any panel is opened. Capital and
  // reserves are different jobs with different levers, so they badge
  // separately rather than sharing one dot for the whole funding tab.
  const pendingCount = data.loans.filter(
    (l) => l.borrowerType !== "npcBulk" && l.status === "pending"
  ).length;
  const capitalStanding = assessCapital({
    cashReserves: charter.cashReserves,
    sovereignTreasuryMarkValue: charter.sovereignTreasuryMarkValue,
    totalLoans: charter.totalLoans,
    borrowings: borrowingsFromCharter(charter),
    propBookMarkValue: charter.propBookMarkValue,
  }).standing;
  const capitalAttention = capitalStanding !== "adequate";
  const reservesAttention = charter.cashReserves < charter.requiredReserves;
  const treasuryHints = [
    capitalAttention ? t("capitalAttention") : null,
    reservesAttention ? t("reservesAttention") : null,
  ].filter((hint): hint is string => hint !== null);
  const treasuryAttention = treasuryHints.length > 0;

  const tabs: { id: BankTab; label: string; badge?: number; alert?: boolean; hint?: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "deposits", label: "Deposits & Rates" },
    {
      id: "lending",
      label: "Lending",
      badge: pendingCount > 0 ? pendingCount : undefined,
      hint: pendingCount > 0 ? t("pendingDecisions", { count: pendingCount }) : undefined,
    },
    {
      id: "treasury",
      label: "Treasury",
      alert: treasuryAttention,
      hint: treasuryAttention ? treasuryHints.join(" · ") : undefined,
    },
    ...(investingVisible ? [{ id: "investing" as const, label: "Investing" }] : []),
    { id: "charter", label: "Charter" },
  ];

  const blacklist = charter.blacklist ? (
    <BlacklistEditor
      corporationId={data.corporation.id}
      blacklist={charter.blacklist}
      availableFunds={data.blacklistableFunds ?? []}
      canMutate={canMutate}
      onChanged={onChanged}
      showToast={showToast}
    />
  ) : null;

  return (
    <div className="space-y-6">
      <HealthCard data={data} />
      {data.risk && (
        <RiskPanel
          risk={data.risk}
          currency={charter.currency}
          pointerDeposits={charter.pointerDeposits}
        />
      )}

      {/* Customer actions are available alongside bank management. A CEO can
          also use the bank as a personal customer. */}
      {data.privateBankingEnabled && charter.status === "active" && (
        <CustomerBankPanel
          corporationId={data.corporation.id}
          bankName={data.corporation.name}
          currency={charter.currency}
          depositTaking={depositTaking}
          depositRatePercent={data.rates?.depositRatePercent ?? null}
          onChanged={() => void onChanged()}
          showToast={showToast}
        />
      )}

      <nav className="flex flex-wrap items-center gap-1" aria-label="Bank console">
        {tabs.map((tabItem) => (
          <button
            key={tabItem.id}
            type="button"
            onClick={() => setTab(tabItem.id)}
            aria-current={tab === tabItem.id ? "page" : undefined}
            title={tabItem.hint}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] transition-colors ${
              tab === tabItem.id
                ? "bg-card-elevated font-medium text-foreground"
                : "text-muted hover:bg-card-elevated/60 hover:text-foreground"
            }`}
          >
            {tabItem.label}
            {tabItem.badge != null && (
              <span className="font-mono text-[11px] tabular-nums text-warning">
                {tabItem.badge}
              </span>
            )}
            {tabItem.alert && (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-error" aria-hidden="true" />
                <span className="sr-only">{tabItem.hint ?? t("needsAttention")}</span>
              </>
            )}
          </button>
        ))}
      </nav>

      {tab === "overview" && (
        <>
          <OutlookStrip data={data} />
          <BankPanel
            kind="monitor"
            title={
              <>
                {t("position")}
                <Tooltip content={t("tooltips.position")} label={t("aboutPosition")} />
              </>
            }
          >
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 pt-1 sm:grid-cols-3 lg:grid-cols-6">
              <StatCell
                label="Posted capital"
                value={formatBankMoney(charter.postedCapital, charter.currency)}
                sub={`chartered T${charter.charteredTurn}`}
                tooltip={t("tooltips.postedCapital")}
                action={{ label: t("actions.postCapital"), onClick: () => setTab("treasury") }}
              />
              <StatCell
                label="Deposits"
                value={formatBankMoney(charter.totalDeposits, charter.currency)}
                sub={`household cash ${formatBankMoney(householdCash, charter.currency)} · player pointers ${formatBankMoney(playerPointerDeposits, charter.currency)} (not cash)`}
                tooltip={t("tooltips.deposits")}
                action={{ label: t("actions.adjustRates"), onClick: () => setTab("deposits") }}
              />
              <StatCell
                label="Deposit ceiling"
                value={formatBankMoney(
                  data.depositCeiling ?? charter.depositCeiling,
                  charter.currency
                )}
                sub={
                  charter.depositCeilingBinds
                    ? `network share ${((charter.branchCapacityShare ?? data.defaultBranchCapacityShare) * 100).toFixed(0)}% · binds: ${charter.depositCeilingBinds === "equity" ? "12x equity" : "deposit network"}`
                    : `network share ${((charter.branchCapacityShare ?? data.defaultBranchCapacityShare) * 100).toFixed(0)}%`
                }
                tooltip={t("tooltips.depositCeiling")}
                action={{ label: t("actions.raiseCeiling"), onClick: () => setTab("deposits") }}
              />
              <StatCell
                label="Loans out"
                value={formatBankMoney(charter.totalLoans, charter.currency)}
                sub={
                  data.reserveRatio != null
                    ? `reserve requirement ${(data.reserveRatio * 100).toFixed(0)}%`
                    : undefined
                }
                tooltip={t("tooltips.loansOut")}
                action={{ label: t("actions.manageLoans"), onClick: () => setTab("lending") }}
              />
              <StatCell
                label="Last turn income"
                value={formatBankMoney(charter.lastBankingIncome, charter.currency)}
                sub={
                  charter.lastBankingIncomeTurn != null
                    ? `banking pass T${charter.lastBankingIncomeTurn}`
                    : "awaiting first banking pass"
                }
                tooltip={t("tooltips.netInterest")}
              />
              <StatCell
                label="Rates"
                value={
                  data.rates
                    ? `${formatRatePercent(data.rates.depositRatePercent)} / ${formatRatePercent(data.rates.lendingRatePercent)}`
                    : "n/a"
                }
                sub="you pay / you charge"
                tooltip={t("tooltips.rates")}
                action={{ label: t("actions.adjustRates"), onClick: () => setTab("deposits") }}
              />
            </div>
          </BankPanel>
          <EarningsBreakdown data={data} onTreasury={() => setTab("treasury")} />
        </>
      )}

      {tab === "deposits" && (
        <div className="space-y-6">
          {depositTaking && data.corridors && (
            <RateOffsetEditor
              corporationId={data.corporation.id}
              corridors={data.corridors}
              depositOffset={charter.depositOffset}
              lendingOffset={charter.lendingOffset}
              primeRate={data.primeRate ?? data.outlook?.primeRate ?? null}
              canMutate={canMutate}
              onChanged={onChanged}
              showToast={showToast}
            />
          )}
          {depositTaking && (
            <CapacityAllocationEditor
              corporationId={data.corporation.id}
              currency={charter.currency}
              branchCapacityShare={charter.branchCapacityShare}
              depositCeiling={data.depositCeiling ?? charter.depositCeiling}
              capacityCeiling={charter.capacityCeiling}
              equityCeiling={charter.equityCeiling}
              depositCeilingBinds={charter.depositCeilingBinds}
              canMutate={canMutate}
              onChanged={onChanged}
              showToast={showToast}
            />
          )}
          {blacklist}
        </div>
      )}

      {tab === "lending" && (
        <div className="space-y-6">
          <LoanApprovalToggle
            corporationId={data.corporation.id}
            requireApproval={charter.requireApproval}
            pendingCount={pendingCount}
            canMutate={canMutate}
            onChanged={onChanged}
            showToast={showToast}
          />
          <LoanBookTable
            loans={data.loans}
            currency={charter.currency}
            householdBook={data.householdBook}
            stancePreview={data.outlook?.stancePreview ?? null}
            corporationId={data.corporation.id}
            canMutate={canMutate}
            onChanged={onChanged}
            showToast={showToast}
          />
          {blacklist}
        </div>
      )}

      {tab === "treasury" && (
        <div className="space-y-6">
          {data.bankTreasuryEnabled && data.bankTreasury && (
            <BankTreasuryPanel
              corporationId={data.corporation.id}
              overview={data.bankTreasury}
              canMutate={canMutate}
              onChanged={onChanged}
              showToast={showToast}
            />
          )}
          <RecapitalizePanel
            corporationId={data.corporation.id}
            currency={charter.currency}
            cashReserves={charter.cashReserves}
            sovereignTreasuryMarkValue={charter.sovereignTreasuryMarkValue ?? 0}
            requiredReservesAmount={charter.requiredReserves}
            withdrawable={charter.upstreamCapacity}
            totalLoans={charter.totalLoans}
            propBookMarkValue={charter.propBookMarkValue}
            borrowings={borrowingsFromCharter(charter)}
            canMutate={canMutate}
            onChanged={onChanged}
            showToast={showToast}
          />
          {depositTaking && (
            <DiscountWindowPanel
              corporationId={data.corporation.id}
              currency={charter.currency}
              canMutate={canMutate}
              onChanged={onChanged}
              showToast={showToast}
            />
          )}
          {data.bankPropTradingEnabled && (
            <InterbankPanel
              corporationId={data.corporation.id}
              currency={charter.currency}
              depositTaking={depositTaking}
              interbankDebt={charter.interbankDebt}
              cbMarginDebt={charter.cbMarginDebt}
              propBookMarkValue={charter.propBookMarkValue}
              primeRate={data.primeRate}
              loans={data.interbankLoans}
              canMutate={canMutate}
              onChanged={onChanged}
              showToast={showToast}
            />
          )}
        </div>
      )}

      {tab === "investing" && (
        <div className="space-y-6">
          {data.bankPropTradingEnabled ? (
            <PropBookPanel
              key={data.propAssetOptions?.join(",") ?? "legacy"}
              assetOptions={data.propAssetOptions}
              corporationId={data.corporation.id}
              currency={charter.currency}
              positions={charter.propBook}
              markValue={charter.propBookMarkValue}
              sovereignTreasuryMarkValue={charter.sovereignTreasuryMarkValue ?? 0}
              cashReserves={charter.cashReserves}
              totalLoans={charter.totalLoans}
              borrowings={borrowingsFromCharter(charter)}
              propLeverage={data.outlook?.propLeverage ?? null}
              canMutate={canMutate}
              forexFeesEnabled={data.bankPropForexFeesEnabled === true}
              onChanged={onChanged}
              showToast={showToast}
            />
          ) : (
            <EmptyState
              title="Investing is frozen"
              description="The bank's own investments and interbank markets are switched off for this world."
            />
          )}
        </div>
      )}

      {tab === "charter" && (
        <div className="space-y-6">
          <BankPanel kind="reference" title="Charter">
            <p className="py-1.5 text-xs text-muted">
              {charterLabel(charter.type)} charter in {charter.currency}, granted on turn{" "}
              {charter.charteredTurn}. Posted capital{" "}
              <span className="font-mono text-foreground">
                {formatBankMoney(charter.postedCapital, charter.currency)}
              </span>
              .
            </p>
          </BankPanel>
          <CharterSwitchForm
            data={data}
            canMutate={canMutate}
            onChanged={onChanged}
            showToast={showToast}
          />
          {data.canRevoke ? (
            <RevokeCharterForm
              corporationId={data.corporation.id}
              onChanged={onChanged}
              showToast={showToast}
            />
          ) : (
            <p className="text-xs text-muted">
              Only the chartering currency&apos;s central bank chair or an admin can revoke a
              charter.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
