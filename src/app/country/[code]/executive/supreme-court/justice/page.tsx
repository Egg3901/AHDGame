"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Skeleton } from "@/components/ui";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { scotusUrl } from "@/lib/urls";
import { useJusticeOffice } from "./useJusticeOffice";
import { JusticeActionPanel } from "./components/JusticeActionPanel";

function leanLabel(value: number | null): string {
  return value != null ? value.toFixed(1) : "-";
}

/**
 * Justice office page (#3605) — mirrors `VicePresidentOfficePage` (same
 * header shape, same self-serve action panel pattern) for a seated
 * player-Justice: which seat they hold, their ideology leans, remaining
 * daily judicial actions (#3598 justiceActions.ts).
 */
export default function JusticeOfficePage() {
  const params = useParams();
  const countryCode = (params.code as string).toLowerCase();
  const countryId = countryCode.toUpperCase() as CountryId;
  const countryName = COUNTRY_CONFIGS[countryId]?.name ?? countryId;

  const { data, loading, error, refetch } = useJusticeOffice(countryCode);

  if (loading) {
    return (
      <div className="min-h-screen bg-background pb-16">
        <main className="mx-auto max-w-3xl space-y-4 px-4 py-8 sm:px-6">
          <Skeleton className="h-[180px] w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </main>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background pb-16">
        <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
          <div className="rounded-xl border border-error/30 bg-error/10 p-6 text-center">
            <h2 className="text-lg font-semibold text-error">{error ?? "Failed to load"}</h2>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-16">
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
        <nav className="flex flex-wrap items-center gap-2 text-sm">
          <Link
            href={scotusUrl(countryId)}
            className="text-muted transition-colors hover:text-foreground"
          >
            Back to Supreme Court
          </Link>
        </nav>

        <header className="rounded-2xl border border-card-border bg-card p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                {countryName}
              </div>
              <h1 className="mt-1 text-2xl font-bold text-foreground">Justice Office</h1>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-card-border bg-card-muted px-2.5 py-1 text-xs font-medium text-foreground/80">
              {data.justiceActionsRemaining}/{data.actionCap} Actions
            </span>
          </div>

          {data.isJustice && data.seat ? (
            <div className="mt-4 space-y-2">
              <div className="flex items-center gap-3">
                <span className="w-28 shrink-0 text-[10px] font-semibold uppercase tracking-widest text-muted">
                  Seat
                </span>
                <span className="text-sm font-medium text-foreground">
                  #{data.seat.seatNumber} - {data.seat.justiceName}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="w-28 shrink-0 text-[10px] font-semibold uppercase tracking-widest text-muted">
                  Ideology
                </span>
                <span className="text-sm text-muted">
                  Econ {leanLabel(data.seat.economicLean)} · Social{" "}
                  {leanLabel(data.seat.socialLean)}
                </span>
              </div>
              {data.seat.isDivergent && (
                <p className="text-xs text-warning">
                  This seat has diverged from the real historical succession.
                </p>
              )}
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted">
              You are not currently serving as a Justice. A president can nominate you to a vacant
              seat on the{" "}
              <Link href={scotusUrl(countryId)} className="text-primary hover:underline">
                Supreme Court
              </Link>
              .
            </p>
          )}
        </header>

        <JusticeActionPanel
          actions={data.actions}
          actionsRemaining={data.justiceActionsRemaining}
          resetHint={data.resetHint}
          canAct={data.isJustice}
          seatNumber={data.mySeatNumber}
          countryCode={countryCode}
          onUpdate={refetch}
        />
      </main>
    </div>
  );
}
