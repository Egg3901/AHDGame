"use client";

import { Tooltip } from "@/components/ui";
import type { StatePartyData } from "./types";
import { getOrgLabel, getOrgBarColor, getOrgFlavorText } from "./helpers";

// ─── StatePartyMetricsPanel ───────────────────────────────────────────────────

interface StatePartyMetricsPanelProps {
  stateParty: StatePartyData;
}

interface OrgEffect {
  label: string;
  value: string;
  blurb: string;
  tooltip: string;
}

function getOrgEffects(organization: number): OrgEffect[] {
  const votePower = (0.5 + (organization / 100) * 0.5).toFixed(2);
  const primaryPts = Math.round((organization / 100) * 25);
  const nppQuality = organization >= 60 ? "High" : organization >= 30 ? "Mid" : "Low";
  const influence = organization >= 50 ? `+${Math.round(organization * 0.1)}%` : "Baseline";

  return [
    {
      label: "Vote Power",
      value: `${votePower}×`,
      blurb: "General-election vote scalar",
      tooltip:
        "Scales your candidates' general-election vote weight in this state. Formula: 0.5 + (Org ÷ 100) × 0.5, so 0 Org is 0.50× and 100 Org is 1.00×.",
    },
    {
      label: "Pres. Primary",
      value: `${primaryPts} pts`,
      blurb: "Home-state primary scoring",
      tooltip:
        "Adds up to 25 points to presidential primary scoring when this is the candidate's home state. Formula: (Org ÷ 100) × 25.",
    },
    {
      label: "NPP Quality",
      value: nppQuality,
      blurb: "Recruitment capacity from Org",
      tooltip:
        "Higher Org unlocks more NPP recruitment slots in this state (2 at low Org, up to 5 at 50%+). Mid starts around 30% Org; High reflects a strong local machine.",
    },
    {
      label: "Influence",
      value: influence,
      blurb: "State influence action edge",
      tooltip:
        "Org nudges success on state-party influence actions targeting NPPs. Below 50% Org there is no bonus (Baseline); above 50% you gain a small positive edge.",
    },
  ];
}

export function StatePartyMetricsPanel({ stateParty }: StatePartyMetricsPanelProps) {
  const orgLabel = getOrgLabel(stateParty.organization);
  const orgValue =
    typeof stateParty.organization === "number"
      ? stateParty.organization.toFixed(1)
      : stateParty.organization;
  const effects = getOrgEffects(stateParty.organization);

  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden">
      {/* Organization Header */}
      <div
        className="px-6 pt-5 pb-4 flex items-start justify-between gap-4"
        style={{ borderBottom: `3px solid ${stateParty.partyColor}30` }}
      >
        <div>
          <div className="flex items-center gap-2 mb-1">
            <svg
              className={`h-4 w-4 ${orgLabel.color}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
              />
            </svg>
            <h2 className="font-semibold">Party Organization</h2>
            <Tooltip
              label="About Party Organization"
              content="Your share of this state's 100-point Org pool — infrastructure, volunteers, and ground game. It decays each turn; use Build Org below to grow it. The leftover pool is Unaffiliated."
            />
          </div>
          <p className="text-xs text-muted/70 leading-relaxed max-w-md">
            {getOrgFlavorText(stateParty.organization, stateParty.partyName)}
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className={`text-3xl font-bold tabular-nums ${orgLabel.color}`}>{orgValue}</div>
          <div className={`text-xs font-semibold ${orgLabel.color}`}>{orgLabel.label}</div>
        </div>
      </div>

      <div className="px-6 py-4 space-y-4">
        {/* Organization Bar */}
        <div>
          <div className="relative h-3 overflow-hidden rounded-full bg-background">
            <div
              className={`h-full rounded-full transition-all duration-500 ${getOrgBarColor(stateParty.organization)}`}
              style={{ width: `${Math.min(100, Math.max(0, stateParty.organization))}%` }}
            />
          </div>
          <div className="mt-1.5 text-xs text-muted tabular-nums">
            {orgValue}% of statewide Org pool
          </div>
        </div>

        {/* What Org does — readable rows with tooltips, not unlabeled icon tiles */}
        <div>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
            What Org does here
          </div>
          <div className="divide-y divide-card-border/40 rounded-lg border border-card-border/40 bg-background/40">
            {effects.map((effect) => (
              <div
                key={effect.label}
                className="flex items-start justify-between gap-3 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="flex items-center text-xs font-medium text-foreground">
                    {effect.label}
                    <Tooltip label={`About ${effect.label}`} content={effect.tooltip} />
                  </div>
                  <div className="mt-0.5 text-[11px] leading-snug text-muted">{effect.blurb}</div>
                </div>
                <div
                  className="shrink-0 text-sm font-bold tabular-nums"
                  style={{ color: stateParty.partyColor }}
                >
                  {effect.value}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
