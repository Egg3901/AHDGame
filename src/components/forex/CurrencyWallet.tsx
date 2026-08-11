"use client";

import { useMemo, useState } from "react";
import type { WalletBalances } from "@/app/country/[code]/forex/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  FOREX_ACTIVE_CURRENCIES,
  CURRENCY_SYMBOLS,
  CURRENCY_ANCHOR_COUNTRY,
} from "@/lib/constants/currencies";
import Link from "next/link";
import { useCurrency } from "@/contexts/CurrencyContext";
import { SavingsWalletBlock } from "@/components/forex/SavingsWalletBlock";
import { formatFundsCompact } from "@/lib/utils/formatters";
import { formatCurrencyFaceAmount } from "@/lib/currency/formatCurrencyFaceAmount";
import { currencyCentralBankUrl } from "@/lib/urls";

/**
 * Currency → the country whose forex / central-bank page to link. This is the
 * currency ANCHOR (GBP→UK, EUR→DE), not a reverse of COUNTRY_CURRENCY_MAP: with
 * multiple countries sharing a currency (UK/SCO/WAL→GBP, DE/IE→EUR) a reverse
 * map's last-wins entry would mis-link the shared currency to a latent/non-anchor
 * country.
 */
const CURRENCY_COUNTRY_MAP: Record<CurrencyCode, string> = CURRENCY_ANCHOR_COUNTRY;

type RateMap = Partial<Record<CurrencyCode, number>>;

interface Props {
  wallet: WalletBalances;
  variant: "strip" | "card";
  /** Refetch wallet / portfolio after savings mutations */
  onSavingsUpdated?: () => void;
}

function formatPct(pct: number): string {
  const rounded = Math.round(pct * 10) / 10;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toFixed(1)}%`;
}

/**
 * Unrealized mark on cash vs calibration base rates: same basis as forex "change" column.
 * internalDelta is in internal units so formatAmount() can respect display preference.
 */
function fxVsBasePnl(
  balance: number,
  fromCurrency: CurrencyCode,
  homeCurrency: CurrencyCode,
  rates: RateMap,
  baseRates: RateMap
): { internalDelta: number; pct: number } | null {
  const rF = rates[fromCurrency];
  const rH = rates[homeCurrency];
  const bF = baseRates[fromCurrency];
  const bH = baseRates[homeCurrency];
  if (
    rF === undefined ||
    rH === undefined ||
    bF === undefined ||
    bH === undefined ||
    rF === 0 ||
    rH === 0 ||
    bF === 0 ||
    bH === 0
  ) {
    return null;
  }
  const valueNowHome = (balance / rF) * rH;
  const valueAtBaseHome = (balance / bF) * bH;
  const internalDelta = balance / rF - balance / bF;
  if (valueAtBaseHome === 0) return null;
  const pct = ((valueNowHome - valueAtBaseHome) / valueAtBaseHome) * 100;
  return { internalDelta, pct };
}

export function CurrencyWallet({ wallet, variant, onSavingsUpdated }: Props) {
  const { convert, convertFrom, formatAmount, baseRates, forexRates, ratesLoading } = useCurrency();

  const [pnlMode, setPnlMode] = useState<"pct" | "abs">("pct");

  // Keep currencies that hold savings even when liquid is zero — otherwise a full
  // deposit would hide the savings row entirely (the home row is always shown).
  const personalEntries = FOREX_ACTIVE_CURRENCIES.map((c) => ({
    currency: c,
    balance: wallet.personal[c] ?? 0,
  })).filter(
    (e) =>
      e.balance > 0 || e.currency === wallet.homeCurrency || (wallet.savings?.[e.currency] ?? 0) > 0
  );

  const homeTotalAmount = personalEntries.reduce((sum, { currency, balance }) => {
    if (currency === wallet.homeCurrency) return sum + balance;
    return sum + convertFrom(balance, currency);
  }, 0);

  // homeTotalAmount is already in home currency face amount. Convert to internal for formatAmount.
  const homeRatePerInternal = convert(1);
  const internalTotal =
    homeRatePerInternal !== 0 ? homeTotalAmount / homeRatePerInternal : homeTotalAmount;
  const totalFormatted = formatAmount(internalTotal, wallet.homeCurrency);

  const hasLiveRates = forexRates != null && !ratesLoading;
  const showPnlChrome = useMemo(
    () =>
      personalEntries.some(
        ({ currency, balance }) => balance > 0 && currency !== wallet.homeCurrency
      ),
    [personalEntries, wallet.homeCurrency]
  );

  if (variant === "strip") {
    return (
      <div className="flex items-center overflow-x-auto divide-x divide-card-border border-t border-card-border">
        <div className="flex flex-col px-5 py-3 min-w-max">
          <span className="text-[10px] uppercase tracking-widest text-muted font-medium">
            Campaign
          </span>
          <span className="text-base font-bold tabular-nums">
            {formatCurrencyFaceAmount(wallet.campaign, wallet.homeCurrency)}
          </span>
        </div>
        {personalEntries.map(({ currency, balance }) => (
          <div key={currency} className="flex flex-col px-5 py-3 min-w-max">
            <span className="text-[10px] uppercase tracking-widest text-muted font-medium">
              {currency}
              {currency === wallet.homeCurrency && (
                <span
                  className="ml-1 text-[9px] text-primary/70"
                  title="Your home currency — campaign funds are held in this currency"
                >
                  HOME
                </span>
              )}
            </span>
            <span className="text-base font-bold tabular-nums">
              {formatCurrencyFaceAmount(balance, currency)}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-card-border bg-card shadow-sm">
      <div className="flex flex-col gap-2 border-b border-card-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
          Currency Wallet
        </h3>
        {showPnlChrome && hasLiveRates && baseRates && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
              FX vs base
            </span>
            <div className="inline-flex rounded-md border border-card-border bg-card-elevated p-0.5 text-[11px] font-semibold">
              <button
                type="button"
                onClick={() => setPnlMode("pct")}
                className={`rounded px-2 py-0.5 transition-colors ${
                  pnlMode === "pct"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                %
              </button>
              <button
                type="button"
                onClick={() => setPnlMode("abs")}
                className={`rounded px-2 py-0.5 transition-colors ${
                  pnlMode === "abs"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                Amount
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="divide-y divide-card-border">
        {wallet.campaign > 0 && (
          <div className="flex items-center justify-between px-5 py-3">
            <div>
              <span className="text-sm font-medium text-foreground">Campaign Funds</span>
              <span className="ml-2 text-xs text-muted">({wallet.homeCurrency} only)</span>
            </div>
            <span className="text-sm font-bold tabular-nums text-foreground">
              {formatCurrencyFaceAmount(wallet.campaign, wallet.homeCurrency)}
            </span>
          </div>
        )}

        {personalEntries.map(({ currency, balance }) => {
          const savingsBal = wallet.savings?.[currency] ?? 0;
          const interestLife = wallet.interestEarned?.[currency] ?? 0;
          const pendingUncredited = wallet.pendingSavingsInterest?.[currency] ?? 0;
          const accrualThisTurn = wallet.estimatedSavingsAccrualPerTurn?.[currency];
          const turnsUntilCredit = wallet.turnsUntilSavingsCredit;

          const showHomeCashEquiv = hasLiveRates && currency !== wallet.homeCurrency && balance > 0;
          const homeCashCompact = showHomeCashEquiv
            ? formatFundsCompact(
                Math.round(convertFrom(balance, currency)),
                CURRENCY_SYMBOLS[wallet.homeCurrency] ?? "$"
              )
            : null;

          const showHomeSavingsEquiv =
            hasLiveRates && currency !== wallet.homeCurrency && savingsBal > 0;
          const homeSavingsCompact = showHomeSavingsEquiv
            ? formatFundsCompact(
                Math.round(convertFrom(savingsBal, currency)),
                CURRENCY_SYMBOLS[wallet.homeCurrency] ?? "$"
              )
            : null;

          const pnl =
            hasLiveRates &&
            baseRates &&
            balance > 0 &&
            forexRates &&
            fxVsBasePnl(balance, currency, wallet.homeCurrency, forexRates, baseRates);

          const savPnl =
            hasLiveRates &&
            baseRates &&
            savingsBal > 0 &&
            forexRates &&
            fxVsBasePnl(savingsBal, currency, wallet.homeCurrency, forexRates, baseRates);

          const showPnlRow =
            Boolean(pnl) && balance > 0 && currency !== wallet.homeCurrency && showPnlChrome;
          const showSavPnlRow =
            Boolean(savPnl) && savingsBal > 0 && currency !== wallet.homeCurrency && showPnlChrome;

          const savingsBankHref = `${currencyCentralBankUrl(currency)}?tab=savings`;

          return (
            <div key={currency} className="border-b border-card-border last:border-b-0">
              <div className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 items-center gap-2 pt-0.5">
                  <span className="text-sm font-medium text-foreground">
                    {CURRENCY_SYMBOLS[currency]} {currency}
                  </span>
                  {currency === wallet.homeCurrency && (
                    <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                      HOME
                    </span>
                  )}
                </div>

                <div className="flex min-w-0 flex-1 flex-col gap-4 sm:items-end">
                  <div className="grid w-full gap-4 sm:max-w-md sm:grid-cols-2">
                    <div className="space-y-1 text-right sm:text-right">
                      <div className="text-[10px] font-medium uppercase tracking-wide text-muted">
                        Cash (liquid)
                      </div>
                      <div className="text-sm font-bold tabular-nums text-foreground">
                        {formatCurrencyFaceAmount(balance, currency)}
                      </div>
                      {showHomeCashEquiv && homeCashCompact && (
                        <>
                          <div className="text-[10px] font-medium uppercase tracking-wide text-muted">
                            Home ({wallet.homeCurrency})
                          </div>
                          <div className="text-xs font-semibold tabular-nums text-foreground/90">
                            {homeCashCompact}
                          </div>
                        </>
                      )}
                      {showPnlRow && pnl && (
                        <div
                          className={`text-xs font-medium tabular-nums ${
                            pnl.pct > 0 ? "text-success" : pnl.pct < 0 ? "text-error" : "text-muted"
                          }`}
                        >
                          FX{" "}
                          {pnlMode === "pct" ? formatPct(pnl.pct) : formatAmount(pnl.internalDelta)}
                        </div>
                      )}
                    </div>

                    <div className="space-y-1 text-right sm:text-right">
                      <div className="text-[10px] font-medium uppercase tracking-wide text-muted">
                        Savings
                      </div>
                      <div className="text-sm font-bold tabular-nums text-foreground">
                        {formatCurrencyFaceAmount(savingsBal, currency)}
                      </div>
                      {showHomeSavingsEquiv && homeSavingsCompact && (
                        <>
                          <div className="text-[10px] font-medium uppercase tracking-wide text-muted">
                            Home ({wallet.homeCurrency})
                          </div>
                          <div className="text-xs font-semibold tabular-nums text-foreground/90">
                            {homeSavingsCompact}
                          </div>
                        </>
                      )}
                      {(savingsBal > 0 || interestLife > 0 || pendingUncredited > 0) && (
                        <div className="space-y-0.5 text-[10px] text-muted">
                          <div>
                            Interest (lifetime credited):{" "}
                            <span className="font-semibold text-success">
                              {formatCurrencyFaceAmount(interestLife, currency)}
                            </span>
                          </div>
                          {pendingUncredited > 0 && (
                            <div>
                              Accrued, not yet credited:{" "}
                              <span className="font-semibold text-success/90">
                                {formatCurrencyFaceAmount(pendingUncredited, currency)}
                              </span>
                            </div>
                          )}
                          {savingsBal > 0 &&
                            accrualThisTurn != null &&
                            accrualThisTurn > 0 &&
                            turnsUntilCredit != null && (
                              <div>
                                ~{formatCurrencyFaceAmount(accrualThisTurn, currency)} this turn ·
                                credited to balance in {turnsUntilCredit} turn
                                {turnsUntilCredit === 1 ? "" : "s"} (every 12)
                              </div>
                            )}
                        </div>
                      )}
                      {showSavPnlRow && savPnl && (
                        <div
                          className={`text-xs font-medium tabular-nums ${
                            savPnl.pct > 0
                              ? "text-success"
                              : savPnl.pct < 0
                                ? "text-error"
                                : "text-muted"
                          }`}
                        >
                          FX{" "}
                          {pnlMode === "pct"
                            ? formatPct(savPnl.pct)
                            : formatAmount(savPnl.internalDelta)}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {savingsBankHref && (
                      <Link
                        href={savingsBankHref}
                        className="rounded-md border border-primary/25 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                      >
                        Central bank · savings
                      </Link>
                    )}
                    {currency !== wallet.homeCurrency &&
                      balance > 0 &&
                      CURRENCY_COUNTRY_MAP[currency] && (
                        <Link
                          href={`/country/${(CURRENCY_COUNTRY_MAP[currency] ?? "us").toLowerCase()}/forex?tab=trade&from=${currency}`}
                          className="rounded-md border border-card-border bg-card-elevated px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:text-foreground"
                        >
                          Trade FX
                        </Link>
                      )}
                  </div>
                </div>
              </div>
              {wallet.apyByCurrency && FOREX_ACTIVE_CURRENCIES.includes(currency) && (
                <div className="px-5 pb-3">
                  <SavingsWalletBlock
                    currency={currency}
                    liquid={balance}
                    savingsBalance={savingsBal}
                    accountOpened={wallet.savingsAccountsOpened?.[currency] === true}
                    apyPercent={wallet.apyByCurrency[currency]}
                    pendingInterest={wallet.pendingSavingsInterest?.[currency]}
                    turnsUntilCredit={wallet.turnsUntilSavingsCredit}
                    interestAccrualPerTurn={wallet.estimatedSavingsAccrualPerTurn?.[currency]}
                    onUpdated={() => onSavingsUpdated?.()}
                  />
                </div>
              )}
            </div>
          );
        })}

        {personalEntries.length > 1 && (
          <div className="flex items-center justify-between bg-card-elevated/30 px-5 py-3">
            <span className="text-xs font-medium text-muted">Total</span>
            <span className="text-sm font-bold tabular-nums text-foreground">{totalFormatted}</span>
          </div>
        )}
      </div>
    </div>
  );
}
