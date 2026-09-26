"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { EmptyState, Tooltip } from "@/components/ui";
import { formatBankMoney, formatRatePercent } from "@/components/banking/formatBankMoney";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { assessCapital, borrowingsFromCharter } from "@/lib/banking/capitalAdequacy";
import { Eyebrow } from "../components/BankSection";
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
    <div className="space-y-2 rounded-xl border border-card-border bg-card p-4">
      <Eyebrow kind="ceoControl" />
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-foreground">Loan approval</div>
          <p className="mt-1 text-xs text-muted">
            {requireApproval
              ? "New loan requests wait for you to approve or decline them in the loan book."
              : "Loan requests are granted automatically when the borrower qualifies."}
          </p>
        </div>
        <button
          type="button"
          disabled={!canMutate || busy}
          onClick={() => void toggle()}
          aria-pressed={requireApproval}
          className={`shrink-0 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            requireApproval
              ? "border-accent bg-accent/10 text-accent"
              : "border-card-border text-muted hover:border-accent/50"
          }`}
        >
          {requireApproval ? "Approval required" : "Auto-approve"}
        </button>
      </div>
    </div>
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
    <section className="rounded-xl border border-card-border bg-card overflow-hidden">
      <div className="flex items-center gap-1 border-b border-card-border px-4 py-2">
        <Eyebrow kind="monitor" />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
          Last turn earnings
        </span>
        <Tooltip
          content={t("tooltips.netInterest")}
          label={t("about", { label: "Last turn earnings" })}
        />
      </div>
      <dl className="divide-y divide-card-border px-4">
        <EarningsRow
          label="Interest earned"
          detail={`loans ${formatBankMoney(loanInterest, currency)} · interbank received ${formatBankMoney(ibReceived, currency)}`}
          value={formatBankMoney(earned, currency)}
          tooltip={t("tooltips.interestEarned")}
          aboutLabel={t("about", { label: "Interest earned" })}
        />
        <EarningsRow
          label="Interest paid"
          detail={`deposits ${formatBankMoney(depositInterest, currency)} · interbank paid ${formatBankMoney(ibPaid, currency)} · central-bank facilities ${formatBankMoney(facility, currency)}${costOfFunds != null ? ` · cost of funds ${costOfFunds.toFixed(2)}%` : ""}`}
          value={formatBankMoney(paid, currency)}
          tooltip={t("tooltips.interestPaid")}
          aboutLabel={t("about", { label: "Interest paid" })}
        />
        <EarningsRow
          label="Net interest"
          detail={
            charter.lastBankingIncomeTurn != null
              ? `banking pass T${charter.lastBankingIncomeTurn}${nim != null ? ` · margin ${nim.toFixed(2)}%` : ""}`
              : "awaiting first banking pass"
          }
          value={formatBankMoney(net, currency)}
          tone={net < 0 ? "text-error" : "text-success"}
          tooltip={t("tooltips.netInterest")}
          aboutLabel={t("about", { label: "Net interest" })}
        />
        <EarningsRow
          label="Insurance and write-offs"
          detail={`premium ${formatBankMoney(premium, currency)} · defaults ${formatBankMoney(writeoffs, currency)}`}
          value={formatBankMoney(premium + writeoffs, currency)}
          tooltip={t("tooltips.otherCharges")}
          aboutLabel={t("about", { label: "Insurance and write-offs" })}
        />
        <EarningsRow
          label="Bottom line"
          detail="net interest minus insurance and write-offs"
          value={formatBankMoney(charter.lastBankingIncome, currency)}
          tone={charter.lastBankingIncome < 0 ? "text-error" : "text-success"}
          tooltip={t("tooltips.otherCharges")}
          aboutLabel={t("about", { label: "Bottom line" })}
        />
      </dl>
      <div className="border-t border-card-border px-4 py-3">
        <p className="text-xs text-muted">
          {t("tooltips.takeProfits")}{" "}
          <button
            type="button"
            onClick={onTreasury}
            className="font-medium text-accent underline-offset-2 hover:underline"
          >
            Withdraw in Treasury
          </button>
        </p>
      </div>
    </section>
  );
}

function EarningsRow({
  label,
  detail,
  value,
  tone,
  tooltip,
  aboutLabel,
}: {
  label: string;
  detail: string;
  value: string;
  tone?: string;
  tooltip: string;
  aboutLabel: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <dt className="text-sm font-medium text-foreground">
          {label}
          <Tooltip content={tooltip} label={aboutLabel} />
        </dt>
        <dd className="truncate text-xs text-muted">{detail}</dd>
      </div>
      <dd className={`shrink-0 text-sm font-semibold tabular-nums ${tone ?? "text-foreground"}`}>
        {value}
      </dd>
    </div>
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

      <div className="flex flex-wrap gap-1 border-b border-card-border">
        {tabs.map((tabItem) => (
          <button
            key={tabItem.id}
            type="button"
            onClick={() => setTab(tabItem.id)}
            aria-current={tab === tabItem.id ? "page" : undefined}
            title={tabItem.hint}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === tabItem.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {tabItem.label}
            {tabItem.badge != null && (
              <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-accent">
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
      </div>

      {tab === "overview" && (
        <>
          <OutlookStrip data={data} />
          <section className="rounded-xl border border-card-border bg-card overflow-hidden">
            <div className="flex items-center gap-1 border-b border-card-border px-4 py-2">
              <Eyebrow kind="monitor" />
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                {t("position")}
              </span>
              <Tooltip content={t("tooltips.position")} label={t("aboutPosition")} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-y divide-card-border sm:divide-y-0 sm:divide-x">
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
          </section>
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
          <RecapitalizePanel
            corporationId={data.corporation.id}
            currency={charter.currency}
            cashReserves={charter.cashReserves}
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
              corporationId={data.corporation.id}
              currency={charter.currency}
              positions={charter.propBook}
              markValue={charter.propBookMarkValue}
              cashReserves={charter.cashReserves}
              totalLoans={charter.totalLoans}
              borrowings={borrowingsFromCharter(charter)}
              propLeverage={data.outlook?.propLeverage ?? null}
              canMutate={canMutate}
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
          <section className="space-y-2 rounded-xl border border-card-border bg-card p-5 text-sm text-muted">
            <Eyebrow kind="reference" />
            <h3 className="text-base font-semibold text-foreground">Charter</h3>
            <p className="mt-1">
              {charterLabel(charter.type)} charter in {charter.currency}, granted on turn{" "}
              {charter.charteredTurn}. Posted capital{" "}
              {formatBankMoney(charter.postedCapital, charter.currency)}.
            </p>
          </section>
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
            <p className="text-sm text-muted">
              Only the chartering currency&apos;s central bank chair or an admin can revoke a
              charter.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
