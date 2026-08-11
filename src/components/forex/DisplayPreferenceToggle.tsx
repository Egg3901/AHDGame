"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { DisplayCurrencyPreference } from "@/lib/utils/formatters";
import { CURRENCY_SYMBOLS, FOREX_ACTIVE_CURRENCIES } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";

/** Client-only: first visit to this control should nudge review; cleared with "Got it". */
const DISPLAY_PREFS_ACK_KEY = "ahd.displayCurrencyPrefsAcknowledged";

const MODE_OPTIONS: {
  key: DisplayCurrencyPreference;
  label: string;
  description: string;
}[] = [
  {
    key: "local",
    label: "Local",
    description:
      "Show each amount in the currency of the country it belongs to. Stocks, bonds, and wallet balances each appear in their native currency.",
  },
  {
    key: "home",
    label: "Home",
    description: "Convert every amount into your character's home currency.",
  },
  {
    key: "internal",
    label: "Base",
    description: "Show raw game values in the internal base unit (₳), with no conversion.",
  },
];

export function DisplayPreferenceToggle() {
  const { displayCurrencyPreference, setDisplayCurrencyPreference, currencySymbol } = useCurrency();

  const [panelOpen, setPanelOpen] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [tipDismissed, setTipDismissed] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      setMounted(true);
    });
  }, []);

  const prefsAcknowledged =
    mounted &&
    typeof localStorage !== "undefined" &&
    localStorage.getItem(DISPLAY_PREFS_ACK_KEY) === "1";

  const showReviewFlag = mounted && !prefsAcknowledged && !tipDismissed;

  const acknowledgePrefsTip = () => {
    try {
      localStorage.setItem(DISPLAY_PREFS_ACK_KEY, "1");
    } catch {
      // ignore quota / private mode
    }
    setTipDismissed(true);
  };

  const modeOption = MODE_OPTIONS.find((o) => o.key === displayCurrencyPreference);
  const pinned: CurrencyCode | null = modeOption
    ? null
    : (displayCurrencyPreference as CurrencyCode);

  const activeDescription = modeOption
    ? modeOption.description
    : `All amounts across the site are converted into ${pinned} (${CURRENCY_SYMBOLS[pinned!] ?? ""}).`;
  const activeLabel = modeOption
    ? modeOption.label
    : `${pinned} (${CURRENCY_SYMBOLS[pinned!] ?? ""})`;

  return (
    <div className="overflow-hidden rounded-xl border border-card-border bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setPanelOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-card-elevated/40"
        aria-expanded={panelOpen}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-muted transition-transform duration-200 ${
              panelOpen ? "rotate-0" : "-rotate-90"
            }`}
            aria-hidden
          />
          <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
            Display Currency
          </h3>
          {showReviewFlag && (
            <span className="inline-flex items-center rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning">
              Review
            </span>
          )}
        </div>
      </button>

      {panelOpen && (
        <div className="space-y-4 border-t border-card-border px-5 pb-5 pt-4">
          {showReviewFlag && (
            <div className="flex flex-col gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-foreground/90">
                <span className="font-semibold text-foreground">First time here?</span> Pick how
                money is shown across the site (stocks, bonds, wallet, treasuries). You can change
                this anytime.
              </p>
              <button
                type="button"
                onClick={acknowledgePrefsTip}
                className="shrink-0 rounded-md bg-foreground/10 px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-foreground/15"
              >
                Got it
              </button>
            </div>
          )}

          <p className="text-xs text-muted">
            Choose how monetary amounts are shown across the site. This affects stock prices,
            balances, bond values, and treasury figures everywhere you see a number.
          </p>

          <div className="space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted">Modes</div>
            <div className="flex w-fit flex-wrap items-center gap-1 rounded-lg border border-card-border bg-card-elevated p-1">
              {MODE_OPTIONS.map(({ key, label }) => (
                <button
                  key={String(key)}
                  type="button"
                  onClick={() => setDisplayCurrencyPreference(key)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    displayCurrencyPreference === key
                      ? "bg-primary text-white shadow-sm"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  {key === "home"
                    ? `${label} (${currencySymbol})`
                    : key === "internal"
                      ? `${label} (₳)`
                      : label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted">
              Pin to a specific currency
            </div>
            <div className="flex w-fit flex-wrap items-center gap-1 rounded-lg border border-card-border bg-card-elevated p-1">
              {FOREX_ACTIVE_CURRENCIES.map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setDisplayCurrencyPreference(code)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    displayCurrencyPreference === code
                      ? "bg-primary text-white shadow-sm"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  {CURRENCY_SYMBOLS[code] ?? ""} {code}
                </button>
              ))}
            </div>
          </div>

          <p className="text-xs text-muted">
            <span className="font-semibold text-foreground">{activeLabel}:</span>{" "}
            {activeDescription}
          </p>
        </div>
      )}
    </div>
  );
}
