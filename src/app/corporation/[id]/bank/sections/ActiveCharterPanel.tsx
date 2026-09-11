"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { EmptyState, Tooltip } from "@/components/ui";
import { formatBankMoney, formatRatePercent } from "@/components/banking/formatBankMoney";
import { assessCapital, borrowingsFromCharter } from "@/lib/banking/capitalAdequacy";
import { Eyebrow } from "../components/BankSection";
import type { BankTab, ConsolePayload, ShowToast } from "../types";
import { charterLabel } from "../lib/helpers";
import { StatCell } from "../components/StatCell";
import { HealthCard } from "./HealthCard";
import { RiskPanel } from "./RiskPanel";
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
  canMutate,
  onChanged,
  showToast,
}: {
  corporationId: string;
  requireApproval: boolean;
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
        json.requireApproval ? "New loans now need your approval" : "Loans auto-approve again",
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
  const playerDeposits = Math.max(0, charter.totalDeposits - charter.npcDeposits);
  const tradingVisible = propEligible;
  const [tab, setTab] = useState<BankTab>("overview");

  // Attention routing: the tabs that need the CEO carry the signal, so the
  // console answers "does anything need me?" before any panel is opened.
  const pendingCount = data.loans.filter(
    (l) => l.borrowerType !== "npcBulk" && l.status === "pending"
  ).length;
  const capitalStanding = assessCapital({
    cashReserves: charter.cashReserves,
    totalLoans: charter.totalLoans,
    borrowings: borrowingsFromCharter(charter),
    propBookMarkValue: charter.propBookMarkValue,
  }).standing;
  const fundingAttention =
    capitalStanding !== "adequate" || charter.cashReserves < charter.requiredReserves;

  const tabs: { id: BankTab; label: string; badge?: number; alert?: boolean; hint?: string }[] = [
    { id: "overview", label: "Overview" },
    {
      id: "lending",
      label: "Lending",
      badge: pendingCount > 0 ? pendingCount : undefined,
      hint: pendingCount > 0 ? t("pendingDecisions", { count: pendingCount }) : undefined,
    },
    {
      id: "funding",
      label: "Funding",
      alert: fundingAttention,
      hint: fundingAttention ? t("fundingAttention") : undefined,
    },
    ...(tradingVisible ? [{ id: "trading" as const, label: "Trading" }] : []),
    { id: "admin", label: "Admin" },
  ];

  return (
    <div className="space-y-6">
      <HealthCard data={data} />
      {data.risk && <RiskPanel risk={data.risk} currency={charter.currency} />}

      {/* Customer actions: a non-CEO viewer can deposit or borrow straight from
          this bank's page. The CEO manages the bank through the panels below. */}
      {!data.isCeo && data.privateBankingEnabled && charter.status === "active" && (
        <CustomerBankPanel
          corporationId={data.corporation.id}
          bankName={data.corporation.name}
          currency={charter.currency}
          depositTaking={depositTaking}
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
                <span className="sr-only">{t("needsAttention")}</span>
              </>
            )}
          </button>
        ))}
      </div>

      {tab === "overview" && (
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
              action={{ label: t("actions.postCapital"), onClick: () => setTab("funding") }}
            />
            <StatCell
              label="Deposits"
              value={formatBankMoney(charter.totalDeposits, charter.currency)}
              sub={`players ${formatBankMoney(playerDeposits, charter.currency)} · households ${formatBankMoney(charter.npcDeposits, charter.currency)}`}
              tooltip={t("tooltips.deposits")}
              action={{ label: t("actions.adjustRates"), onClick: () => setTab("lending") }}
            />
            <StatCell
              label="Deposit ceiling"
              value={formatBankMoney(
                data.depositCeiling ?? charter.depositCeiling,
                charter.currency
              )}
              sub={`branch share ${((charter.branchCapacityShare ?? data.defaultBranchCapacityShare) * 100).toFixed(0)}%`}
              tooltip={t("tooltips.depositCeiling")}
              action={{ label: t("actions.raiseCeiling"), onClick: () => setTab("funding") }}
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
              action={{ label: t("actions.adjustRates"), onClick: () => setTab("lending") }}
            />
          </div>
        </section>
      )}

      {tab === "lending" && (
        <div className="space-y-6">
          {depositTaking && data.corridors && (
            <RateOffsetEditor
              corporationId={data.corporation.id}
              corridors={data.corridors}
              depositOffset={charter.depositOffset}
              lendingOffset={charter.lendingOffset}
              canMutate={canMutate}
              onChanged={onChanged}
              showToast={showToast}
            />
          )}
          <LoanApprovalToggle
            corporationId={data.corporation.id}
            requireApproval={charter.requireApproval}
            canMutate={canMutate}
            onChanged={onChanged}
            showToast={showToast}
          />
          <LoanBookTable
            loans={data.loans}
            currency={charter.currency}
            householdBook={data.householdBook}
            corporationId={data.corporation.id}
            canMutate={canMutate}
            onChanged={onChanged}
            showToast={showToast}
          />
          {charter.blacklist ? (
            <BlacklistEditor
              corporationId={data.corporation.id}
              blacklist={charter.blacklist}
              availableFunds={data.blacklistableFunds ?? []}
              canMutate={canMutate}
              onChanged={onChanged}
              showToast={showToast}
            />
          ) : null}
        </div>
      )}

      {tab === "funding" && (
        <div className="space-y-6">
          {depositTaking && (
            <CapacityAllocationEditor
              corporationId={data.corporation.id}
              currency={charter.currency}
              branchCapacityShare={charter.branchCapacityShare}
              depositCeiling={data.depositCeiling ?? charter.depositCeiling}
              canMutate={canMutate}
              onChanged={onChanged}
              showToast={showToast}
            />
          )}
          {depositTaking && (
            <DiscountWindowPanel
              corporationId={data.corporation.id}
              currency={charter.currency}
              canMutate={canMutate}
              onChanged={onChanged}
              showToast={showToast}
            />
          )}
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
        </div>
      )}

      {tab === "trading" && (
        <div className="space-y-6">
          {data.bankPropTradingEnabled ? (
            <>
              <PropBookPanel
                corporationId={data.corporation.id}
                currency={charter.currency}
                positions={charter.propBook}
                markValue={charter.propBookMarkValue}
                canMutate={canMutate}
                onChanged={onChanged}
                showToast={showToast}
              />
              <InterbankPanel
                corporationId={data.corporation.id}
                currency={charter.currency}
                depositTaking={depositTaking}
                interbankDebt={charter.interbankDebt}
                cbMarginDebt={charter.cbMarginDebt}
                loans={data.interbankLoans}
                canMutate={canMutate}
                onChanged={onChanged}
                showToast={showToast}
              />
            </>
          ) : (
            <EmptyState
              title="Trading is frozen"
              description="Prop trading and interbank markets are switched off for this world."
            />
          )}
        </div>
      )}

      {tab === "admin" && (
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
