"use client";

import { useEffect, useState } from "react";
import { Button, Input, useDialogA11y } from "@/components/ui";
import { WarningBandBadge } from "@/components/banking/WarningBandBadge";
import { formatBankMoney, formatRatePercent } from "@/components/banking/formatBankMoney";
import {
  CHARACTER_LOAN_SPREAD_PP,
  NAMED_LOAN_DTI_MAX_FRACTION,
  bindingNamedLoanCap,
  convertFaceBetweenCurrencies,
  maxPrincipalFromIncome,
  namedLoanPaymentDue,
  namedLoanPrincipalCap,
  remainingLoanTurns,
} from "@/lib/banking/lendingMath";
import type { BankCharterType } from "@/lib/db/types/bank";
import type { CurrencyCode } from "@/lib/constants/currencies";

export type PrivateLoanBank = {
  corporationId: string;
  name: string;
  currency: CurrencyCode;
  lendingRatePercent: number;
  warningBand: "green" | "amber" | "red" | null;
  confidence: number | null;
  cashReserves: number;
  lendableHeadroom: number;
  requireApproval?: boolean;
  charterType?: BankCharterType;
};

export type PrivateLoanCorporation = {
  id: string;
  name: string;
  liquidCapital: number;
  incomePerTurn: number;
  currency: CurrencyCode;
};

export type PrivateLoanRecord = {
  status: string;
  borrowerType: "character" | "corporation";
  borrowerId: string | null;
  outstanding: number;
  ratePercent: number;
  originatedTurn: number;
  termTurns: number;
  currency?: CurrencyCode;
};

type ShowToast = (msg: string, type?: "success" | "error" | "info" | "warning") => void;

export interface PrivateLoanModalProps {
  banks: PrivateLoanBank[];
  ceoCorporations: PrivateLoanCorporation[];
  personalCash: Partial<Record<CurrencyCode, number>>;
  exchangeRates?: Partial<Record<CurrencyCode, number>>;
  personalIncomeByCurrency: Partial<Record<CurrencyCode, number>>;
  currentTurn: number;
  loans: PrivateLoanRecord[];
  hasCharacter: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
  showToast: ShowToast;
}

type BorrowerType = "character" | "corporation";

export function PrivateLoanModal({
  banks,
  ceoCorporations,
  personalCash,
  exchangeRates = {},
  personalIncomeByCurrency,
  currentTurn,
  loans,
  hasCharacter,
  onClose,
  onChanged,
  showToast,
}: PrivateLoanModalProps) {
  const { dialogProps, titleId } = useDialogA11y(onClose);
  const [bankId, setBankId] = useState(banks[0]?.corporationId ?? "");
  const [borrowerType, setBorrowerType] = useState<BorrowerType>(
    hasCharacter ? "character" : "corporation"
  );
  const [corpId, setCorpId] = useState(ceoCorporations[0]?.id ?? "");
  const [principal, setPrincipal] = useState("");
  const [termTurns, setTermTurns] = useState("12");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const selectedBank = banks.find((bank) => bank.corporationId === bankId);
  const eligibleCorporations = ceoCorporations.filter(
    (corporation) => corporation.currency === selectedBank?.currency
  );
  const selectedCorporation = eligibleCorporations.find((corporation) => corporation.id === corpId);

  useEffect(() => {
    if (!selectedBank && banks[0]) setBankId(banks[0].corporationId);
  }, [banks, selectedBank]);

  useEffect(() => {
    if (borrowerType === "corporation" && !selectedCorporation) {
      setCorpId(eligibleCorporations[0]?.id ?? "");
    }
  }, [borrowerType, eligibleCorporations, selectedCorporation]);

  const term = parseInt(termTurns, 10);
  const validTerm = Number.isInteger(term) && term >= 4 && term <= 120;
  const quotedRatePercent =
    selectedBank == null
      ? 0
      : selectedBank.lendingRatePercent +
        (borrowerType === "character" ? CHARACTER_LOAN_SPREAD_PP : 0);
  const incomePerTurn =
    borrowerType === "corporation"
      ? (selectedCorporation?.incomePerTurn ?? 0)
      : selectedBank
        ? (personalIncomeByCurrency[selectedBank.currency] ?? 0)
        : 0;
  const committedPaymentPerTurn = loans
    .filter((loan) => {
      if (loan.status !== "current" && loan.status !== "arrears") return false;
      if (borrowerType === "character") return loan.borrowerType === "character";
      return loan.borrowerType === "corporation" && loan.borrowerId === selectedCorporation?.id;
    })
    .reduce((sum, loan) => {
      const payment = namedLoanPaymentDue(
        loan.outstanding,
        loan.ratePercent,
        remainingLoanTurns(loan.originatedTurn, loan.termTurns, currentTurn)
      );
      const fromCurrency = loan.currency ?? selectedBank?.currency;
      const toCurrency = selectedBank?.currency;
      if (!fromCurrency || !toCurrency || fromCurrency === toCurrency) return sum + payment;
      const fromRate = exchangeRates[fromCurrency] ?? 0;
      const toRate = exchangeRates[toCurrency] ?? 0;
      if (!(fromRate > 0) || !(toRate > 0)) return Number.POSITIVE_INFINITY;
      return (
        sum + convertFaceBetweenCurrencies(payment, fromCurrency, toCurrency, fromRate, toRate)
      );
    }, 0);
  const incomeCap = maxPrincipalFromIncome({
    incomePerTurn,
    ratePercent: quotedRatePercent,
    termTurns: validTerm ? term : 12,
    committedPaymentPerTurn,
  });
  const capInput = {
    bankCashReserves: selectedBank?.cashReserves ?? 0,
    lendableHeadroom: selectedBank?.lendableHeadroom ?? 0,
    incomeCap,
  };
  const maxPrincipal = namedLoanPrincipalCap(capInput);
  const bindingCap = bindingNamedLoanCap(capInput);
  const bindingLabel =
    bindingCap === "cashReserves"
      ? "the bank's cash reserves"
      : bindingCap === "headroom"
        ? "deposit headroom"
        : `income at ${Math.round(NAMED_LOAN_DTI_MAX_FRACTION * 100)}% of demonstrated per-turn income, after existing payments`;
  const principalNumber = Number(principal);
  const paymentPreview =
    Number.isFinite(principalNumber) && principalNumber > 0 && validTerm
      ? namedLoanPaymentDue(principalNumber, quotedRatePercent, term)
      : null;
  const canSubmit =
    !busy &&
    !!selectedBank &&
    Number.isFinite(principalNumber) &&
    principalNumber > 0 &&
    validTerm &&
    principalNumber <= maxPrincipal &&
    (borrowerType === "character" ? hasCharacter : !!selectedCorporation);

  const chooseBorrower = (next: BorrowerType) => {
    setBorrowerType(next);
    setError("");
  };

  const submit = async () => {
    setError("");
    if (!selectedBank) {
      setError("Select a lending bank.");
      return;
    }
    if (!Number.isFinite(principalNumber) || principalNumber <= 0) {
      setError("Enter a positive principal.");
      return;
    }
    if (!validTerm) {
      setError("Term must be between 4 and 120 turns.");
      return;
    }
    if (principalNumber > maxPrincipal) {
      setError(
        `Principal exceeds this bank's maximum of ${formatBankMoney(maxPrincipal, selectedBank.currency)}.`
      );
      return;
    }
    if (borrowerType === "character" && !hasCharacter) {
      setError("A character is required for a personal loan.");
      return;
    }
    if (borrowerType === "corporation" && !selectedCorporation) {
      setError(`Choose a corporation with a ${selectedBank.currency} treasury.`);
      return;
    }

    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        bankCorporationId: selectedBank.corporationId,
        borrowerType,
        principal: principalNumber,
        termTurns: term,
      };
      if (borrowerType === "corporation") body.borrowerCorporationId = selectedCorporation?.id;

      const response = await fetch("/api/banking/loans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await response.json().catch(() => ({}))) as {
        error?: string;
        pending?: boolean;
        creditedTo?: {
          name: string;
          destination: "personalCash" | "corporationLiquidCapital";
        };
      };
      if (!response.ok) {
        setError(json.error ?? "Loan request failed.");
        return;
      }

      const amountLabel = formatBankMoney(principalNumber, selectedBank.currency);
      if (json.pending) {
        showToast("Loan request submitted for approval. No funds have moved yet.", "info");
      } else if (json.creditedTo?.destination === "corporationLiquidCapital") {
        showToast(`${amountLabel} credited to ${json.creditedTo.name} liquid capital.`, "success");
      } else {
        showToast(`${amountLabel} credited to your personal cash.`, "success");
      }
      await onChanged();
      onClose();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      {...dialogProps}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-card-border bg-card shadow-modal">
        <div className="flex items-start justify-between border-b border-card-border px-6 py-4">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-foreground">
              Arrange private-bank credit
            </h2>
            <p className="mt-1 text-sm text-muted">
              Choose who receives the money, then review the exact rate, payment, and cap before
              submitting.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-4 -mt-0.5 text-muted transition-colors hover:text-foreground"
            aria-label="Close"
          >
            <span className="text-xl leading-none" aria-hidden>
              ×
            </span>
          </button>
        </div>

        <div className="border-b border-card-border px-6 py-4">
          <div className="flex overflow-hidden rounded-lg border border-card-border text-sm">
            <button
              type="button"
              onClick={() => chooseBorrower("character")}
              disabled={!hasCharacter}
              className={`flex-1 border-r border-card-border px-3 py-2.5 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                borrowerType === "character"
                  ? "bg-primary font-semibold text-white"
                  : "bg-card-elevated text-muted hover:text-foreground"
              }`}
            >
              Personal loan
            </button>
            <button
              type="button"
              onClick={() => chooseBorrower("corporation")}
              disabled={eligibleCorporations.length === 0}
              className={`flex-1 px-3 py-2.5 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                borrowerType === "corporation"
                  ? "bg-primary font-semibold text-white"
                  : "bg-card-elevated text-muted hover:text-foreground"
              }`}
            >
              Corporation loan
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">
            {borrowerType === "character"
              ? "Funds go to your personal cash and are separate from savings and corporate capital."
              : "Funds go directly to the selected corporation's liquid capital and never to your personal cash."}
          </p>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-6 py-5">
          <label className="block space-y-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
            Lending bank
            <select
              className="h-10 w-full rounded-lg border border-card-border bg-background px-3 text-sm font-normal normal-case tracking-normal text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
              value={bankId}
              onChange={(event) => {
                setBankId(event.target.value);
                setError("");
              }}
              aria-label="Lending bank"
            >
              {banks.map((bank) => (
                <option key={bank.corporationId} value={bank.corporationId}>
                  {bank.name} · {formatRatePercent(bank.lendingRatePercent)} · {bank.currency}
                </option>
              ))}
            </select>
          </label>

          {selectedBank && (
            <div className="rounded-xl border border-card-border bg-background/45 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-foreground">Rate breakdown</p>
                  <dl className="mt-2 space-y-1 text-xs">
                    <div className="flex justify-between gap-5">
                      <dt className="text-muted">Bank posted rate</dt>
                      <dd className="font-mono font-semibold tabular-nums text-foreground">
                        {formatRatePercent(selectedBank.lendingRatePercent)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-5">
                      <dt className="text-muted">
                        {borrowerType === "character"
                          ? "Personal risk spread"
                          : "Corporation spread"}
                      </dt>
                      <dd className="font-mono font-semibold tabular-nums text-foreground">
                        {borrowerType === "character"
                          ? `+${formatRatePercent(CHARACTER_LOAN_SPREAD_PP)}`
                          : "Included in posted rate"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-5 border-t border-card-border pt-1.5">
                      <dt className="font-semibold text-foreground">Your quoted rate</dt>
                      <dd className="font-mono font-bold tabular-nums text-primary">
                        {formatRatePercent(quotedRatePercent)}
                      </dd>
                    </div>
                  </dl>
                </div>
                <WarningBandBadge
                  band={selectedBank.warningBand}
                  confidence={selectedBank.confidence}
                />
              </div>
              {selectedBank.requireApproval && (
                <p className="mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                  This bank reviews requests manually. Your request will be queued and no money
                  moves until its CEO approves it.
                </p>
              )}
            </div>
          )}

          {borrowerType === "corporation" && (
            <label className="block space-y-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
              Borrowing corporation
              {eligibleCorporations.length > 0 ? (
                <select
                  className="h-10 w-full rounded-lg border border-card-border bg-background px-3 text-sm font-normal normal-case tracking-normal text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
                  value={corpId}
                  onChange={(event) => {
                    setCorpId(event.target.value);
                    setError("");
                  }}
                  aria-label="Borrowing corporation"
                >
                  {eligibleCorporations.map((corporation) => (
                    <option key={corporation.id} value={corporation.id}>
                      {corporation.name} · {corporation.currency}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs font-normal normal-case tracking-normal text-warning">
                  No corporation you lead has a {selectedBank?.currency ?? "matching"} treasury.
                  Choose a bank in that corporation&apos;s currency.
                </p>
              )}
            </label>
          )}

          {borrowerType === "corporation" && selectedCorporation ? (
            <div className="rounded-lg border border-primary/20 bg-primary/[0.06] px-3 py-2.5 text-xs leading-relaxed text-muted">
              <span className="font-semibold text-foreground">Destination:</span>{" "}
              {selectedCorporation.name}
              liquid capital, currently{" "}
              {formatBankMoney(selectedCorporation.liquidCapital, selectedCorporation.currency)}.
            </div>
          ) : (
            <div className="rounded-lg border border-primary/20 bg-primary/[0.06] px-3 py-2.5 text-xs leading-relaxed text-muted">
              <span className="font-semibold text-foreground">Destination:</span> your personal
              cash, currently{" "}
              {selectedBank
                ? formatBankMoney(personalCash[selectedBank.currency] ?? 0, selectedBank.currency)
                : "-"}
              .
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
              Principal
              <Input
                value={principal}
                onChange={(event) => setPrincipal(event.target.value)}
                className="font-normal normal-case tracking-normal"
                inputMode="decimal"
                placeholder={selectedBank ? `Amount in ${selectedBank.currency}` : "Amount"}
                aria-label="Loan principal"
              />
            </label>
            <label className="block space-y-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
              Term (turns)
              <Input
                value={termTurns}
                onChange={(event) => setTermTurns(event.target.value)}
                className="font-normal normal-case tracking-normal"
                inputMode="numeric"
                aria-label="Loan term in turns"
              />
            </label>
          </div>

          {selectedBank && (
            <div className="rounded-lg border border-card-border bg-card-elevated/40 px-3 py-2.5 text-xs leading-relaxed text-muted">
              <div className="flex justify-between gap-3">
                <span>Private-bank maximum</span>
                <span className="font-mono font-semibold tabular-nums text-foreground">
                  {formatBankMoney(maxPrincipal, selectedBank.currency)}
                </span>
              </div>
              <p className="mt-1">
                Limited by {bindingLabel}. This cap uses the bank&apos;s own reserves, deposit
                headroom, and demonstrated income. It is separate from bond issuance capacity.
              </p>
            </div>
          )}

          <div className="rounded-lg border border-card-border bg-background/45 px-3 py-2.5 text-xs">
            <div className="flex justify-between gap-3">
              <span className="text-muted">Estimated payment per turn</span>
              <span className="font-mono font-semibold tabular-nums text-foreground">
                {paymentPreview == null || !selectedBank
                  ? "Enter principal and a 4 to 120 turn term"
                  : formatBankMoney(paymentPreview, selectedBank.currency)}
              </span>
            </div>
            <p className="mt-1 text-muted">
              Straight-line principal plus interest at your quoted annual rate. Existing
              private-bank payments are included in the income cap.
            </p>
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-xs text-error"
            >
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-card-border px-6 py-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void submit()}
            isLoading={busy}
            disabled={!canSubmit}
          >
            Submit loan request
          </Button>
        </div>
      </div>
    </div>
  );
}
