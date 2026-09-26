"use client";

import { useEffect, useReducer } from "react";
import { Button, Slider } from "@/components/ui";
import { effectiveBankRatesFromPrime } from "@/lib/banking/rules/rates";
import type { Corridor, ShowToast } from "../types";
import { mergeState } from "../lib/helpers";
import { Eyebrow } from "../components/BankSection";

function corridorSentence(
  corridors: { deposit: Corridor; lending: Corridor },
  primeRate: number | null
): string {
  const prime = primeRate != null ? ` against today's prime of ${primeRate.toFixed(2)}%` : "";
  const deposit =
    corridors.deposit.maxOffset <= 0
      ? "In this country and era, banks must pay savers below prime: you compete for deposits underneath it, not above it."
      : `In this country and era, you may pay up to ${corridors.deposit.maxOffset.toFixed(2)} points above prime to pull savers in.`;
  const lending =
    corridors.lending.minOffset > 0
      ? `Loans must always price above prime (at least ${corridors.lending.minOffset.toFixed(2)} points over).`
      : "Loans may price near prime.";
  return `Your central bank holds deposit offsets between ${corridors.deposit.minOffset.toFixed(2)} and ${corridors.deposit.maxOffset.toFixed(2)} points, and lending offsets between ${corridors.lending.minOffset.toFixed(2)} and ${corridors.lending.maxOffset.toFixed(2)} points${prime}. ${deposit} ${lending}`;
}

export function RateOffsetEditor({
  corporationId,
  corridors,
  depositOffset,
  lendingOffset,
  primeRate,
  canMutate,
  onChanged,
  showToast,
}: {
  corporationId: string;
  corridors: { deposit: Corridor; lending: Corridor };
  depositOffset: number;
  lendingOffset: number;
  /** Prime rate, so the editor can show effective rates beside the offsets. */
  primeRate: number | null;
  canMutate: boolean;
  onChanged: () => Promise<void>;
  showToast: ShowToast;
}) {
  const [{ deposit, lending, busy }, updateRateState] = useReducer(
    mergeState<{ deposit: number; lending: number; busy: boolean }>,
    { deposit: depositOffset, lending: lendingOffset, busy: false }
  );

  useEffect(() => {
    updateRateState({ deposit: depositOffset, lending: lendingOffset });
  }, [depositOffset, lendingOffset]);

  // Effective rates from the same rule module the console prices off
  // (rules/rates.effectiveBankRatesFromPrime): prime plus offset, floored.
  const prime = primeRate ?? 0;
  const effective = effectiveBankRatesFromPrime(
    { depositOffset: deposit, lendingOffset: lending },
    prime
  );
  const spread = effective.lendingRatePercent - effective.depositRatePercent;

  const save = async () => {
    updateRateState({ busy: true });
    try {
      const res = await fetch(`/api/corporations/${corporationId}/bank/rates`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ depositOffset: deposit, lendingOffset: lending }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        // The server rejects out-of-corridor values instead of clamping them.
        showToast(json.error ?? "Could not update rates", "error");
        return;
      }
      showToast(
        `Rates saved: you pay ${effective.depositRatePercent.toFixed(2)}%, charge ${effective.lendingRatePercent.toFixed(2)}%, spread ${spread.toFixed(2)}pp.`,
        "success"
      );
      await onChanged();
    } finally {
      updateRateState({ busy: false });
    }
  };

  const step = 0.05;
  const depositDirection =
    deposit > depositOffset
      ? "Above your current offset: household cash flows in faster."
      : deposit < depositOffset
        ? "Below your current offset: household cash drains toward banks that pay more."
        : "At your current offset: deposit flows hold their course.";
  const lendingDirection =
    lending > lendingOffset
      ? "Above your current offset: loan demand shrinks, but each loan earns more."
      : lending < lendingOffset
        ? "Below your current offset: loan demand grows, but each loan earns less."
        : "At your current offset: loan demand holds its course.";

  return (
    <section className="rounded-xl border border-card-border bg-card p-5 space-y-5 max-w-xl">
      <div>
        <Eyebrow kind="ceoControl" />
        <h3 className="text-base font-semibold text-foreground">Rates</h3>
        <p className="text-sm text-muted">
          You pay {effective.depositRatePercent.toFixed(2)}% on deposits and charge{" "}
          {effective.lendingRatePercent.toFixed(2)}% on loans. The spread between them,{" "}
          <span className="font-semibold text-foreground">{spread.toFixed(2)} points</span>, is what
          the loan book earns before losses and insurance.
        </p>
        <p className="mt-2 text-xs text-muted">{corridorSentence(corridors, primeRate)}</p>
      </div>
      <label className="block space-y-2">
        <div className="flex justify-between text-xs text-muted">
          <span>Deposit offset</span>
          <span className="font-mono tabular-nums">{deposit.toFixed(2)} pp</span>
        </div>
        <Slider
          min={corridors.deposit.minOffset}
          max={corridors.deposit.maxOffset}
          step={step}
          value={deposit}
          disabled={!canMutate}
          onChange={(e) => updateRateState({ deposit: parseFloat(e.target.value) })}
          aria-label="Deposit rate offset"
        />
        <p className="text-xs text-foreground">
          You pay {effective.depositRatePercent.toFixed(2)}% (prime {prime.toFixed(2)}% + offset{" "}
          {deposit.toFixed(2)})
        </p>
        <p className="text-[10px] text-muted font-mono">
          Legal rate limits [{corridors.deposit.minOffset}, {corridors.deposit.maxOffset}]
        </p>
        <p className="text-[11px] text-muted">{depositDirection}</p>
      </label>
      <label className="block space-y-2">
        <div className="flex justify-between text-xs text-muted">
          <span>Lending offset</span>
          <span className="font-mono tabular-nums">{lending.toFixed(2)} pp</span>
        </div>
        <Slider
          min={corridors.lending.minOffset}
          max={corridors.lending.maxOffset}
          step={step}
          value={lending}
          disabled={!canMutate}
          onChange={(e) => updateRateState({ lending: parseFloat(e.target.value) })}
          aria-label="Lending rate offset"
        />
        <p className="text-xs text-foreground">
          You charge {effective.lendingRatePercent.toFixed(2)}% (prime {prime.toFixed(2)}% + offset{" "}
          {lending.toFixed(2)})
        </p>
        <p className="text-[10px] text-muted font-mono">
          Legal rate limits [{corridors.lending.minOffset}, {corridors.lending.maxOffset}]
        </p>
        <p className="text-[11px] text-muted">{lendingDirection}</p>
      </label>
      {canMutate && (
        <Button type="button" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving..." : "Save rates"}
        </Button>
      )}
    </section>
  );
}
