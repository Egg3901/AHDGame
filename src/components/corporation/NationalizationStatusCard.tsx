"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { natMoney } from "@/components/national/natMoney";
import { fetchJson } from "@/lib/observability/fetchJson";

interface Status {
  hasStatus: boolean;
  pendingTaking: {
    turnsLeft: number;
    deadlineTurn: number;
    tier: string;
    method: string;
    triggers: string[];
    curableTriggers: string[];
    isSector: boolean;
  } | null;
  billsInVoting: {
    billId: string;
    title: string;
    whole: boolean;
    sectorCount: number;
  }[];
  isSpunOut: boolean;
  privatizedAtTurn: number | null;
  goldenSharePercent: number;
  auctionOpen: boolean;
  auction: {
    auctionId: string;
    countryId: string;
    reservePrice: number;
    currency: string;
    highestBid: number;
    bidCount: number;
    turnsLeft: number;
  } | null;
}

/**
 * Quiet nationalization-status card for a private corp page. Renders nothing
 * unless the corp faces a legislative nationalization (a pending taking or a
 * bill still in voting) or has a state-ownership tie (spun-out / golden share /
 * open auction). Spec §14/§17.
 */
export function NationalizationStatusCard({ corpId }: { corpId: string }) {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchJson<Status>(`/api/corporations/${corpId}/nationalization-status`, {
      feature: "nationalization-status",
    })
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [corpId]);

  if (!status?.hasStatus) return null;
  const t = status.pendingTaking;

  return (
    <div className="space-y-2 rounded-xl border border-gold/30 bg-gold/5 p-4">
      <h3 className="text-body-sm font-semibold uppercase tracking-wide text-gold">
        State-ownership status
      </h3>

      {t && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-body-sm">
          <span className="font-medium text-warning">
            Pending nationalization — {t.turnsLeft} turn{t.turnsLeft === 1 ? "" : "s"} left
          </span>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-body-xs text-muted">
            <span>
              {t.isSector ? "sector taking" : "whole-corp"} · {t.tier} · {t.method}
            </span>
            <span>cited: {t.triggers.join(", ") || "—"}</span>
            {t.curableTriggers.length > 0 && (
              <span className="text-warning">
                clear {t.curableTriggers.join(", ")} before turn {t.deadlineTurn} to cancel
              </span>
            )}
          </div>
        </div>
      )}

      {(status.billsInVoting ?? []).map((b) => {
        const scope =
          b.whole && b.sectorCount > 0
            ? `whole corp + ${b.sectorCount} sector${b.sectorCount === 1 ? "" : "s"}`
            : b.whole
              ? "whole corp"
              : `${b.sectorCount} sector${b.sectorCount === 1 ? "" : "s"}`;
        return (
          <Link
            key={b.billId}
            href={`/congress/bills/${b.billId}`}
            className="block rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-body-sm transition-colors hover:bg-error/15"
          >
            <span className="font-medium text-error">Nationalization bill in voting — {scope}</span>
            <div className="mt-0.5 truncate text-body-xs text-muted">{b.title} →</div>
          </Link>
        );
      })}

      {status.auction && (
        <div className="rounded-lg border border-gold/30 bg-gold/10 px-3 py-2 text-body-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-gold">
              Privatization auction — {status.auction.turnsLeft} turn
              {status.auction.turnsLeft === 1 ? "" : "s"} left
            </span>
            <Link
              href={`/country/${status.auction.countryId.toLowerCase()}/nationalization#auction-${status.auction.auctionId}`}
              className="rounded-md bg-gold px-3 py-1 text-body-xs font-semibold text-background transition-colors hover:bg-gold/90"
            >
              Place a bid →
            </Link>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-body-xs text-muted">
            <span>reserve {natMoney(status.auction.reservePrice, status.auction.currency)}</span>
            <span>
              highest{" "}
              {status.auction.highestBid > 0
                ? natMoney(status.auction.highestBid, status.auction.currency)
                : "—"}
            </span>
            <span>
              {status.auction.bidCount} bid{status.auction.bidCount === 1 ? "" : "s"}
            </span>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 text-body-xs">
        {status.isSpunOut && (
          <span className="rounded-full border border-card-border bg-card-muted px-2.5 py-0.5 text-muted">
            Spun out of state ownership
            {status.privatizedAtTurn != null ? ` (turn ${status.privatizedAtTurn})` : ""}
          </span>
        )}
        {status.goldenSharePercent > 0 && (
          <span className="rounded-full border border-gold/30 bg-gold/10 px-2.5 py-0.5 text-gold">
            State golden share {Math.round(status.goldenSharePercent * 100)}%
          </span>
        )}
      </div>
    </div>
  );
}
