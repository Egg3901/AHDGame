"use client";

import { useState } from "react";
import { PoliticalCompass, type CompassMarker } from "@/components/PoliticalCompass";
import { DetailedPolicyDisplay } from "@/components/DetailedPolicyDisplay";
import type { CharacterDemographics } from "@/lib/db/types";
import { buildDemographicsRows } from "@/lib/utils/profileDemographics";
import { CountryFlag } from "@/components/CountryFlag";

type PolicyView = "compass" | "detail" | "demographics";

interface PolicyDemographicsCardProps {
  economic: number;
  social: number;
  dotColor?: string;
  markers?: CompassMarker[];
  demographics?: CharacterDemographics | null;
  startingCountryId?: string | null;
  currentCountryId?: string | null;
}

function CompactStat({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="rounded-lg border border-card-border/60 bg-card-elevated/35 px-3.5 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">{label}</p>
      <p className="mt-1 text-sm font-medium leading-snug text-foreground">
        {value ?? "Undisclosed"}
      </p>
    </div>
  );
}

export function PolicyDemographicsCard({
  economic,
  social,
  dotColor,
  markers,
  demographics,
  startingCountryId,
  currentCountryId,
}: PolicyDemographicsCardProps) {
  const [view, setView] = useState<PolicyView>("compass");

  const tabClass = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
      active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted hover:text-foreground"
    }`;

  const rows = buildDemographicsRows(demographics, startingCountryId, currentCountryId);
  const identityRows = rows.slice(0, 4);
  const startingNationality = rows[4]?.value ?? null;
  const currentNationality = rows[5]?.value ?? null;

  return (
    <div className="rounded-2xl border border-card-border bg-card p-6 shadow-sm">
      <div className="mb-4 flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted">Positions</h3>
        <div
          className="inline-flex rounded-lg border border-card-border bg-card-muted/40 p-0.5"
          role="tablist"
          aria-label="Positions view"
        >
          <button
            type="button"
            role="tab"
            aria-selected={view === "compass"}
            className={tabClass(view === "compass")}
            onClick={() => setView("compass")}
          >
            Compass
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "detail"}
            className={tabClass(view === "detail")}
            onClick={() => setView("detail")}
          >
            Detail
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "demographics"}
            className={tabClass(view === "demographics")}
            onClick={() => setView("demographics")}
          >
            Demographics
          </button>
        </div>
      </div>

      {view === "compass" && (
        <PoliticalCompass
          economic={economic}
          social={social}
          embedded
          dotColor={dotColor}
          markers={markers}
        />
      )}

      {view === "detail" && (
        <DetailedPolicyDisplay
          economic={economic}
          social={social}
          omitHeading
          inset
          markers={markers}
        />
      )}

      {view === "demographics" && (
        <div className="space-y-2.5">
          <div className="grid gap-2 sm:grid-cols-2">
            {identityRows.map((row) => (
              <CompactStat key={row.label} label={row.label} value={row.value} />
            ))}
          </div>

          <div className="rounded-lg border border-card-border/60 bg-card-elevated/35 px-3.5 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
              Nationality
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted/80">
                  Starting
                </p>
                <p className="mt-1 text-sm font-medium leading-snug text-foreground flex items-center gap-1.5">
                  {startingCountryId ? <CountryFlag country={startingCountryId} size="sm" /> : null}
                  {startingNationality ?? "Unrecorded"}
                </p>
              </div>
              <div className="sm:text-right">
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted/80">
                  Current
                </p>
                <p className="mt-1 text-sm font-medium leading-snug text-foreground flex items-center gap-1.5">
                  {currentCountryId ? <CountryFlag country={currentCountryId} size="sm" /> : null}
                  {currentNationality ?? "Unrecorded"}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
