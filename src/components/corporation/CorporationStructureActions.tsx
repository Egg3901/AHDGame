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
import { InlineStatus, KVRow, SmallButton } from "./dense/DenseKit";
import { GovernanceRow } from "./ceo/GovernanceRow";

interface Props {
  corporation: CorporationDetail;
  corpId: string;
  /** Set when the CEO viewing this page is the same character that owns CEO seat */
  isCeo: boolean;
  onRefresh: () => void;
}

/**
 * CEO-only listing row for the IPO and privatization lifecycle.
 *  - Private corps: "Go public" with a float-% control.
 *  - Public corps where the CEO holds >75% of the votes: "Take private" with
 *    the projected buyout cost and a single vote button.
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
        `IPO complete: ${data.newShares.toLocaleString("en-US")} shares issued and available on the exchange now. The treasury receives proceeds only as those shares are bought.`
      );
      onRefresh();
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <GovernanceRow label="Listing" summary="Private" actionLabel="Go public">
      <div className="space-y-2">
        <p className="text-xs text-muted">
          Issue new shares to the public float at the current price (
          {formatPrice(toInternal(corporation.sharePrice), liquidCode)}/share). The treasury
          receives cash as those shares are bought. Your{" "}
          {corporation.totalShares.toLocaleString("en-US")} founder shares stay; your ownership
          share falls as new shares are issued.
        </p>

        <label className="flex items-start gap-2 text-xs">
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
          <span className="text-muted">
            <span className="font-medium text-foreground">Dual-class supershares</span>: your
            founder shares carry several votes each, so you can float up to{" "}
            {SUPERSHARE_IPO_MAX_FLOAT_PCT}% (instead of {IPO_MAX_FLOAT_PCT}%) and keep voting
            control. Economic ownership still falls with the float. Supershares convert to common
            stock when sold.
          </span>
        </label>
        {dualClass && (
          <label className="flex items-center gap-2 text-xs text-muted">
            Votes per founder share
            <input
              type="range"
              min={SUPERSHARE_MIN_MULTIPLIER}
              max={SUPERSHARE_MAX_MULTIPLIER}
              step={1}
              value={superMultiplier}
              onChange={(e) => setSuperMultiplier(Number(e.target.value))}
              className="w-40"
            />
            <span className="w-8 tabular-nums text-foreground">{superMultiplier}x</span>
          </label>
        )}

        <label className="flex items-center gap-2 text-xs text-muted">
          Public float
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
            className="w-40"
          />
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
            className="h-7 w-14 rounded-md border border-card-border bg-background px-1.5 text-right text-[13px] tabular-nums text-foreground focus:border-foreground focus:outline-none"
            aria-label="Public float percent"
          />
          %
        </label>

        {preview && (
          <dl className="max-w-sm">
            <KVRow
              label="Your ownership after"
              value={
                <span
                  className={preview.founderOwnershipPctAfter < 50 ? "text-warning" : undefined}
                >
                  {preview.founderOwnershipPctAfter.toFixed(1)}%
                </span>
              }
            />
            {dualClass && (
              <KVRow
                label="Your voting power after"
                value={`${(
                  ((corporation.totalShares * superMultiplier) /
                    (corporation.totalShares * superMultiplier + preview.newShares)) *
                  100
                ).toFixed(1)}%`}
              />
            )}
            <KVRow label="New shares" value={preview.newShares.toLocaleString("en-US")} />
            <KVRow
              label="Proceeds as the float sells"
              value={formatAmount(toInternal(Math.round(preview.proceeds)), liquidCode)}
            />
          </dl>
        )}

        {requiresHighFloatAck && (
          <label className="flex items-start gap-2 text-xs text-warning">
            <input
              type="checkbox"
              checked={highFloatAck}
              onChange={(e) => setHighFloatAck(e.target.checked)}
              className="mt-0.5 accent-primary"
            />
            <span>
              I am floating {floatPct}% and will own about{" "}
              {preview?.founderOwnershipPctAfter.toFixed(1) ?? (100 - floatPct).toFixed(1)}% of the
              company. Supershares keep voting control, not ownership.
            </span>
          </label>
        )}

        <SmallButton
          tone="primary"
          onClick={handleGoPublic}
          disabled={submitting || (requiresHighFloatAck && !highFloatAck)}
        >
          {submitting ? "Going public" : "Go public"}
        </SmallButton>
        <InlineStatus message={error} tone="error" />
        <InlineStatus message={success} tone="success" />
      </div>
    </GovernanceRow>
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
  const { formatAmount, toInternalFrom } = useCurrency();
  const code = corporation.liquidCurrencyCode as CurrencyCode | undefined;
  // Prices and costs here are in the corp's currency; format through the anchor.
  const fmtLocal = (local: number) =>
    code ? formatAmount(toInternalFrom(local, code), code) : formatAmount(local);

  const lockedPrice = corporation.sharePrice * (1 + PRIVATIZATION_BUYOUT_PREMIUM);
  const ceoShares = Math.round((ceoOwnershipPct / 100) * corporation.totalShares);
  const nonCeoShares = Math.max(
    0,
    corporation.totalShares - ceoShares - (corporation.pendingIpoShares ?? 0)
  );
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
          : `Vote opened. Buyout price locked at ${fmtLocal(data.lockedBuyoutPrice)}/share.`
      );
      onRefresh();
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <GovernanceRow
      label="Listing"
      summary={`Public. You hold ${ceoOwnershipPct.toFixed(1)}% of the shares.`}
      actionLabel="Take private"
    >
      <div className="space-y-2">
        <p className="text-xs text-muted">
          {isFullOwner
            ? "You own every share, so there is no one to buy out. The corporation can be taken private at once, at no cost."
            : `Buy out every minority holder at a ${(PRIVATIZATION_BUYOUT_PREMIUM * 100).toFixed(0)}% premium and take the corporation private. The price locks when the vote opens; the cash is reserved from your personal funds and refunded if the vote fails. The vote passes once a majority of eligible shareholders approve.`}
        </p>
        {!isFullOwner && (
          <dl className="max-w-sm">
            <KVRow
              label={`Buyout price (+${(PRIVATIZATION_BUYOUT_PREMIUM * 100).toFixed(0)}%)`}
              value={fmtLocal(lockedPrice)}
              hint="/share"
            />
            <KVRow label="Cash to reserve" value={fmtLocal(estimatedCost)} />
          </dl>
        )}
        <SmallButton tone="primary" onClick={handleOpenVote} disabled={submitting}>
          {submitting
            ? isFullOwner
              ? "Taking private"
              : "Opening vote"
            : isFullOwner
              ? "Take private"
              : "Open buyout vote"}
        </SmallButton>
        <InlineStatus message={error} tone="error" />
        <InlineStatus message={success} tone="success" />
      </div>
    </GovernanceRow>
  );
}
