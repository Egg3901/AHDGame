"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState, Input, Skeleton } from "@/components/ui";
import { useToast } from "@/contexts/ToastContext";
import type { CurrencyCode } from "@/lib/constants/currencies";
// From `reserveBounds`, NOT `reserves`: the latter reaches mongodb and the
// turn engine, and importing it here put `sharp` in the browser bundle.
import {
  RESERVE_REQUIREMENT_MAX,
  RESERVE_REQUIREMENT_MIN,
} from "@/lib/banking/reserveBounds";

type CurrencyPayload = {
  privateBankingEnabled: boolean;
  currency: CurrencyCode;
  reserveRatio: number;
  reserveMin: number;
  reserveMax: number;
  canEditReserve: boolean;
};

interface Props {
  currency: CurrencyCode;
}

export function CentralBankReserveTab({ currency }: Props) {
  const { showToast } = useToast();
  const [data, setData] = useState<CurrencyPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ratioStr, setRatioStr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/banking/currency/${currency.toLowerCase()}`);
      const json = (await res.json().catch(() => ({}))) as CurrencyPayload & { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Failed to load reserve requirement");
        setData(null);
        return;
      }
      setError(null);
      setData(json);
      setRatioStr((json.reserveRatio * 100).toFixed(1));
    } catch {
      setError("Failed to load reserve requirement");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [currency]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    const pct = parseFloat(ratioStr);
    if (!Number.isFinite(pct)) {
      showToast("Enter a valid percentage", "error");
      return;
    }
    const ratio = pct / 100;
    if (ratio < RESERVE_REQUIREMENT_MIN || ratio > RESERVE_REQUIREMENT_MAX) {
      showToast(
        `Reserve requirement must be between ${RESERVE_REQUIREMENT_MIN * 100}% and ${RESERVE_REQUIREMENT_MAX * 100}%`,
        "error"
      );
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/banking/reserve-requirement", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currency, ratio }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showToast(json.error ?? "Could not update reserve requirement", "error");
        return;
      }
      showToast("Reserve requirement updated", "success");
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) {
    return <Skeleton className="h-40 w-full rounded-xl" />;
  }

  if (error || !data) {
    return <EmptyState title="Reserve requirement unavailable" description={error ?? undefined} />;
  }

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Reserve requirement</h2>
        <p className="mt-1 text-sm text-muted">
          Fraction of private-bank deposits that must be held as liquid reserves in {currency}.
          Applies to retail and universal charters.
        </p>
      </div>
      <div className="rounded-xl border border-card-border bg-card p-5 space-y-4">
        <p className="text-3xl font-display font-bold tabular-nums text-foreground">
          {(data.reserveRatio * 100).toFixed(1)}%
        </p>
        <p className="text-xs text-muted font-mono">
          Allowed range {data.reserveMin * 100}% to {data.reserveMax * 100}%
        </p>
        {data.canEditReserve ? (
          <div className="flex flex-wrap items-end gap-3">
            <label className="block space-y-1 text-xs text-muted">
              New ratio (%)
              <Input
                value={ratioStr}
                onChange={(e) => setRatioStr(e.target.value)}
                inputMode="decimal"
                aria-label="Reserve requirement percent"
              />
            </label>
            <Button type="button" onClick={() => void save()} disabled={busy}>
              {busy ? "Saving..." : "Save"}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted">
            {data.privateBankingEnabled
              ? "Only the chair of this central bank (or an admin) can change the reserve requirement."
              : "Private banking is frozen. The reserve requirement is read-only."}
          </p>
        )}
      </div>
    </div>
  );
}
