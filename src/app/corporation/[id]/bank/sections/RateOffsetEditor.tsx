"use client";

import { useEffect, useReducer } from "react";
import { Button, Slider } from "@/components/ui";
import type { Corridor, ShowToast } from "../types";
import { mergeState } from "../lib/helpers";

export function RateOffsetEditor({
  corporationId,
  corridors,
  depositOffset,
  lendingOffset,
  canMutate,
  onChanged,
  showToast,
}: {
  corporationId: string;
  corridors: { deposit: Corridor; lending: Corridor };
  depositOffset: number;
  lendingOffset: number;
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
        showToast(json.error ?? "Could not update rates", "error");
        return;
      }
      showToast("Rate offsets saved", "success");
      await onChanged();
    } finally {
      updateRateState({ busy: false });
    }
  };

  const step = 0.05;

  return (
    <section className="rounded-xl border border-card-border bg-card p-5 space-y-5 max-w-xl">
      <div>
        <h3 className="text-base font-semibold text-foreground">Rate offsets</h3>
        <p className="text-sm text-muted">
          Offsets are percentage points versus the central bank prime, bounded by the Regulation Q
          corridor.
        </p>
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
        <p className="text-[10px] text-muted font-mono">
          corridor [{corridors.deposit.minOffset}, {corridors.deposit.maxOffset}]
        </p>
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
        <p className="text-[10px] text-muted font-mono">
          corridor [{corridors.lending.minOffset}, {corridors.lending.maxOffset}]
        </p>
      </label>
      {canMutate && (
        <Button type="button" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving..." : "Save offsets"}
        </Button>
      )}
    </section>
  );
}
