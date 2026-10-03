"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PoliticalCompass, type CompassMarker } from "@/components/PoliticalCompass";
import { DetailedPolicyDisplay } from "@/components/DetailedPolicyDisplay";
import type { CharacterDemographics } from "@/lib/db/types";
import { buildDemographicsRows } from "@/lib/utils/profileDemographics";
import { CountryFlag } from "@/components/CountryFlag";
import { SectionHeader } from "./ProfileMeters";

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

function FactRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-card-border/60 py-2 last:border-b-0">
      <dt className="text-body-sm text-muted">{label}</dt>
      <dd className="flex items-center gap-1.5 text-right text-body-sm text-foreground">
        {children}
      </dd>
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
  const t = useTranslations("profile.positions");
  const [view, setView] = useState<PolicyView>("compass");

  const tabClass = (active: boolean) =>
    `rounded px-2.5 py-1 text-body-sm font-medium transition-colors ${
      active ? "bg-card-elevated text-foreground" : "text-muted hover:text-foreground"
    }`;

  const rows = buildDemographicsRows(demographics, startingCountryId, currentCountryId);
  const identityRows = rows.slice(0, 4);
  const startingNationality = rows[4]?.value ?? null;
  const currentNationality = rows[5]?.value ?? null;

  return (
    <section>
      <SectionHeader
        level="aside"
        action={
          <div
            className="inline-flex rounded-md border border-card-border p-0.5"
            role="tablist"
            aria-label={t("viewAria")}
          >
            <button
              type="button"
              role="tab"
              aria-selected={view === "compass"}
              className={tabClass(view === "compass")}
              onClick={() => setView("compass")}
            >
              {t("tabCompass")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "detail"}
              className={tabClass(view === "detail")}
              onClick={() => setView("detail")}
            >
              {t("tabDetail")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "demographics"}
              className={tabClass(view === "demographics")}
              onClick={() => setView("demographics")}
            >
              {t("tabDemographics")}
            </button>
          </div>
        }
      >
        {t("title")}
      </SectionHeader>

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
        <dl>
          {identityRows.map((row) => (
            <FactRow key={row.label} label={row.label}>
              {row.value ?? t("undisclosed")}
            </FactRow>
          ))}
          <FactRow label={t("startingNationality")}>
            {startingCountryId ? <CountryFlag country={startingCountryId} size="sm" /> : null}
            {startingNationality ?? t("unrecorded")}
          </FactRow>
          <FactRow label={t("currentNationality")}>
            {currentCountryId ? <CountryFlag country={currentCountryId} size="sm" /> : null}
            {currentNationality ?? t("unrecorded")}
          </FactRow>
        </dl>
      )}
    </section>
  );
}
