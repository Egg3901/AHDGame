"use client";

import { useEffect, useState } from "react";
import { Slider } from "@/components/ui";
import { formatBankMoney } from "@/components/banking/formatBankMoney";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { ShowToast } from "../types";
import { SmallButton } from "@/components/corporation/dense/DenseKit";
import { BankPanel } from "../components/BankSection";

export function CapacityAllocationEditor({
  corporationId,
  currency,
  branchCapacityShare,
  depositCeiling,
  capacityCeiling,
  equityCeiling,
  depositCeilingBinds,
  canMutate,
  onChanged,
  showToast,
}: {
  corporationId: string;
  currency: CurrencyCode;
  branchCapacityShare: number;
  depositCeiling: number;
  /** Branch-capacity ceiling before the equity cap, for the live preview. */
  capacityCeiling: number | null;
  /** Equity ceiling (12x book equity), for the live preview. */
  equityCeiling: number | null;
  /** Which ceiling binds right now. */
  depositCeilingBinds: "capacity" | "equity" | null;
  canMutate: boolean;
  onChanged: () => Promise<void>;
  showToast: ShowToast;
}) {
  const [share, setShare] = useState(branchCapacityShare);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setShare(branchCapacityShare);
  }, [branchCapacityShare]);

  // Live preview from the same two lines the balance sheet takes the minimum
  // of: branch capacity scales with the share, equity caps at 12x book equity.
  const sectorCapacity =
    capacityCeiling != null && branchCapacityShare > 0
      ? capacityCeiling / branchCapacityShare
      : null;
  const previewCapacity = sectorCapacity != null ? sectorCapacity * share : null;
  const previewCeiling =
    previewCapacity != null && equityCeiling != null
      ? Math.min(previewCapacity, equityCeiling)
      : null;
  const previewBinds =
    previewCapacity != null && equityCeiling != null
      ? equityCeiling <= previewCapacity
        ? ("equity" as const)
        : ("capacity" as const)
      : null;

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
      showToast(
        previewCeiling != null
          ? `Network share saved: deposit ceiling now ${formatBankMoney(previewCeiling, currency)}, binding on ${previewBinds === "equity" ? "12x equity" : "deposit network"}.`
          : "Network share saved",
        "success"
      );
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <BankPanel
      kind="ceoControl"
      title="Deposit network share"
      actions={
        canMutate ? (
          <SmallButton tone="primary" onClick={() => void save()} disabled={busy}>
            {busy ? "Saving..." : "Save allocation"}
          </SmallButton>
        ) : undefined
      }
    >
      <div className="grid gap-x-8 gap-y-3 py-1.5 md:grid-cols-2">
        <div className="space-y-1.5">
          <p className="text-xs text-muted">
            Share of your financial-sector capacity running the branch network that holds deposits.
            The rest produces financial services for the commodity market. Range 10% to 90%.
          </p>
          <p className="text-xs text-muted">
            Ceiling{" "}
            <span className="font-mono tabular-nums text-foreground">
              {formatBankMoney(depositCeiling, currency)}
            </span>
            {depositCeilingBinds && (
              <>, binds on {depositCeilingBinds === "equity" ? "12x equity" : "deposit network"}</>
            )}
          </p>
        </div>
        <label className="block min-w-0 space-y-1.5">
          <span className="flex justify-between text-xs text-muted">
            <span>Deposit network share</span>
            <span className="font-mono tabular-nums text-foreground">
              {(share * 100).toFixed(0)}%
            </span>
          </span>
          <Slider
            min={0.1}
            max={0.9}
            step={0.05}
            value={share}
            disabled={!canMutate}
            onChange={(e) => setShare(parseFloat(e.target.value))}
            aria-label="Deposit network share"
          />
          <span className="block font-mono text-[11px] text-muted">
            commodity {(100 - share * 100).toFixed(0)}%, branches {(share * 100).toFixed(0)}%
          </span>
          {previewCeiling != null && previewBinds != null ? (
            <span className="block text-[11px] text-muted">
              At {(share * 100).toFixed(0)}% the ceiling would be{" "}
              {formatBankMoney(previewCeiling, currency)}, binding on{" "}
              {previewBinds === "equity" ? "12x book equity" : "deposit network"}. Every point moved
              to branches is a point not producing financial-services output.
            </span>
          ) : (
            <span className="block text-[11px] text-muted">
              Moving share to branches raises the branch-capacity half of the ceiling; the
              12x-equity half does not move. Every point moved to branches is a point not producing
              financial-services output.
            </span>
          )}
        </label>
      </div>
    </BankPanel>
  );
}
