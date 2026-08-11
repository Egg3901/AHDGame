"use client";

import { useState } from "react";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { Button } from "@/components/ui";
import type { ForexSpreadView } from "@/app/centralbank/[currency]/components/CentralBankInterventionTab";

interface Props {
  countryId: CountryId;
  currencyCode: CurrencyCode | null;
  forexSpread: ForexSpreadView;
  onChanged: () => void;
}

/**
 * Chair lever: scale the spread fee charged when this currency is sold, 0.5×–1.5×
 * of normal, once per cooldown. Includes the macro explainer for why a chair
 * might raise or lower it.
 */
export function ForexSpreadStrengthControl({
  countryId,
  currencyCode,
  forexSpread,
  onChanged,
}: Props) {
  const [value, setValue] = useState<number>(forexSpread.strength);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const onCooldown = forexSpread.turnsRemaining > 0;
  const locked = !forexSpread.canEdit || onCooldown;
  const dirty = Math.abs(value - forexSpread.strength) > 1e-9;
  const pct = Math.round(value * 100);
  const feePctOfTrade = (1 * value).toFixed(2); // relative multiplier label

  async function save() {
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/country/${countryId}/central-bank/forex-spread`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strength: value }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Failed to set spread strength.");
        return;
      }
      setSuccess(`Spread strength set to ${Math.round(json.strength * 100)}%.`);
      onChanged();
    } catch {
      setError("Network error.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-5">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted">
          Spread fee strength {currencyCode ? `· ${currencyCode}` : ""}
        </h3>
        <span className="font-mono text-lg font-bold tabular-nums text-foreground">{pct}%</span>
      </div>
      <p className="text-xs text-muted">
        Sets the fee charged when {currencyCode ?? "your currency"} is sold, from{" "}
        {forexSpread.min * 100}% to {forexSpread.max * 100}% of normal. 100% is the default. You can
        change it once every {forexSpread.cooldownTurns} turns.
      </p>

      <div className="mt-4">
        <input
          type="range"
          min={forexSpread.min}
          max={forexSpread.max}
          step={0.05}
          value={value}
          disabled={locked || submitting}
          onChange={(e) => setValue(Number(e.target.value))}
          className="w-full accent-primary disabled:opacity-50"
        />
        <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wider text-muted">
          <span>{forexSpread.min * 100}% · cheaper, more volume</span>
          <span>100%</span>
          <span>{forexSpread.max * 100}% · pricier, more reserves</span>
        </div>
      </div>

      {/* Macro explainer */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
            ▼ Lower (toward {forexSpread.min * 100}%)
          </p>
          <p className="mt-1 text-xs text-muted">
            Cheaper to trade {currencyCode ?? "your currency"}, so more people trade it. That makes
            it easier to buy and sell in size, and makes other countries more willing to hold it as
            a reserve, which can push it up the leading-currency ranks and steady its value. The
            cost: your central bank earns less fee revenue on each trade. Real life: a financial hub
            that keeps costs low to pull money in.
          </p>
        </div>
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
            ▲ Raise (toward {forexSpread.max * 100}%)
          </p>
          <p className="mt-1 text-xs text-muted">
            Pricier to trade {currencyCode ?? "your currency"}, so your central bank earns more fees
            and foreign reserves on each trade. The cost makes it harder for fast money to rush in
            and out. The downside: traders may avoid your currency, so it gets harder to buy and
            sell in size. Real life: a tax on currency trades, used to calm speculation and build up
            reserves.
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs text-muted">
          {onCooldown
            ? `On cooldown for another ${forexSpread.turnsRemaining} turn(s).`
            : !forexSpread.canEdit
              ? "Only the chair can adjust this."
              : `Effective fee: ${feePctOfTrade}× the base spread on each ${currencyCode ?? ""} sale.`}
        </p>
        <Button onClick={save} disabled={locked || submitting || !dirty}>
          {submitting ? "Saving…" : "Set strength"}
        </Button>
      </div>
      {success && <p className="mt-2 text-xs text-success">{success}</p>}
      {error && <p className="mt-2 text-xs text-error">{error}</p>}
    </div>
  );
}
