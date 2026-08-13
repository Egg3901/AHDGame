"use client";

import { useReducer } from "react";
import { Badge, Button, EmptyState, Input } from "@/components/ui";
import { formatBankMoney } from "@/components/banking/formatBankMoney";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { ConsolePayload, ShowToast } from "../types";
import { mergeState } from "../lib/helpers";

type PropAsset = "equity" | "bond" | "indexUnit" | "forex";

/**
 * The open-position form and its in-flight flag move as one group: a successful
 * open clears the ref and the units together, and both buttons read the same
 * busy flag.
 */
type PropBookState = {
  asset: PropAsset;
  ref: string;
  units: string;
  busy: boolean;
};

export function PropBookPanel({
  corporationId,
  currency,
  positions,
  markValue,
  canMutate,
  onChanged,
  showToast,
}: {
  corporationId: string;
  currency: CurrencyCode;
  positions: NonNullable<ConsolePayload["charter"]>["propBook"];
  markValue: number;
  canMutate: boolean;
  onChanged: () => Promise<void>;
  showToast: ShowToast;
}) {
  const [{ asset, ref, units, busy }, updatePropState] = useReducer(mergeState<PropBookState>, {
    asset: "equity",
    ref: "",
    units: "",
    busy: false,
  });

  const open = async () => {
    const u = parseFloat(units);
    if (!ref.trim() || !(u > 0)) {
      showToast("Ref and positive units are required", "error");
      return;
    }
    updatePropState({ busy: true });
    try {
      const res = await fetch(`/api/corporations/${corporationId}/bank/prop/positions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asset, ref: ref.trim(), units: u }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showToast(json.error ?? "Could not open position", "error");
        return;
      }
      showToast("Position opened", "success");
      updatePropState({ ref: "", units: "" });
      await onChanged();
    } finally {
      updatePropState({ busy: false });
    }
  };

  const close = async (pos: (typeof positions)[number]) => {
    updatePropState({ busy: true });
    try {
      const res = await fetch(`/api/corporations/${corporationId}/bank/prop/positions`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asset: pos.asset, ref: pos.ref, units: pos.units }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showToast(json.error ?? "Could not close position", "error");
        return;
      }
      showToast("Position closed", "success");
      await onChanged();
    } finally {
      updatePropState({ busy: false });
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-foreground">Prop book</h3>
        <p className="text-sm font-mono tabular-nums text-muted">
          Mark {formatBankMoney(markValue, currency)}
        </p>
      </div>
      {canMutate && (
        <div className="rounded-xl border border-card-border bg-card p-4 grid gap-3 sm:grid-cols-4 max-w-3xl">
          <label className="block space-y-1 text-xs text-muted">
            Asset
            <select
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground"
              value={asset}
              onChange={(e) => updatePropState({ asset: e.target.value as PropAsset })}
              aria-label="Prop asset type"
            >
              <option value="equity">Equity</option>
              <option value="bond">Bond</option>
              <option value="indexUnit">Index unit</option>
              <option value="forex">Forex</option>
            </select>
          </label>
          <label className="block space-y-1 text-xs text-muted sm:col-span-2">
            Ref
            <Input
              value={ref}
              onChange={(e) => updatePropState({ ref: e.target.value })}
              placeholder="company name or # / bond ID / fund name / currency"
              aria-label="Prop position ref"
            />
          </label>
          <label className="block space-y-1 text-xs text-muted">
            Units
            <Input
              value={units}
              onChange={(e) => updatePropState({ units: e.target.value })}
              inputMode="decimal"
              aria-label="Prop position units"
            />
          </label>
          <div className="sm:col-span-4">
            <Button type="button" onClick={() => void open()} disabled={busy}>
              {busy ? "Working..." : "Open position"}
            </Button>
          </div>
        </div>
      )}
      {positions.length === 0 ? (
        <EmptyState title="No prop positions" description="Open a position to start the book." />
      ) : (
        <div className="overflow-x-auto overflow-hidden rounded-xl border border-card-border bg-card">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="border-b border-card-border text-left text-[10px] uppercase tracking-widest text-muted">
                <th className="px-4 py-3 font-semibold">Asset</th>
                <th className="px-4 py-3 font-semibold">Ref</th>
                <th className="px-4 py-3 font-semibold text-right">Units</th>
                <th className="px-4 py-3 font-semibold text-right">Cost</th>
                <th className="px-4 py-3 font-semibold text-right">Mark</th>
                <th className="px-4 py-3 font-semibold" />
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {positions.map((pos) => (
                <tr key={`${pos.asset}:${pos.ref}`}>
                  <td className="px-4 py-3">
                    <Badge color="default" variant="subtle">
                      {pos.asset}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">{pos.ref}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {pos.units.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {formatBankMoney(pos.costBasis, currency)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {pos.markValue != null ? formatBankMoney(pos.markValue, currency) : "-"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canMutate && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void close(pos)}
                      >
                        Close
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
