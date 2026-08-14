"use client";

import { useEffect, useState } from "react";
import { Button, Slider } from "@/components/ui";
import { formatBankMoney } from "@/components/banking/formatBankMoney";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { ShowToast } from "../types";

export function CapacityAllocationEditor({
  corporationId,
  currency,
  branchCapacityShare,
  depositCeiling,
  canMutate,
  onChanged,
  showToast,
}: {
  corporationId: string;
  currency: CurrencyCode;
  branchCapacityShare: number;
  depositCeiling: number;
  canMutate: boolean;
  onChanged: () => Promise<void>;
  showToast: ShowToast;
}) {
  const [share, setShare] = useState(branchCapacityShare);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setShare(branchCapacityShare);
  }, [branchCapacityShare]);

  const save = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/corporations/${corporationId}/bank/capacity`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchCapacityShare: share }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showToast(json.error ?? "Could not update capacity allocation", "error");
        return;
      }
      showToast("Capacity allocation saved", "success");
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-card-border bg-card p-5 space-y-4 max-w-xl">
      <div>
        <h3 className="text-base font-semibold text-foreground">Capacity allocation</h3>
        <p className="text-sm text-muted">
          Share of financial-sector capacity running the branch network (deposit ceiling). The rest
          produces financial services for the commodity market. Range 10% to 90%.
        </p>
      </div>
      <p className="text-sm font-mono tabular-nums text-foreground">
        Ceiling {formatBankMoney(depositCeiling, currency)}
      </p>
      <label className="block space-y-2">
        <div className="flex justify-between text-xs text-muted">
          <span>Branch share</span>
          <span className="font-mono tabular-nums">{(share * 100).toFixed(0)}%</span>
        </div>
        <Slider
          min={0.1}
          max={0.9}
          step={0.05}
          value={share}
          disabled={!canMutate}
          onChange={(e) => setShare(parseFloat(e.target.value))}
          aria-label="Branch capacity share"
        />
        <p className="text-[10px] text-muted font-mono">
          commodity {(100 - share * 100).toFixed(0)}% · branch {(share * 100).toFixed(0)}%
        </p>
      </label>
      {canMutate && (
        <Button type="button" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving..." : "Save allocation"}
        </Button>
      )}
    </section>
  );
}
