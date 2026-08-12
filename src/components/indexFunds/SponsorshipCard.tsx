"use client";

import { useState } from "react";
import type { FundDetail } from "@/components/indexFunds/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { expenseRatioBasisPoints } from "@/lib/indexFunds/sponsorship/constants";

/**
 * A5 sponsorship card for the fund detail page. Everyone sees who runs the
 * fund and what it charges; the sponsoring corporation's CEO also gets the
 * wind-up control, behind a hard confirm because it ends the fund for every
 * holder in it.
 */
export function SponsorshipCard({
  fund,
  formatAmount,
  ccy,
  onWindUpStarted,
}: {
  fund: FundDetail;
  formatAmount: (n: number, c?: CurrencyCode) => string;
  ccy: CurrencyCode;
  onWindUpStarted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  if (!fund.sponsorName) return null;

  const windingDown = fund.status === "winding_down" || fund.windDownStartedAtTurn != null;
  const delisted = fund.status === "delisted";
  const canWindUp = fund.viewerIsSponsorCeo === true && !windingDown && !delisted;

  async function windUp() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/index-funds/${fund.slug}/wind-up`, { method: "POST" });
      const body = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) {
        setError(body.error || "Wind-up failed");
      } else {
        setMessage(body.message || "Wind-up has begun.");
        setConfirming(false);
        onWindUpStarted();
      }
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-5 shadow-sm">
      <h2 className="text-sm font-semibold">Sponsored fund</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        Run by <span className="font-medium text-foreground">{fund.sponsorName}</span>, which takes
        an annual expense ratio off assets under management and holds seed capital at risk until
        every unit holder has been paid.
      </p>

      <div className="mt-3 space-y-1.5 text-xs">
        {fund.expenseRatioAnnual != null && (
          <div className="flex justify-between">
            <span className="text-muted">Expense ratio</span>
            <span className="font-mono font-bold">
              {(fund.expenseRatioAnnual * 100).toFixed(2)}% (
              {expenseRatioBasisPoints(fund.expenseRatioAnnual)} bps) / year
            </span>
          </div>
        )}
        {fund.seedCapitalAnchor != null && (
          <div className="flex justify-between">
            <span className="text-muted">Sponsor seed capital</span>
            <span className="font-mono font-bold">{formatAmount(fund.seedCapitalAnchor, ccy)}</span>
          </div>
        )}
        {fund.feesPaidToSponsorAnchor != null && (
          <div className="flex justify-between">
            <span className="text-muted">Fees paid to sponsor</span>
            <span className="font-mono font-bold">
              {formatAmount(fund.feesPaidToSponsorAnchor, ccy)}
            </span>
          </div>
        )}
        {fund.charteredAtTurn != null && (
          <div className="flex justify-between">
            <span className="text-muted">Chartered</span>
            <span className="font-mono font-bold">Turn {fund.charteredAtTurn}</span>
          </div>
        )}
      </div>

      {windingDown && !delisted && (
        <p className="mt-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] text-warning">
          Winding down since turn {fund.windDownStartedAtTurn ?? "?"}. Holdings are being sold,
          holders will be paid at the final value, and the seed capital returns to the sponsor last.
        </p>
      )}

      {message && (
        <p className="mt-3 rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-[11px] text-success">
          {message}
        </p>
      )}
      {error && <p className="mt-3 text-[11px] text-error">{error}</p>}

      {canWindUp && !message && (
        <div className="mt-4 border-t border-card-border pt-3">
          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="w-full rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-xs font-semibold text-error transition-colors hover:bg-error/10"
            >
              Wind up this fund
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-[11px] leading-relaxed text-muted">
                This closes {fund.tickerSymbol} for good. The fund stops taking subscriptions, sells
                its holdings over the coming turns, and pays every holder at the final value. Your
                seed capital comes back only after they are paid, and this cannot be undone.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void windUp()}
                  className="flex-1 rounded-lg bg-error px-3 py-2 text-xs font-semibold text-white transition-opacity disabled:opacity-50"
                >
                  {busy ? "Winding up…" : "Yes, wind it up"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirming(false)}
                  className="flex-1 rounded-lg border border-card-border bg-card px-3 py-2 text-xs font-semibold text-muted transition-colors hover:text-foreground"
                >
                  Keep the fund
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
