"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui";
import { natMoney } from "@/components/national/natMoney";
import { type CountryId } from "@/lib/constants/countries";
import type { AuctionListing } from "@/lib/nationalization/auctionListing";
import { useCountryDisplayName } from "@/contexts/RegisteredCountriesContext";

/** The enriched auction shape served by /api/country/[code]/nationalization-auctions. */
export type Auction = AuctionListing;

export interface ViewerCorp {
  id: string;
  name: string;
  currency: string;
  liquidCapital: number;
}

export function AuctionsSection({
  auctions,
  currentTurn,
  viewerCorporations,
  viewerIsResident,
  viewerPersonalBalance,
  viewerCharacterId,
  countryName,
  onChanged,
}: {
  auctions: Auction[];
  currentTurn: number;
  viewerCorporations: ViewerCorp[];
  viewerIsResident: boolean;
  viewerPersonalBalance: number | null;
  viewerCharacterId: string | null;
  countryName: string;
  onChanged: () => void;
}) {
  return (
    <section className="rounded-xl border border-card-border bg-card p-5">
      <h2 className="text-heading-sm font-semibold text-foreground">Open auctions</h2>
      <p className="mt-1 text-body-sm text-muted">
        Privatization auctions for carved state assets. Bids are escrowed; raising replaces your
        prior bid. Highest bid at close wins (above reserve), else the asset is re-absorbed. Only
        residents of {countryName} may bid.
      </p>
      {auctions.length === 0 ? (
        <p className="mt-4 text-body-sm text-muted">No open auctions.</p>
      ) : (
        <div className="mt-4 space-y-3">
          {auctions.map((a) => (
            <AuctionRow
              key={a.auctionId}
              auction={a}
              currentTurn={currentTurn}
              viewerCorporations={viewerCorporations}
              viewerIsResident={viewerIsResident}
              viewerPersonalBalance={viewerPersonalBalance}
              viewerCharacterId={viewerCharacterId}
              countryName={countryName}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function AuctionRow({
  auction,
  currentTurn,
  viewerCorporations,
  viewerIsResident,
  viewerPersonalBalance,
  viewerCharacterId,
  countryName,
  onChanged,
}: {
  auction: Auction;
  currentTurn: number;
  viewerCorporations: ViewerCorp[];
  viewerIsResident: boolean;
  viewerPersonalBalance: number | null;
  viewerCharacterId: string | null;
  countryName: string;
  onChanged: () => void;
}) {
  const minBid = auction.highestBid > 0 ? auction.highestBid + 1 : auction.reservePrice;
  const [amount, setAmount] = useState("");
  const [asCorp, setAsCorp] = useState(""); // "" = bid as character
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(
    null
  );
  const turnsLeft = Math.max(0, auction.closesAtTurn - currentTurn);
  // Corps that can bid on this auction (currency must match the auction currency).
  const eligibleCorps = viewerCorporations.filter((c) => c.currency === auction.currency);
  const money = (n: number) => natMoney(n, auction.currency);

  // Free cash for the currently-selected bidder.
  const freeCash = asCorp
    ? (eligibleCorps.find((c) => c.id === asCorp)?.liquidCapital ?? 0)
    : (viewerPersonalBalance ?? 0);

  // Only the leader holds escrow; if the selected bidder is the current leader, the
  // money they already have on the table counts toward a raise — they pay only the
  // delta over it. So spendable = free cash + own escrow, and the actual charge is
  // the bid minus that escrow. This keeps the gate in step with the server debit.
  const selectedIsLeader = asCorp
    ? auction.leadingBidderCorporationId === asCorp
    : !!viewerCharacterId && auction.leadingBidderCharacterId === viewerCharacterId;
  const ownEscrow = selectedIsLeader ? auction.highestBid : 0;
  const spendable = freeCash + ownEscrow;

  const amountNum = parseFloat(amount);
  const hasAmount = !isNaN(amountNum);
  const wouldPay = hasAmount ? Math.max(0, amountNum - ownEscrow) : 0;
  const canAfford = hasAmount && amountNum <= spendable;
  const canBid = viewerIsResident && !busy && hasAmount && amountNum >= minBid && canAfford;

  async function bid() {
    if (!canBid) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/corporations/${auction.corporationId}/nationalization-auction/bid`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: Math.round(amountNum),
            ...(asCorp ? { asCorporationId: asCorp } : {}),
          }),
        }
      );
      const json = await res.json();
      if (!res.ok) {
        setFeedback({ type: "error", message: json.error ?? "Bid failed." });
      } else {
        setFeedback({ type: "success", message: "Bid placed." });
        setAmount("");
        onChanged();
      }
    } catch {
      setFeedback({ type: "error", message: "Network error." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      id={`auction-${auction.auctionId}`}
      className="scroll-mt-24 rounded-lg border border-card-border bg-card-muted p-4"
    >
      {/* Header: corp + countdown */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            href={`/corporation/${auction.corpSequentialId}`}
            className="text-body-sm font-semibold text-foreground hover:text-primary hover:underline"
          >
            {auction.corpName}
          </Link>
          <div className="mt-0.5 text-body-xs text-muted">
            <span className="capitalize">{auction.leadSectorType.replace(/_/g, " ")}</span> · HQ{" "}
            {auction.hqStateName}
          </div>
        </div>
        <span className="shrink-0 text-body-xs text-muted">
          {turnsLeft} turn{turnsLeft === 1 ? "" : "s"} left · {auction.bidCount} bid
          {auction.bidCount === 1 ? "" : "s"}
        </span>
      </div>

      {/* Carved holdings */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {auction.sectors.map((s) => (
          <span
            key={`${s.sectorType}-${s.stateId}`}
            className="inline-flex items-center gap-1 rounded-full border border-card-border bg-card px-2 py-0.5 text-body-xs text-muted"
          >
            <span className="capitalize text-foreground">{s.sectorType.replace(/_/g, " ")}</span>·{" "}
            {s.stateName} · {money(s.revenuePerTurn)}/turn
          </span>
        ))}
      </div>

      {/* Key figures */}
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-body-xs sm:grid-cols-4">
        <Figure label="Revenue/turn" value={money(auction.totalRevenuePerTurn)} />
        <Figure label="Valuation" value={money(auction.valuationLocal)} />
        <Figure label="Reserve" value={money(auction.reservePrice)} />
        <Figure
          label="Highest bid"
          value={auction.highestBid > 0 ? money(auction.highestBid) : "—"}
        />
        {auction.goldenSharePercent > 0 && (
          <Figure
            label="State retains"
            value={`${Math.round(auction.goldenSharePercent * 100)}%`}
          />
        )}
      </div>

      {/* Bid history — every bid/raise, newest first; the leader is the high bid */}
      {auction.bidHistory.length > 0 && (
        <div className="mt-3 rounded-lg border border-card-border bg-card px-3 py-2">
          <div className="text-body-xs font-semibold uppercase tracking-wide text-muted">
            Bid history
          </div>
          <ul className="mt-1 space-y-0.5">
            {auction.bidHistory.map((b, i) => (
              <li
                key={`${b.bidderName}-${b.amount}-${b.placedAtTurn}-${i}`}
                className="flex items-center justify-between gap-3 text-body-xs"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-foreground">{b.bidderName}</span>
                  {b.bidderType === "corporation" && (
                    <span className="shrink-0 rounded border border-card-border px-1 text-[10px] text-muted">
                      corp
                    </span>
                  )}
                  {b.amount === auction.highestBid && (
                    <span className="shrink-0 rounded border border-success/30 bg-success/10 px-1 text-[10px] text-success">
                      leading
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-mono text-muted">
                  {money(b.amount)} <span className="text-muted/60">· turn {b.placedAtTurn}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Bid form (residents only) */}
      {viewerIsResident ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col text-body-xs text-muted">
            Bid · min {money(minBid)}
            <input
              type="number"
              min={minBid}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={busy}
              className="mt-0.5 w-40 rounded border border-card-border bg-card-elevated px-2 py-1 font-mono text-body-sm text-foreground"
            />
          </label>
          {eligibleCorps.length > 0 && (
            <label className="flex flex-col text-body-xs text-muted">
              Bid as
              <select
                value={asCorp}
                onChange={(e) => setAsCorp(e.target.value)}
                disabled={busy}
                className="mt-0.5 rounded border border-card-border bg-card-elevated px-2 py-1 text-body-sm text-foreground"
              >
                <option value="">Myself</option>
                {eligibleCorps.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Button onClick={bid} disabled={!canBid}>
            {busy ? "Bidding…" : "Place bid"}
          </Button>
          <p className="w-full text-body-xs text-muted">
            {asCorp ? "Corporation has " : "You have "}
            <span
              className={hasAmount && !canAfford ? "font-medium text-error" : "text-foreground"}
            >
              {money(spendable)}
            </span>{" "}
            available
            {ownEscrow > 0 ? ` (incl. ${money(ownEscrow)} already escrowed)` : ""}
            {hasAmount && canAfford && ownEscrow > 0 ? ` — this bid adds ${money(wouldPay)}` : ""}
            {hasAmount && !canAfford ? " — bid exceeds it" : ""}.
          </p>
        </div>
      ) : (
        <p className="mt-3 rounded-md border border-card-border bg-card px-3 py-2 text-body-xs text-muted">
          Only residents of {countryName} may bid on this auction.
        </p>
      )}

      {feedback && (
        <p
          className={`mt-2 text-body-xs ${feedback.type === "success" ? "text-success" : "text-error"}`}
        >
          {feedback.message}
        </p>
      )}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="uppercase tracking-wide text-muted/70">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

/**
 * Display name for a country code (any case).
 *
 * A hook rather than a plain function, because the name now depends on runtime
 * state: a country renamed by an event is not called what it was compiled as.
 */
export function useCountryNameFromCode(): (countryCode: string) => string {
  const resolveCountryName = useCountryDisplayName();
  return (countryCode: string) => resolveCountryName(countryCode.toUpperCase() as CountryId);
}
