"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button, Skeleton } from "@/components/ui";
import BackButton from "@/components/BackButton";
import {
  AuctionsSection,
  countryDisplayName,
  type Auction,
  type ViewerCorp,
} from "./AuctionsSection";
import { PendingTakingsSection, type Pending } from "./PendingTakingsSection";
import { natMoney } from "@/components/national/natMoney";

interface AuctionsResponse {
  currentTurn: number;
  auctions: Auction[];
  viewerCorporations: ViewerCorp[];
  viewerIsResident: boolean;
  viewerPersonalBalance: number | null;
  viewerCharacterId: string | null;
}
interface PendingResponse {
  currentTurn: number;
  treasuryReserve: number;
  currencyCode: string;
  pending: Pending[];
}

export default function NationalizationSurfacePage() {
  const params = useParams();
  const code = (params.code as string).toLowerCase();
  const [auctionsData, setAuctionsData] = useState<AuctionsResponse | null>(null);
  const [pendingData, setPendingData] = useState<PendingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [aRes, pRes] = await Promise.all([
        fetch(`/api/country/${code}/nationalization-auctions`),
        fetch(`/api/country/${code}/pending-nationalizations`),
      ]);
      if (!aRes.ok || !pRes.ok) {
        setError("Failed to load nationalization data. Please try again.");
        return;
      }
      setAuctionsData((await aRes.json()) as AuctionsResponse);
      setPendingData((await pRes.json()) as PendingResponse);
    } catch {
      setError("Network error - could not reach the server.");
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <h1 className="text-heading font-semibold text-foreground">Nationalization</h1>
      <p className="mt-1 text-body-sm text-muted">
        Privatization auctions and pending takings for {code.toUpperCase()}.
      </p>

      {loading ? (
        <div className="mt-6 space-y-4">
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      ) : error ? (
        <div className="mt-6 rounded-xl border border-card-border bg-card p-8 text-center">
          <p className="mb-4 text-muted">{error}</p>
          <Button variant="primary" onClick={load}>
            Retry
          </Button>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {(() => {
            const balance = pendingData?.treasuryReserve ?? 0;
            const inDebt = balance < 0;
            return (
              <div className="rounded-xl border border-gold/30 bg-gold/5 p-4">
                <div className="text-body-xs uppercase tracking-wide text-muted">
                  National treasury balance
                </div>
                <div
                  className={`text-heading font-semibold ${inDebt ? "text-error" : "text-success"}`}
                >
                  {natMoney(balance, pendingData?.currencyCode ?? "USD")}
                  <span className="ml-2 text-body-xs font-normal text-muted">
                    {inDebt ? "national debt" : "surplus"}
                  </span>
                </div>
                <div className="text-body-xs text-muted">
                  The country&apos;s running cash position — it pays nationalization compensation,
                  funds CEO treasury draws, and receives privatization proceeds. A negative balance
                  is national debt.
                </div>
              </div>
            );
          })()}
          <AuctionsSection
            auctions={auctionsData?.auctions ?? []}
            currentTurn={auctionsData?.currentTurn ?? 0}
            viewerCorporations={auctionsData?.viewerCorporations ?? []}
            viewerIsResident={auctionsData?.viewerIsResident ?? false}
            viewerPersonalBalance={auctionsData?.viewerPersonalBalance ?? null}
            viewerCharacterId={auctionsData?.viewerCharacterId ?? null}
            countryName={countryDisplayName(code)}
            onChanged={load}
          />
          <PendingTakingsSection
            pending={pendingData?.pending ?? []}
            currentTurn={pendingData?.currentTurn ?? 0}
          />
        </div>
      )}

      <div className="mt-6">
        <BackButton />
      </div>
    </div>
  );
}
