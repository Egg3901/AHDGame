"use client";

import { useMemo, useState } from "react";
import {
  IPO_MIN_FLOAT_PCT,
  IPO_MAX_FLOAT_PCT,
  PRIVATIZATION_BUYOUT_PREMIUM,
  PRIVATIZATION_THRESHOLD_PCT,
} from "@/lib/constants/corporations";
import { computeIpoIssuance } from "@/lib/corporations/ipoIssuance";
import {
  SUPERSHARE_MIN_MULTIPLIER,
  SUPERSHARE_MAX_MULTIPLIER,
  SUPERSHARE_IPO_MAX_FLOAT_PCT,
  shareholderVotingPower,
  totalVotingPower,
} from "@/lib/corporations/superShares";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CorporationDetail } from "./CorporationPageTypes";

interface Props {
  corporation: CorporationDetail;
  corpId: string;
  /** Set when the CEO viewing this page is the same character that owns CEO seat */
  isCeo: boolean;
  onRefresh: () => void;
}

/**
 * CEO-only action cards for the IPO and privatization lifecycle.
 *  - Private corps: shows "Go Public (IPO)" with a float-% slider.
 *  - Public corps where CEO holds >75%: shows "Privatize (Buyout)" with a
 *    projected total cost and a single "Open Vote" button.
 * Renders nothing for non-CEO viewers or when conditions aren't met.
 */
export function CorporationStructureActions({ corporation, corpId, isCeo, onRefresh }: Props) {
  if (!isCeo) return null;

  if (corporation.isPrivate) {
    return <GoPublicCard corporation={corporation} corpId={corpId} onRefresh={onRefresh} />;
  }

  // CEO voting power %: shareholder entry whose characterId == ceoId. We don't
  // ship ceoId on the detail payload, but the CEO viewing the page is the
  // owning user — and the only character entry typically tied to the CEO is
  // their own. Compute by finding the largest character holder; safe enough
  // for the gating display, with the server still enforcing the real check.
  // Gate is by VOTING POWER (supershares count) to match the server, so a
  // dual-class founder who controls the corp sees the Privatize action.
  const ceoEntry = corporation.shareholders
    .filter((s) => s.characterId)
    .sort((a, b) => b.shares - a.shares)[0];
  const totalVp = totalVotingPower(corporation);
  const ceoVotingPct =
    ceoEntry && totalVp > 0 ? (shareholderVotingPower(corporation, ceoEntry) / totalVp) * 100 : 0;
  // Economic ownership % (distinct from voting power for dual-class founders).
  // The buyout card uses this for the share-count / cost math and the
  // "Your ownership" line, so it must reflect actual shares, not votes.
  const ceoOwnershipPct =
    ceoEntry && corporation.totalShares > 0 ? (ceoEntry.shares / corporation.totalShares) * 100 : 0;

  // Gate the Privatize action by voting power (matches the server, #895).
  if (ceoVotingPct <= PRIVATIZATION_THRESHOLD_PCT) return null;
  return (
    <PrivatizeCard
      corporation={corporation}
      corpId={corpId}
      ceoOwnershipPct={ceoOwnershipPct}
      onRefresh={onRefresh}
    />
  );
}

function GoPublicCard({
  corporation,
  corpId,
  onRefresh,
}: {
  corporation: CorporationDetail;
  corpId: string;
  onRefresh: () => void;
}) {
  const [floatPct, setFloatPct] = useState<number>(25);
  const [dualClass, setDualClass] = useState(false);
  const [superMultiplier, setSuperMultiplier] = useState<number>(SUPERSHARE_MAX_MULTIPLIER);
  const [highFloatAck, setHighFloatAck] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const { formatAmount, formatPrice, toInternalFrom } = useCurrency();
  const liquidCode = corporation.liquidCurrencyCode as CurrencyCode | undefined;
  const toInternal = (amount: number) => (liquidCode ? toInternalFrom(amount, liquidCode) : amount);

  const maxFloat = dualClass ? SUPERSHARE_IPO_MAX_FLOAT_PCT : IPO_MAX_FLOAT_PCT;
  // Dual-class floats above the single-class cap permanently dilute economic
  // ownership below 51%. Ticket #1033: players dragged the slider to the 75%
  // supershare max expecting a small listing. Gate those with an explicit ack.
  const requiresHighFloatAck = floatPct > IPO_MAX_FLOAT_PCT;

  const preview = useMemo(() => {
    try {
      return computeIpoIssuance({
        existingShares: corporation.totalShares,
        pricePerShare: corporation.sharePrice,
        floatPct,
        withSuperShares: dualClass,
      });
    } catch {
      return null;
    }
  }, [corporation.totalShares, corporation.sharePrice, floatPct, dualClass]);

  function clampFloatPct(raw: number): number {
    if (!Number.isFinite(raw)) return IPO_MIN_FLOAT_PCT;
    return Math.min(maxFloat, Math.max(IPO_MIN_FLOAT_PCT, Math.round(raw)));
  }

  async function handleGoPublic() {
    if (requiresHighFloatAck && !highFloatAck) {
      setError(
        `Floating more than ${IPO_MAX_FLOAT_PCT}% permanently dilutes your ownership below 51%. Confirm the checkbox below first.`
      );
      return;
    }
    if (requiresHighFloatAck) {
      const ownership = preview?.founderOwnershipPctAfter.toFixed(1) ?? String(100 - floatPct);
      const ok = window.confirm(
        `Confirm IPO at ${floatPct}% public float?\n\nYou will keep only ~${ownership}% economic ownership (voting control stays via supershares). This cannot be undone from the UI.`
      );
      if (!ok) return;
    }
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/go-public`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          floatPct,
          ...(dualClass ? { superShareMultiplier: superMultiplier } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to go public");
        return;
      }
      setSuccess(
        `IPO complete: ${data.newShares.toLocaleString("en-US")} shares listed to the public float. Up to ${formatAmount(
          toInternal(data.proceeds),
          liquidCode
        )} flows into the treasury as those shares are bought.`
      );
      onRefresh();
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-6">
      <h2 className="text-lg font-bold text-foreground mb-2">Go Public (IPO)</h2>
      <p className="text-sm text-muted mb-4">
        Convert this corporation from private to public by issuing new shares to the public float at
        the current share price ({formatPrice(toInternal(corporation.sharePrice), liquidCode)}
        /share). Cash proceeds flow into the corporate treasury as those shares are bought from the
        float. Your founder stake of {corporation.totalShares.toLocaleString("en-US")} shares stays
        the same; your ownership % drops as new shares are issued.
      </p>

      {error && (
        <div className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error mb-3">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success mb-3">
          {success}
        </div>
      )}

      <div className="mb-4 rounded-lg border border-card-border bg-card-elevated p-3">
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={dualClass}
            onChange={(e) => {
              setDualClass(e.target.checked);
              if (!e.target.checked && floatPct > IPO_MAX_FLOAT_PCT) {
                setFloatPct(IPO_MAX_FLOAT_PCT);
                setHighFloatAck(false);
              }
            }}
            className="mt-0.5 accent-primary"
          />
          <span>
            <span className="font-medium text-foreground">
              Dual-class supershares (founder control)
            </span>
            <span className="block text-xs text-muted mt-0.5">
              Your founder shares each carry multiple votes in shareholder votes, letting you float
              up to {SUPERSHARE_IPO_MAX_FLOAT_PCT}% (instead of {IPO_MAX_FLOAT_PCT}%) while keeping
              voting control. Economic ownership still drops with the float %. Supershares convert
              to common stock when sold. Dividends and payouts are unaffected.
            </span>
          </span>
        </label>
        {dualClass && (
          <div className="mt-3">
            <label className="block text-xs font-bold uppercase tracking-wider text-muted mb-1.5">
              Votes per founder share ({superMultiplier}×)
            </label>
            <input
              type="range"
              min={SUPERSHARE_MIN_MULTIPLIER}
              max={SUPERSHARE_MAX_MULTIPLIER}
              step={1}
              value={superMultiplier}
              onChange={(e) => setSuperMultiplier(Number(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted">
              <span>{SUPERSHARE_MIN_MULTIPLIER}×</span>
              <span>{SUPERSHARE_MAX_MULTIPLIER}×</span>
            </div>
          </div>
        )}
      </div>

      <div className="mb-1.5 flex items-end justify-between gap-3">
        <label className="block text-xs font-bold uppercase tracking-wider text-muted">
          Public Float
        </label>
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={IPO_MIN_FLOAT_PCT}
            max={maxFloat}
            step={1}
            value={floatPct}
            onChange={(e) => {
              const next = clampFloatPct(Number(e.target.value));
              setFloatPct(next);
              if (next <= IPO_MAX_FLOAT_PCT) setHighFloatAck(false);
            }}
            className="w-16 rounded-md border border-card-border bg-background px-2 py-1 text-right text-sm tabular-nums focus:border-primary/60 focus:outline-none"
            aria-label="Public float percent"
          />
          <span className="text-xs text-muted">%</span>
        </div>
      </div>
      <input
        type="range"
        min={IPO_MIN_FLOAT_PCT}
        max={maxFloat}
        step={1}
        value={floatPct}
        onChange={(e) => {
          const next = Number(e.target.value);
          setFloatPct(next);
          if (next <= IPO_MAX_FLOAT_PCT) setHighFloatAck(false);
        }}
        className="w-full"
      />
      <div className="flex justify-between text-xs text-muted">
        <span>{IPO_MIN_FLOAT_PCT}%</span>
        <span>{maxFloat}%</span>
      </div>

      {preview && (
        <div className="mt-3 mb-4 rounded-lg border border-card-border bg-card-elevated p-3 text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-muted">Founder ownership after IPO</span>
            <span
              className={`font-semibold tabular-nums ${
                preview.founderOwnershipPctAfter < 50 ? "text-warning" : ""
              }`}
            >
              {preview.founderOwnershipPctAfter.toFixed(1)}%
            </span>
          </div>
          {dualClass && (
            <div className="flex justify-between">
              <span className="text-muted">Founder voting power after IPO</span>
              <span className="font-semibold tabular-nums">
                {(
                  ((corporation.totalShares * superMultiplier) /
                    (corporation.totalShares * superMultiplier + preview.newShares)) *
                  100
                ).toFixed(1)}
                %
              </span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted">New shares issued</span>
            <span className="font-semibold tabular-nums">
              {preview.newShares.toLocaleString("en-US")}
            </span>
          </div>
          <div className="flex justify-between border-t border-card-border pt-1 mt-1">
            <span className="text-muted">Proceeds as float sells</span>
            <span className="font-bold text-foreground tabular-nums">
              {formatAmount(toInternal(Math.round(preview.proceeds)), liquidCode)}
            </span>
          </div>
        </div>
      )}

      {requiresHighFloatAck && (
        <label className="mb-4 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={highFloatAck}
            onChange={(e) => setHighFloatAck(e.target.checked)}
            className="mt-0.5 accent-primary"
          />
          <span className="text-foreground">
            I understand I am floating <span className="font-semibold">{floatPct}%</span> and will
            own only ~
            <span className="font-semibold">
              {preview?.founderOwnershipPctAfter.toFixed(1) ?? (100 - floatPct).toFixed(1)}%
            </span>{" "}
            of the company economically. Supershares preserve voting control, not ownership %.
          </span>
        </label>
      )}

      <button
        onClick={handleGoPublic}
        disabled={submitting || (requiresHighFloatAck && !highFloatAck)}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
      >
        {submitting ? "Going public..." : "Go Public"}
      </button>
    </div>
  );
}

function PrivatizeCard({
  corporation,
  corpId,
  ceoOwnershipPct,
  onRefresh,
}: {
  corporation: CorporationDetail;
  corpId: string;
  ceoOwnershipPct: number;
  onRefresh: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const { formatAmount } = useCurrency();

  const lockedPrice = corporation.sharePrice * (1 + PRIVATIZATION_BUYOUT_PREMIUM);
  const ceoShares = Math.round((ceoOwnershipPct / 100) * corporation.totalShares);
  const nonCeoShares = Math.max(0, corporation.totalShares - ceoShares);
  const estimatedCost = Math.ceil(nonCeoShares * lockedPrice);
  const isFullOwner = nonCeoShares === 0;

  async function handleOpenVote() {
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/privatize`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to open vote");
        return;
      }
      setSuccess(
        data.immediate
          ? "Corporation taken private."
          : `Vote opened. Buyout price locked at ${formatAmount(
              data.lockedBuyoutPrice,
              corporation.liquidCurrencyCode as CurrencyCode
            )}/share.`
      );
      onRefresh();
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-6">
      <h2 className="text-lg font-bold text-foreground mb-2">Privatize (Buyout)</h2>
      <p className="text-sm text-muted mb-3">
        {isFullOwner
          ? "You own 100% of shares. There are no minority holders to buy out — this corporation can be taken private immediately at no cost."
          : `Buy out all minority holders at a ${(PRIVATIZATION_BUYOUT_PREMIUM * 100).toFixed(0)}% premium per share and take the corporation private. The buyout price locks when the vote opens; funds are reserved from your personal cash and refunded if the vote fails. The vote completes automatically once a majority of eligible shareholders approve.`}
      </p>

      {error && (
        <div className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error mb-3">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success mb-3">
          {success}
        </div>
      )}

      <div className="mb-4 rounded-lg border border-card-border bg-card-elevated p-3 text-xs space-y-1">
        <div className="flex justify-between">
          <span className="text-muted">Your ownership</span>
          <span className="font-semibold tabular-nums">{ceoOwnershipPct.toFixed(2)}%</span>
        </div>
        {!isFullOwner && (
          <>
            <div className="flex justify-between">
              <span className="text-muted">
                Buyout price per share (+{(PRIVATIZATION_BUYOUT_PREMIUM * 100).toFixed(0)}% premium)
              </span>
              <span className="font-semibold tabular-nums">
                {formatAmount(lockedPrice, corporation.liquidCurrencyCode as CurrencyCode)}
              </span>
            </div>
            <div className="flex justify-between border-t border-card-border pt-1 mt-1">
              <span className="text-muted">Cash to reserve (minority shares)</span>
              <span className="font-bold text-foreground tabular-nums">
                {formatAmount(estimatedCost, corporation.liquidCurrencyCode as CurrencyCode)}
              </span>
            </div>
          </>
        )}
      </div>

      <button
        onClick={handleOpenVote}
        disabled={submitting}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
      >
        {submitting
          ? isFullOwner
            ? "Taking private..."
            : "Opening vote..."
          : isFullOwner
            ? "Take Private"
            : "Open Vote"}
      </button>
    </div>
  );
}
