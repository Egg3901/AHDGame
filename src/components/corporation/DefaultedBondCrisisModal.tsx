"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Skeleton } from "@/components/ui";
import { useCurrency } from "@/contexts/CurrencyContext";
import {
  BOND_MATURITY_LABELS,
  CORPORATE_BOND_MATURITY_ISSUANCE_OPTIONS,
} from "@/lib/db/types/bond";
import type { BondMaturityTurns } from "@/lib/db/types/bond";

interface CrisisPayload {
  active: boolean;
  currentTurn: number;
  liquidCapital: number;
  sectorNpv: number;
  totalEquity: number;
  defaultedPrincipal: number;
  creditPenalty: { active: boolean; untilTurn: number | null };
  cash: { canPay: boolean; cost: number };
  refinance: {
    canRefinance: boolean;
    /** True when an active IMF bailout forbids refinancing defaulted debt. */
    imfRestructuring?: boolean;
    requiredFace: number;
    maxAllowedFace: number;
    primeRate: number;
    creditRating: { rating: string; compositeScore: number } | null;
    couponRate: number | null;
    refinanceCount: number;
    maxRefinances: number;
  };
  dissolve: {
    preview: {
      liquidCapital: number;
      sectorNpv: number;
      totalAssets: number;
      totalBondClaims: number;
      bondRecoveryPool: number;
      shareholderPool: number;
      bondRecoveryPct: number;
    };
    shareholders: {
      characterId: string;
      isImperial?: boolean;
      name: string;
      shares: number;
      payout: number;
    }[];
    corporateShareholders: {
      corporationId: string;
      name: string;
      shares: number;
      payout: number;
    }[];
    publicFloat: { shares: number; payout: number } | null;
  };
  restructure: {
    feasible: boolean;
    /** Defaulted principal repaid in full when restructuring. */
    cost: number;
    sectorsToLiquidate: number;
    totalSectors: number;
    proceeds: number;
    needFromSectors: number;
    totalSalvageAvailable: number;
    residualLiquidCapital: number;
  };
}

interface DefaultedBondCrisisModalProps {
  corpId: string;
  open: boolean;
  onClose: () => void;
  onResolved: () => void;
}

const MATURITY_OPTIONS: BondMaturityTurns[] = [...CORPORATE_BOND_MATURITY_ISSUANCE_OPTIONS];

export default function DefaultedBondCrisisModal({
  corpId,
  open,
  onClose,
  onResolved,
}: DefaultedBondCrisisModalProps) {
  const { formatAmount } = useCurrency();
  const [data, setData] = useState<CrisisPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [maturityTurns, setMaturityTurns] = useState<BondMaturityTurns>(96);
  const [submitting, setSubmitting] = useState<
    null | "cash" | "refinance" | "dissolve" | "restructure"
  >(null);
  const [dissolveStep, setDissolveStep] = useState(false);

  const fetchCrisis = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/bond-default`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Failed to load bond default status");
        setData(null);
        return;
      }
      if (!json.active) {
        setData(null);
        return;
      }
      setData(json as CrisisPayload);
    } catch {
      setError("Network error");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [corpId]);

  useEffect(() => {
    if (open) {
      void fetchCrisis();
    }
  }, [open, fetchCrisis]);

  async function handleCash() {
    setSubmitting("cash");
    setError("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/bond-default/cash`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Could not pay");
        return;
      }
      onResolved();
      onClose();
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(null);
    }
  }

  async function handleRefinance() {
    setSubmitting("refinance");
    setError("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/bond-default/refinance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maturityTurns }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Could not refinance");
        return;
      }
      onResolved();
      onClose();
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(null);
    }
  }

  async function handleRestructure() {
    setSubmitting("restructure");
    setError("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/bond-default/restructure`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Could not restructure");
        return;
      }
      onResolved();
      onClose();
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(null);
    }
  }

  async function handleDissolve() {
    setSubmitting("dissolve");
    setError("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/bond-default/dissolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Could not dissolve");
        return;
      }
      window.location.href = "/corporations";
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(null);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
      <div
        className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-error/40 bg-card p-5 shadow-xl"
        role="dialog"
        aria-labelledby="bond-default-title"
        aria-modal="true"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 text-muted hover:text-foreground text-sm"
        >
          Close
        </button>

        <h2 id="bond-default-title" className="text-heading-sm font-semibold text-error pr-10">
          Bond default — action required
        </h2>
        <p className="mt-2 text-body-sm text-muted">
          Your corporation has defaulted on bond obligations. Credit rating is severely impaired
          until the penalty window ends. Resolve the default using one of the options below.
        </p>

        {loading && (
          <div className="mt-4 min-h-[480px] space-y-4">
            <div className="space-y-2 rounded-lg border border-card-border bg-card-muted p-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="flex justify-between gap-2">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-3.5 w-20" />
                </div>
              ))}
            </div>
            {[1, 2, 3].map((i) => (
              <div key={i} className="space-y-2 rounded-lg border border-card-border p-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-9 w-36" />
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-lg border border-error/30 bg-error/10 p-3 text-body-sm text-error">
            {error}
          </div>
        )}

        {!loading && data && (
          <div className="mt-4 space-y-4 text-body-sm">
            <div className="rounded-lg border border-card-border bg-card-muted p-3 space-y-1">
              <div className="flex justify-between gap-2">
                <span className="text-muted">Defaulted principal</span>
                <span className="font-medium text-foreground">
                  {formatAmount(data.defaultedPrincipal)}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted">Liquid capital</span>
                <span className="font-medium text-foreground">
                  {formatAmount(data.liquidCapital)}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted">Sector NPV (est.)</span>
                <span className="font-medium text-foreground">{formatAmount(data.sectorNpv)}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted">Total equity (LC + NPV)</span>
                <span className="font-medium text-foreground">
                  {formatAmount(data.totalEquity)}
                </span>
              </div>
              {data.creditPenalty.untilTurn != null && (
                <div className="flex justify-between gap-2 pt-1 border-t border-card-border mt-2">
                  <span className="text-muted">Credit penalty until turn</span>
                  <span className="font-medium text-warning">{data.creditPenalty.untilTurn}</span>
                </div>
              )}
              {data.refinance.creditRating && (
                <div className="flex justify-between gap-2 pt-1 border-t border-card-border mt-2">
                  <span className="text-muted">Credit (after default penalty)</span>
                  <span className="font-medium text-foreground">
                    {data.refinance.creditRating.rating}{" "}
                    <span className="text-muted font-normal">
                      (score {data.refinance.creditRating.compositeScore})
                    </span>
                  </span>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
              <div className="font-medium text-foreground mb-2">1. Pay cash</div>
              <p className="text-muted text-body-xs mb-2">
                Pay the full defaulted principal from corporate cash. Bondholders receive principal
                and defaulted bonds are closed.
              </p>
              <Button
                variant="primary"
                disabled={!data.cash.canPay || submitting !== null}
                isLoading={submitting === "cash"}
                onClick={handleCash}
              >
                {data.cash.canPay
                  ? `Pay ${formatAmount(data.cash.cost)}`
                  : `Insufficient cash (need ${formatAmount(data.cash.cost)})`}
              </Button>
            </div>

            <div className="rounded-lg border border-secondary/30 bg-secondary/5 p-3">
              <div className="font-medium text-foreground mb-2">2. Refinance</div>
              {data.refinance.imfRestructuring ? (
                <p className="text-body-xs text-warning mb-2 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5">
                  This corporation is under <span className="font-medium">IMF restructuring</span>.
                  Refinancing defaulted bonds is not available until that program ends (admin).
                </p>
              ) : null}
              <p className="text-muted text-body-xs mb-2">
                Roll defaulted bondholders into a new {formatAmount(data.refinance.requiredFace)}{" "}
                bond at par, clearing the default and restoring holders&apos; claim to face value.
                This is a debt-for-debt swap — no cash is added to the corporation. Holders keep
                their units (no payout), and the new bond carries the current (CCC-floored) coupon.
                Still subject to 2× equity limits. Cooldown is waived for this emergency issuance.{" "}
                <span className="text-muted">
                  Used {data.refinance.refinanceCount} of {data.refinance.maxRefinances} lifetime
                  refinances.
                </span>
                {data.refinance.couponRate != null && (
                  <>
                    {" "}
                    Estimated coupon:{" "}
                    <span className="font-medium text-foreground">
                      {data.refinance.couponRate.toFixed(2)}% annual
                    </span>
                    {data.refinance.primeRate != null && (
                      <span className="text-muted">
                        {" "}
                        (prime {data.refinance.primeRate.toFixed(2)}% + credit spread)
                      </span>
                    )}
                    .
                  </>
                )}
              </p>
              <label className="block text-body-xs text-muted mb-1">Maturity</label>
              <select
                value={maturityTurns}
                onChange={(e) => setMaturityTurns(Number(e.target.value) as BondMaturityTurns)}
                className="mb-3 w-full rounded-lg border border-card-border bg-background px-3 py-2 text-body-sm text-foreground"
              >
                {MATURITY_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {BOND_MATURITY_LABELS[t]} ({t} turns)
                  </option>
                ))}
              </select>
              <Button
                variant="secondary"
                disabled={!data.refinance.canRefinance || submitting !== null}
                isLoading={submitting === "refinance"}
                onClick={handleRefinance}
              >
                {data.refinance.canRefinance
                  ? "Issue refinance bond"
                  : data.refinance.imfRestructuring
                    ? "Unavailable (IMF restructuring)"
                    : data.refinance.refinanceCount >= data.refinance.maxRefinances
                      ? `Refinance limit reached (${data.refinance.maxRefinances} used)`
                      : `Cannot issue (max ${formatAmount(data.refinance.maxAllowedFace)} under limits)`}
              </Button>
            </div>

            <div className="rounded-lg border border-accent/30 bg-accent/5 p-3">
              <div className="font-medium text-foreground mb-2">3. Restructure</div>
              <p className="text-muted text-body-xs mb-2">
                Sell off the minimum number of sectors needed to repay defaulted bondholders{" "}
                <em>in full</em>, then clear the default. The corporation survives with its
                remaining sectors and cash. Liquidated sectors recover 85% of their estimated value.
              </p>
              <div className="text-body-xs text-muted mb-2 space-y-0.5">
                <div>
                  Repays bondholders: {formatAmount(data.restructure.cost)} (100% of defaulted
                  principal)
                </div>
                {data.restructure.feasible ? (
                  <>
                    <div>
                      Sectors liquidated: {data.restructure.sectorsToLiquidate} of{" "}
                      {data.restructure.totalSectors} (raises{" "}
                      {formatAmount(data.restructure.proceeds)})
                    </div>
                    <div>
                      Liquid capital after: {formatAmount(data.restructure.residualLiquidCapital)}
                    </div>
                  </>
                ) : (
                  <div className="text-warning">
                    Not enough sector value to cover the default — even selling every sector raises
                    only {formatAmount(data.restructure.totalSalvageAvailable)}. Use Dissolve &amp;
                    settle instead.
                  </div>
                )}
              </div>
              <Button
                variant="secondary"
                disabled={!data.restructure.feasible || submitting !== null}
                isLoading={submitting === "restructure"}
                onClick={handleRestructure}
              >
                {data.restructure.feasible
                  ? `Restructure (sell ${data.restructure.sectorsToLiquidate} sector${
                      data.restructure.sectorsToLiquidate === 1 ? "" : "s"
                    })`
                  : "Insufficient sector value"}
              </Button>
            </div>

            <div className="rounded-lg border border-warning/40 bg-warning/10 p-3">
              <div className="font-medium text-warning mb-2">4. Dissolve &amp; settle</div>
              <p className="text-muted text-body-xs mb-2">
                Liquidate using liquid capital plus sector NPV. Bondholders are paid pro-rata up to
                available assets; remaining assets are distributed to <em>all</em> shareholders
                pro-rata by shares — characters to their cash, corporate equity holders to their
                liquid capital, and the public float slice to the country&apos;s central bank
                reserve. This cannot be undone.
              </p>
              <div className="text-body-xs text-muted mb-2 space-y-0.5">
                <div>
                  Est. bond recovery pool: {formatAmount(data.dissolve.preview.bondRecoveryPool)} (
                  {data.dissolve.preview.bondRecoveryPct}% of claims)
                </div>
                <div>
                  Total shareholder pool (split below):{" "}
                  {formatAmount(data.dissolve.preview.shareholderPool)}
                </div>
              </div>
              {(data.dissolve.shareholders.length > 0 ||
                data.dissolve.corporateShareholders.length > 0 ||
                data.dissolve.publicFloat) && (
                <div className="mb-3 max-h-40 overflow-y-auto rounded border border-card-border bg-card p-2 text-body-xs">
                  <div className="text-muted mb-1">Distribution (est.)</div>
                  {data.dissolve.shareholders.map((r) => (
                    <div key={`c-${r.characterId}`} className="flex justify-between gap-2">
                      <span className="truncate text-foreground">
                        {r.name}
                        {r.isImperial ? " (imperial)" : ""}
                      </span>
                      <span>{formatAmount(r.payout)}</span>
                    </div>
                  ))}
                  {data.dissolve.corporateShareholders.map((r) => (
                    <div key={`x-${r.corporationId}`} className="flex justify-between gap-2">
                      <span className="truncate text-foreground">{r.name} (corp)</span>
                      <span>{formatAmount(r.payout)}</span>
                    </div>
                  ))}
                  {data.dissolve.publicFloat && data.dissolve.publicFloat.payout > 0 && (
                    <div className="flex justify-between gap-2">
                      <span className="truncate text-foreground">
                        Public float → central bank reserve
                      </span>
                      <span>{formatAmount(data.dissolve.publicFloat.payout)}</span>
                    </div>
                  )}
                </div>
              )}
              {!dissolveStep ? (
                <Button
                  variant="ghost"
                  className="border border-warning/50 text-warning hover:bg-warning/10"
                  disabled={submitting !== null}
                  onClick={() => setDissolveStep(true)}
                >
                  Continue to dissolution…
                </Button>
              ) : (
                <div className="space-y-2">
                  <p className="text-error text-body-xs font-medium">
                    Confirm: permanently dissolve the corporation and distribute proceeds as
                    estimated above?
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="primary"
                      className="bg-error hover:bg-error/90"
                      disabled={submitting !== null}
                      isLoading={submitting === "dissolve"}
                      onClick={handleDissolve}
                    >
                      Yes, dissolve corporation
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={submitting !== null}
                      onClick={() => setDissolveStep(false)}
                    >
                      Back
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
