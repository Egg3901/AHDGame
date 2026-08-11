"use client";

import { useState } from "react";
import { trackAction } from "@/lib/observability/actionBreadcrumb";
import { Button } from "@/components/ui";
import { useCurrency } from "@/contexts/CurrencyContext";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { BondDetail } from "./bondTypes";

export function BondBuybackPanel({
  bond,
  bondId,
  onSuccess,
}: {
  bond: BondDetail;
  bondId: string;
  onSuccess: () => void;
}) {
  const { formatAmount, formatPrice, toInternalFrom } = useCurrency();
  // `bond.pricePerUnit`, `json.cost`, and the defaulted-face-value 1000 are all
  // LOCAL in `bond.currencyCode` (Task-18B). Normalize LOCAL → ₳ before format
  // helpers (which expect ₳ and apply wallet-pref display) so foreign-issuer
  // bond buyback costs render with the correct symbol and scale.
  const bondCode = (bond.currencyCode ??
    (bond.countryId
      ? COUNTRY_CURRENCY_MAP[bond.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
      : undefined)) as CurrencyCode | undefined;
  const fmtBondPrice = (val: number) => {
    const anchor = bondCode ? toInternalFrom(val, bondCode) : val;
    return formatPrice(anchor, bondCode);
  };
  const fmtBondAmount = (val: number) => {
    const anchor = bondCode ? toInternalFrom(val, bondCode) : val;
    return formatAmount(anchor, bondCode);
  };
  // 0 == "empty"; lets users backspace the field without it snapping back to 1.
  const [units, setUnits] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const costPerUnit = bond.defaulted ? 1000 : bond.pricePerUnit;
  const totalCost = units * costPerUnit;

  async function handleBuyback() {
    if (units <= 0) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      trackAction("bond.buyback", { bondId, units });
      const res = await fetch(`/api/bonds/${bondId}/buyback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ units }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Buyback failed");
        return;
      }
      setSuccess(`Retired ${json.unitsBoughtBack} units for ${fmtBondAmount(json.cost)}.`);
      onSuccess();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-4">
        Retire Debt
      </h2>
      <p className="text-xs text-muted mb-4">
        Buy back bond units from investors to reduce outstanding debt.
        {bond.defaulted && (
          <span className="text-warning">
            {" "}
            Defaulted bonds are retired at face value ({fmtBondPrice(1000)}/unit).
          </span>
        )}
      </p>
      <div className="flex items-end gap-4 flex-wrap">
        <div>
          <label className="block text-xs text-muted mb-1.5">Units to retire</label>
          <input
            type="number"
            value={units || ""}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") {
                setUnits(0);
                return;
              }
              const n = Math.max(0, Math.floor(Number(raw)));
              setUnits(Math.min(bond.publicFloat, n));
            }}
            min={1}
            max={bond.publicFloat}
            className="w-32 rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:border-primary/60 focus:outline-none"
          />
        </div>
        <div className="rounded-lg border border-card-border bg-card-elevated/40 px-4 py-2.5 text-sm space-y-1">
          <div className="flex justify-between gap-8">
            <span className="text-muted">Cost per unit</span>
            <span className="tabular-nums font-medium text-foreground">
              {fmtBondAmount(costPerUnit)}
            </span>
          </div>
          <div className="flex justify-between gap-8">
            <span className="text-muted">Total cost</span>
            <span className="tabular-nums font-medium text-warning">
              {fmtBondAmount(totalCost)}
            </span>
          </div>
          <div className="flex justify-between gap-8">
            <span className="text-muted">Float remaining after</span>
            <span className="tabular-nums font-medium text-foreground">
              {(bond.publicFloat - units).toLocaleString("en-US")}
            </span>
          </div>
        </div>
      </div>
      {error && <p className="mt-3 text-xs text-error">{error}</p>}
      {success && <p className="mt-3 text-xs text-success">{success}</p>}
      <Button
        variant="secondary"
        onClick={handleBuyback}
        isLoading={loading}
        disabled={loading || units <= 0 || units > bond.publicFloat}
        className="mt-4"
      >
        Retire {units} unit{units !== 1 ? "s" : ""}
      </Button>
    </div>
  );
}
