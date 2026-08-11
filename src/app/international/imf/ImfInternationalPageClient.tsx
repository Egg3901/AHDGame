"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { HeroImage } from "@/components/HeroImage";
import { CardSkeleton, HeroStatsStrip, Skeleton } from "@/components/ui";
import { ActiveSovereignBailoutsPanel } from "@/components/imf/ActiveSovereignBailoutsPanel";
import { PendingBoardOverridesPanel } from "@/components/imf/PendingBoardOverridesPanel";
import { GlobalBondMarketDemandPanel } from "@/components/imf/GlobalBondMarketDemandPanel";
import { fetchJson, HttpError } from "@/lib/observability/fetchJson";

interface OverviewResponse {
  currentTurn: number | null;
  imfCorp: {
    id: string;
    sequentialId: number | null;
    liquidCapital: number;
    liquidCurrencyCode: string;
  } | null;
  boardMembers: Array<{ characterId: string; name: string; sequentialId: number | null }>;
  totalReceivedAnchor: number;
  activeSovereignBailouts: Array<{
    countryCode: string;
    principalOutstanding: number;
    annualRate: number;
    amortizationTurnsRemaining: number;
    incomeCaptureFraction: number;
    cumulativePaidAnchor: number;
    crisisChoice: string | null;
    recoveryStartedAt: { turn: number } | null;
  }>;
  pendingBoardOverrides: Array<{
    countryCode: string;
    windowEndAtRealtimeMs: number;
    windowEndAtTurn: number | null;
    crisisChoice: string | null;
    facilityTerms: { principal: number; annualRate: number; incomeCaptureFraction: number };
  }>;
}

function formatCapital(value: number, code: string): string {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${code} ${(value / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `${code} ${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${code} ${(value / 1e6).toFixed(1)}M`;
  return `${code} ${value.toFixed(0)}`;
}

export function ImfInternationalPageClient() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentCharacterId, setCurrentCharacterId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [overview, me] = await Promise.all([
          fetchJson<OverviewResponse>("/api/imf/overview", { feature: "imf-overview" }),
          fetchJson<{ user?: { character?: { id?: string } } }>("/api/auth/me", {
            feature: "imf-auth-me",
          }).catch((): { user?: { character?: { id?: string } } } => ({})),
        ]);
        if (!cancelled) {
          setData(overview);
          setCurrentCharacterId(me.user?.character?.id ?? null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof HttpError
              ? `Failed to load (${e.status})`
              : e instanceof Error
                ? e.message
                : "Failed to load"
          );
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error)
    return (
      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <ImfHero data={null} />
        <p className="text-rose-600">{error}</p>
      </div>
    );
  if (!data)
    return (
      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <ImfHero data={null} />
        {/* Bailouts / board overrides / bond demand panel skeletons */}
        {[1, 2, 3].map((i) => (
          <CardSkeleton key={i} className="min-h-[140px] space-y-3">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </CardSkeleton>
        ))}
      </div>
    );

  const isBoardMember = data.boardMembers.some((b) => b.characterId === currentCharacterId);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <ImfHero data={data} />
      <ActiveSovereignBailoutsPanel bailouts={data.activeSovereignBailouts} />
      <PendingBoardOverridesPanel
        overrides={data.pendingBoardOverrides}
        currentTurn={data.currentTurn}
        isBoardMember={isBoardMember}
        onActioned={() => {
          window.location.reload();
        }}
      />
      <GlobalBondMarketDemandPanel />
    </div>
  );
}

function ImfHero({ data }: { data: OverviewResponse | null }) {
  const liquid = data?.imfCorp
    ? formatCapital(data.imfCorp.liquidCapital, data.imfCorp.liquidCurrencyCode)
    : null;
  const board = data?.boardMembers ?? [];
  return (
    <header className="relative overflow-hidden rounded-2xl border border-card-border bg-card shadow-lg">
      <div className="relative h-[175px] w-full sm:h-[220px]">
        <HeroImage
          src="/api/images/hero/imf"
          alt="IMF headquarters"
          fill
          className="object-cover object-[center_45%]"
          sizes="(max-width: 1280px) 100vw, 1280px"
          priority
        />
        <div
          className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent"
          aria-hidden
        />
        <div className="absolute inset-0 flex flex-col justify-end px-6 pb-6 sm:px-8 sm:pb-8">
          <div className="flex items-center gap-3">
            <Image
              src="/api/images/hero/imf-logo"
              alt="IMF logo"
              width={48}
              height={48}
              className="h-10 w-10 rounded-md bg-white/95 p-1 ring-1 ring-white/30 shadow sm:h-12 sm:w-12"
              unoptimized
              onError={(e) => {
                // Hide gracefully if the logo asset fails to load.
                (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
              }}
            />
            <h1 className="text-2xl font-bold tracking-tight text-white drop-shadow-md sm:text-3xl">
              International Monetary Fund
            </h1>
            {data?.imfCorp ? (
              <Link
                href={`/corporation/${data.imfCorp.sequentialId ?? data.imfCorp.id}`}
                className="ml-1 inline-flex items-center gap-1 rounded-full border border-white/30 bg-black/30 px-2.5 py-1 text-xs font-medium text-white/95 backdrop-blur-sm transition-colors hover:bg-black/50"
                title="Open IMF corporation page"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-3 w-3"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden
                >
                  <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                  <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                </svg>
                Corporation page
              </Link>
            ) : null}
          </div>
          <p className="mt-2 max-w-2xl text-sm text-white/90 drop-shadow sm:text-base">
            Sovereign-bailout facility, board oversight, and global crisis response.
          </p>
        </div>
      </div>

      <HeroStatsStrip variant="overlay">
        <div className="flex min-w-[140px] flex-col justify-between p-4">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
            Liquid capital
          </span>
          <span className="text-lg font-bold tabular-nums text-foreground">{liquid ?? "—"}</span>
        </div>
        <div className="flex min-w-[180px] flex-1 flex-col justify-between p-4">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
            Board members
          </span>
          {board.length === 0 ? (
            <span className="text-sm italic text-muted">None seeded</span>
          ) : (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {board.map((b) => (
                <Link
                  key={b.characterId}
                  href={`/character/${b.sequentialId ?? b.characterId}`}
                  className="inline-flex items-center rounded-full border border-card-border bg-card-elevated px-2.5 py-0.5 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-primary"
                >
                  {b.name}
                </Link>
              ))}
            </div>
          )}
        </div>
        <div className="flex min-w-[120px] flex-col justify-between p-4">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
            Active bailouts
          </span>
          <span className="text-lg font-bold tabular-nums text-foreground">
            {data?.activeSovereignBailouts.length ?? 0}
          </span>
        </div>
        <div className="flex min-w-[120px] flex-col justify-between p-4">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
            Pending board votes
          </span>
          <span className="text-lg font-bold tabular-nums text-foreground">
            {data?.pendingBoardOverrides.length ?? 0}
          </span>
        </div>
        <div className="flex min-w-[160px] flex-col justify-between p-4">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
            Lifetime received
          </span>
          <span className="text-lg font-bold tabular-nums text-foreground">
            {data?.totalReceivedAnchor ? formatCapital(data.totalReceivedAnchor, "USD") : "—"}
          </span>
        </div>
      </HeroStatsStrip>
    </header>
  );
}
