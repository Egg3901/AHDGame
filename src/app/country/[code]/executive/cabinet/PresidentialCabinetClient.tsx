"use client";

import Link from "next/link";
import { HeroImage } from "@/components/HeroImage";
import { Button, Skeleton } from "@/components/ui";
import { CABINET_HERO } from "@/app/whitehouse/cabinet/CabinetConstants";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { legislatureUrl } from "@/lib/urls";
import { useState } from "react";
import { CabinetAdminTab } from "./CabinetAdminTab";
import { CabinetTabNav, type CabinetTabKey } from "./CabinetTabNav";
import { AdministrationTable } from "./AdministrationTable";
import { usePresidentialCabinet } from "./usePresidentialCabinet";

/**
 * Presidential cabinet: President nominates, the Senate confirms. Country-generic
 * — the same flow serves the US and any other presidential system (e.g. NG).
 * Position seats, the nominee pool, nominations and firing are all scoped by
 * `countryId` through the /api/whitehouse/cabinet routes; the roster table and
 * its controls are shared with the White House overview.
 */
export default function PresidentialCabinetClient({ countryId }: { countryId: CountryId }) {
  const code = countryId.toLowerCase();
  // US keeps its Congress deep-link; other presidential systems point at their
  // own national legislature (where the confirmation vote is surfaced).
  const senateLink =
    countryId === COUNTRY_CONFIGS.US.id
      ? "/congress?chamber=senate&tab=bills"
      : legislatureUrl(countryId);
  const cabinet = usePresidentialCabinet(countryId);
  const { data, loading, error, fetchData, activeNominations, filledCount } = cabinet;
  const [activeTab, setActiveTab] = useState<CabinetTabKey>("overview");

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-background pb-16">
        <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
          <Skeleton className="h-64 rounded-2xl" />
        </main>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background pb-16">
        <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
          <div className="rounded-xl border border-card-border bg-card p-8 text-center">
            <p className="mb-4 text-muted">{error ?? "Failed to load cabinet data."}</p>
            <Button variant="primary" onClick={fetchData}>
              Retry
            </Button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-16">
      <main className="mx-auto max-w-7xl space-y-6 overflow-x-hidden px-4 py-6 sm:px-6 sm:py-8">
        <nav className="flex flex-wrap items-center gap-2 text-sm">
          <Link
            href={`/country/${code}/executive`}
            className="text-muted transition-colors hover:text-foreground"
          >
            {countryId === COUNTRY_CONFIGS.US.id ? "Back to White House" : "Back to executive"}
          </Link>
          <span className="text-muted">-</span>
          <Link href={senateLink} className="text-muted transition-colors hover:text-foreground">
            Senate confirmations
          </Link>
        </nav>

        <header className="relative mb-8 overflow-hidden rounded-2xl border border-card-border bg-card shadow-lg">
          <div className="relative h-[175px] w-full sm:h-[220px]">
            <HeroImage
              src={CABINET_HERO.image}
              alt={CABINET_HERO.alt}
              fill
              className="object-cover object-center"
              sizes="(max-width: 1024px) 100vw, 1024px"
              priority
            />
            <div
              className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent"
              aria-hidden
            />
            <div className="absolute inset-0 flex flex-col justify-end px-5 pb-4 sm:px-6 sm:pb-5">
              <h1 className="text-xl font-bold tracking-tight text-white drop-shadow-md sm:text-2xl">
                {CABINET_HERO.title}
              </h1>
              <p className="mt-1 text-sm text-white/90 drop-shadow sm:text-base">
                {CABINET_HERO.tagline}
              </p>
            </div>
          </div>
          <div className="flex items-center overflow-x-auto divide-x divide-card-border border-t border-card-border">
            <div className="flex min-w-[110px] flex-col px-5 py-3">
              <span className="text-body-sm font-medium text-muted">Positions</span>
              <span className="text-base font-bold tabular-nums">
                {filledCount}
                <span className="text-xs font-normal text-muted">
                  {" "}
                  / {data.positions.length} filled
                </span>
              </span>
            </div>
            <div className="flex min-w-[140px] flex-col px-5 py-3">
              <span className="text-body-sm font-medium text-muted">Pending votes</span>
              <span className="text-base font-bold tabular-nums">{activeNominations.length}</span>
            </div>
          </div>
        </header>

        <CabinetTabNav active={activeTab} showAdmin={data.isAdmin} onChange={setActiveTab} />

        {activeTab === "admin" && data.isAdmin && (
          <CabinetAdminTab
            countryId={countryId}
            seats={data.positions.map((position) => ({
              id: position.id,
              name: position.name,
              memberName: position.member?.characterName ?? null,
              cooldownUntil: null,
            }))}
            onChanged={fetchData}
          />
        )}

        {activeTab === "overview" && (
          <>
            <div className="max-w-3xl space-y-2 text-sm text-muted">
              <p>
                The President nominates principal officers who must be confirmed by the Senate. Each
                leads a major executive department and follows the Vice President in the line of
                succession. Confirmed members use the shared cabinet office system for cabinet
                actions, standing orders, emergency powers, and department settings.
              </p>
              {data.positions.some((position) => position.appointedWithoutConfirmation) && (
                <p>
                  White House staff seats, such as the Chief of Staff, are appointed by the
                  President alone. They need no Senate vote and take office at the next turn.
                </p>
              )}
            </div>

            <AdministrationTable
              cabinet={cabinet}
              title="Principal officers"
              headerAction={
                <Link
                  href={senateLink}
                  className="rounded-md border border-card-border px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:text-foreground"
                >
                  Open Senate
                </Link>
              }
            />
          </>
        )}
      </main>
    </div>
  );
}
