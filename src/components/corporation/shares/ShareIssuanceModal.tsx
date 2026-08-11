"use client";

import { useState, useMemo } from "react";
import { Button, Slider } from "@/components/ui";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useLocalCurrency } from "@/hooks/useLocalCurrency";
import type { CorporationDetail } from "../CorporationPageTypes";
import { MAX_SELF_ISSUANCE_PERCENT } from "@/lib/constants/corporations";
import type { CurrencyCode } from "@/lib/constants/currencies";

type IssuanceMode = "public" | "ceo";

interface ShareIssuanceModalProps {
  corporation: CorporationDetail;
  corpId: string;
  /** Total personal liquid wealth in ₳ (from `getTotalPersonalWealth`). */
  myCashOnHand: number;
  /** Per-currency personal liquid balances — used to re-anchor against corp LOCAL cost. */
  myCurrencyBalances?: Partial<Record<string, number>>;
  issuanceOnCooldown: boolean;
  issuanceCooldownRemaining: number;
  /** Which mode the modal opens in; defaults to "public" issuance. */
  initialMode?: IssuanceMode;
  onClose: () => void;
  onSuccess: () => void;
}

const CEO_PREMIUM = 0.15;
const MAX_ISSUE_PCT = 50;

export default function ShareIssuanceModal({
  corporation,
  corpId,
  myCashOnHand,
  myCurrencyBalances,
  issuanceOnCooldown,
  issuanceCooldownRemaining,
  initialMode = "public",
  onClose,
  onSuccess,
}: ShareIssuanceModalProps) {
  // sharePrice-derived values (issuanceProceeds, dilutedPrice, ceoPricePerShare,
  // ceoTotalCost) are all in corp LOCAL currency — route through useLocalCurrency
  // so wallet-pref display matches the Hero and Market Overview.
  const { formatFull: fmtFull, toInternalFrom, forexRates } = useCurrency();
  const { fmtPrice: fmtLocalPrice, fmtFull: fmtLocalFull } = useLocalCurrency(
    corporation.liquidCurrencyCode
  );

  const [mode, setMode] = useState<IssuanceMode>(initialMode);
  const [issuePercent, setIssuePercent] = useState(5);
  const [ceoShares, setCeoShares] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [voteError, setVoteError] = useState("");

  const corpCurrency = (corporation.liquidCurrencyCode ?? "USD") as CurrencyCode;

  // Balance check math pivots through ₳ to mirror the server (`/shares/self-issue`
  // pivots LOCAL → ₳ → HOME before deducting). Previously the client summed
  // currency balances into the viewer's HOME currency and compared against a
  // LOCAL corp cost — which silently mismatched whenever corp currency ≠ home.
  // `myCashOnHand` is already ₳ via `getTotalPersonalWealth`; multi-currency
  // balances are re-anchored so savings-less personal liquid is comparable.
  const liquidPersonalAnchor = useMemo(() => {
    if (!forexRates || !myCurrencyBalances || Object.keys(myCurrencyBalances).length === 0) {
      return myCashOnHand;
    }
    return Object.entries(myCurrencyBalances).reduce((sum, [code, amt]) => {
      const n = typeof amt === "number" ? amt : 0;
      if (n <= 0) return sum;
      return sum + toInternalFrom(n, code as CurrencyCode);
    }, 0);
  }, [myCashOnHand, myCurrencyBalances, forexRates, toInternalFrom]);

  // ─── Public issuance derived values ──────────────────────────────────────────
  const newSharesToIssue = useMemo(
    () => Math.floor((issuePercent / 100) * corporation.totalShares),
    [issuePercent, corporation.totalShares]
  );
  const dilutionFraction =
    corporation.totalShares > 0 ? newSharesToIssue / corporation.totalShares : 0;
  const requiresVote = !corporation.isPrivate && dilutionFraction > 0.1;
  const issuanceProceeds = newSharesToIssue * corporation.sharePrice;
  const newTotalShares = corporation.totalShares + newSharesToIssue;
  const dilutedPrice = (corporation.sharePrice * corporation.totalShares) / newTotalShares;
  const priceChangePct = ((dilutedPrice - corporation.sharePrice) / corporation.sharePrice) * 100;

  // ─── CEO self-issuance derived values ────────────────────────────────────────
  const ceoPricePerShare = corporation.sharePrice * (1 + CEO_PREMIUM); // LOCAL
  const ceoTotalCost = ceoShares * ceoPricePerShare; // LOCAL
  const ceoPricePerShareAnchor = toInternalFrom(ceoPricePerShare, corpCurrency);
  const ceoTotalCostAnchor = toInternalFrom(ceoTotalCost, corpCurrency);
  const ceoHasInsufficientFunds = ceoShares > 0 && ceoTotalCostAnchor > liquidPersonalAnchor;
  const cooldownHours = Math.ceil(issuanceCooldownRemaining / 1000 / 60 / 60);

  // Max shares the CEO can self-issue: capped by 20% of outstanding AND personal cash.
  // Cash cap divides an ₳ balance by an ₳ price-per-share so units line up.
  const maxCeoSharesByPercent = Math.floor(
    (MAX_SELF_ISSUANCE_PERCENT / 100) * corporation.totalShares
  );
  const maxCeoSharesByFunds =
    ceoPricePerShareAnchor > 0 ? Math.floor(liquidPersonalAnchor / ceoPricePerShareAnchor) : 0;
  const maxCeoShares = Math.max(0, Math.min(maxCeoSharesByPercent, maxCeoSharesByFunds));

  // ─── Submit ───────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    setError("");
    setLoading(true);
    try {
      if (mode === "public") {
        const res = await fetch(`/api/corporations/${corpId}/shares/issue`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ percent: issuePercent }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Failed to issue shares");
          return;
        }
      } else {
        const res = await fetch(`/api/corporations/${corpId}/shares/self-issue`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shares: ceoShares }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Failed to purchase shares");
          return;
        }
      }
      onSuccess();
      onClose();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handleProposeIssuance() {
    setLoading(true);
    setVoteError("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/votes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "share_issuance",
          newShareCount: newSharesToIssue,
          issuancePrice: corporation.sharePrice,
          issuanceCurrencyCode: corporation.liquidCurrencyCode ?? "USD",
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to open vote");
      onSuccess();
      onClose();
    } catch (e) {
      setVoteError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  const canSubmit =
    !loading &&
    !issuanceOnCooldown &&
    (mode === "public" ? newSharesToIssue >= 1 : ceoShares > 0 && !ceoHasInsufficientFunds);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-card-border bg-card shadow-modal">
        {/* ─── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between border-b border-card-border px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Issue Shares</h2>
            <p className="mt-0.5 text-sm text-muted">
              {corporation.name}
              <span className="mx-2 text-card-border">·</span>
              <span className="tabular-nums text-foreground font-medium">
                {corporation.totalShares.toLocaleString("en-US")}
              </span>{" "}
              outstanding
              <span className="mx-2 text-card-border">·</span>
              <span className="tabular-nums">{fmtLocalPrice(corporation.sharePrice)}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-4 -mt-0.5 text-muted transition-colors hover:text-foreground"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* ─── Mode picker ─────────────────────────────────────────────────── */}
        <div className="border-b border-card-border px-6 py-4">
          <div className="flex overflow-hidden rounded-lg border border-card-border text-sm">
            <button
              type="button"
              onClick={() => {
                setMode("public");
                setError("");
              }}
              className={[
                "flex-1 border-r border-card-border px-3 py-2.5 text-center transition-colors",
                mode === "public"
                  ? "bg-primary text-white font-semibold"
                  : "bg-card-elevated text-muted hover:text-foreground",
              ].join(" ")}
            >
              To Public Float
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("ceo");
                setError("");
              }}
              className={[
                "flex-1 px-3 py-2.5 text-center transition-colors",
                mode === "ceo"
                  ? "bg-warning text-black font-semibold"
                  : "bg-card-elevated text-muted hover:text-foreground",
              ].join(" ")}
            >
              CEO Purchase
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">
            {mode === "public"
              ? "Issue new shares to the market. Raises capital but dilutes existing shareholders."
              : "Personally buy newly issued shares at a 15% premium. Capital goes directly to the corporation."}
          </p>
          <p className="mt-2 rounded-lg border border-warning/25 bg-warning/5 px-3 py-2 text-[11px] leading-snug text-warning">
            CEO acquisition limit: as CEO you can buy at most 10% of this corporation&apos;s total
            shares every 120 turns, combined across public-float buys and purchases from other
            players (this self-issuance is separate). Buying the full 10% locks further purchases
            until the oldest counts age out.
          </p>
        </div>

        {/* ─── Body ────────────────────────────────────────────────────────── */}
        <div className="max-h-[60vh] overflow-y-auto px-6 py-5 space-y-4">
          {/* Public Issuance ─────────────────────────────────── */}
          {mode === "public" && (
            <div className="space-y-4">
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-xs text-muted">
                    Issuance size —{" "}
                    <span className="text-foreground font-medium">{issuePercent.toFixed(1)}%</span>{" "}
                    of outstanding
                  </label>
                  <span className="text-xs text-muted">Max 50%</span>
                </div>
                <div className="flex items-center gap-3">
                  <Slider
                    min={0.1}
                    max={MAX_ISSUE_PCT}
                    step={0.1}
                    value={issuePercent}
                    onChange={(e) => setIssuePercent(Number(e.target.value))}
                    variant="primary"
                    className="flex-1"
                  />
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0.1}
                      max={MAX_ISSUE_PCT}
                      step={0.1}
                      value={issuePercent}
                      onChange={(e) =>
                        setIssuePercent(
                          Math.max(0.1, Math.min(MAX_ISSUE_PCT, Number(e.target.value)))
                        )
                      }
                      className="w-16 rounded-lg border border-card-border bg-background px-2 py-2 text-sm focus:border-primary/60 focus:outline-none"
                    />
                    <span className="text-sm text-muted">%</span>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-card-border bg-card-elevated/40 p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted">New shares issued</span>
                  <span className="tabular-nums font-medium text-foreground">
                    +{newSharesToIssue.toLocaleString("en-US")}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Proceeds to corporation</span>
                  <span className="tabular-nums font-medium text-success">
                    {fmtLocalFull(Math.round(issuanceProceeds))}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">New total shares</span>
                  <span className="tabular-nums font-medium text-foreground">
                    {newTotalShares.toLocaleString("en-US")}
                  </span>
                </div>
                <div className="flex justify-between border-t border-card-border pt-2">
                  <span className="text-muted">Price after dilution</span>
                  <span className="tabular-nums font-medium text-warning">
                    {fmtLocalPrice(dilutedPrice)}{" "}
                    <span className="text-xs text-muted">({priceChangePct.toFixed(1)}%)</span>
                  </span>
                </div>
              </div>

              <div className="rounded-lg border border-warning/25 bg-warning/5 px-3 py-2.5 text-xs text-warning">
                Dilutes all existing shareholders proportionally.
              </div>
            </div>
          )}

          {/* CEO Purchase ────────────────────────────────────── */}
          {mode === "ceo" && (
            <div className="space-y-4">
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-xs text-muted">
                    Shares to purchase —{" "}
                    <span className="text-foreground font-medium">
                      {ceoShares.toLocaleString("en-US")}
                    </span>{" "}
                    shares
                  </label>
                  <span className="text-xs text-muted">
                    Max {maxCeoShares.toLocaleString("en-US")}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <Slider
                    min={0}
                    max={Math.max(1, maxCeoShares)}
                    step={1}
                    value={ceoShares}
                    onChange={(e) =>
                      setCeoShares(
                        Math.min(maxCeoShares, Math.max(0, Math.floor(Number(e.target.value))))
                      )
                    }
                    variant="primary"
                    className="flex-1"
                    disabled={maxCeoShares === 0}
                  />
                  <input
                    type="number"
                    min={0}
                    max={maxCeoShares}
                    step={1}
                    value={ceoShares || ""}
                    onChange={(e) =>
                      setCeoShares(
                        Math.max(0, Math.min(maxCeoShares, Math.floor(Number(e.target.value))))
                      )
                    }
                    placeholder="0"
                    className="w-20 rounded-lg border border-card-border bg-background px-2 py-2 text-sm focus:border-primary/60 focus:outline-none"
                  />
                </div>
              </div>

              <div className="rounded-lg border border-card-border bg-card-elevated/40 p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted">Market price</span>
                  <span className="tabular-nums font-medium text-foreground">
                    {fmtLocalPrice(corporation.sharePrice)}/share
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Your price (+15% premium)</span>
                  <span className="tabular-nums font-medium text-foreground">
                    {fmtLocalPrice(ceoPricePerShare)}/share
                  </span>
                </div>
                <div className="flex justify-between border-t border-card-border pt-2">
                  <span className="text-muted">Total cost (from your cash)</span>
                  <span
                    className={`tabular-nums font-medium ${ceoHasInsufficientFunds ? "text-error" : "text-warning"}`}
                  >
                    {fmtLocalFull(Math.round(ceoTotalCost))}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Spendable liquid</span>
                  <span className="tabular-nums font-medium">
                    {fmtFull(Math.round(liquidPersonalAnchor))}
                  </span>
                </div>
                <div className="flex justify-between border-t border-card-border pt-2">
                  <span className="text-muted">Proceeds to corporation</span>
                  <span className="tabular-nums font-medium text-success">
                    {fmtLocalFull(Math.round(ceoTotalCost))}
                  </span>
                </div>
                {ceoHasInsufficientFunds && (
                  <p className="text-xs text-error">
                    Short by {fmtFull(Math.round(ceoTotalCostAnchor - liquidPersonalAnchor))}.
                  </p>
                )}
              </div>

              <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-xs text-muted">
                New shares issued directly to you. Payment uses your personal liquid balances; other
                currencies auto-convert at the market spread if enabled. Proceeds strengthen the
                corporate balance sheet and increase your ownership stake.
              </div>
            </div>
          )}

          {/* Cooldown notice */}
          {issuanceOnCooldown && (
            <div className="rounded-lg border border-card-border bg-card-elevated/40 px-3 py-2.5 text-xs text-muted">
              Issuance limited to once per 24 hours — available again in{" "}
              <span className="text-foreground font-medium">{cooldownHours}h</span>.
            </div>
          )}

          {error && <p className="text-xs text-error">{error}</p>}
        </div>

        {/* ─── Footer ──────────────────────────────────────────────────────── */}
        <div className="border-t border-card-border px-6 py-4 space-y-3">
          {mode === "public" && requiresVote && (
            <p className="text-xs text-amber-600">
              This issuance causes {(dilutionFraction * 100).toFixed(1)}% dilution and requires a
              shareholder vote.
            </p>
          )}
          {voteError && <p className="text-xs text-error">{voteError}</p>}
          <div className="flex items-center justify-end gap-3">
            <Button variant="ghost" onClick={onClose} className="text-sm">
              Cancel
            </Button>
            {mode === "public" && requiresVote ? (
              <Button
                variant="primary"
                onClick={handleProposeIssuance}
                disabled={loading || !newSharesToIssue}
                isLoading={loading}
                className="text-sm shadow-none"
              >
                Propose Share Issuance (shareholder vote)
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={handleSubmit}
                disabled={!canSubmit}
                isLoading={loading}
                className={`text-sm shadow-none ${mode === "ceo" ? "bg-warning hover:bg-warning/90 text-black" : ""}`}
              >
                {mode === "public"
                  ? `Issue ${newSharesToIssue.toLocaleString("en-US")} Shares`
                  : "Purchase at Premium"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
