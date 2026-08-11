"use client";

import { useState } from "react";
import Link from "next/link";
import {
  COMMODITY_LABELS,
  COMMODITY_UNITS,
  EXTRACTABLE_RESOURCES,
} from "@/lib/constants/commodities";
import type { ExtractableResource } from "@/lib/constants/commodities";
import { regionUrl } from "@/lib/urls";
import type { CountryId } from "@/lib/constants/countries";
import { useProspectingSurveys } from "@/hooks/useProspectingSurveys";
import { ProspectingSurveyList } from "@/components/extraction/ProspectingSurveyList";
import type { ExtractionCapacityRow, ResourceOpportunity } from "../types";
import ProspectModal from "./ProspectModal";

interface ResourceCapacityPanelProps {
  stateResources: Partial<Record<ExtractableResource, number>>;
  /** Per-resource cap/desired/headroom rows from the API (extraction only). */
  capacityRows?: ExtractionCapacityRow[] | null;
  /** Signpost: other states with free capacity for this sector's binding resource(s). */
  opportunities?: ResourceOpportunity[] | null;
  stateId: string;
  countryId: string;
  /** CEO-only Prospect action, gated on gameConfig.prospectingEnabled. */
  isCeo?: boolean;
  corpId?: string;
  rdScore?: number;
  liquidCurrencyCode?: string | null;
  currentTurn?: number;
  prospectingEnabled?: boolean;
}

export default function ResourceCapacityPanel({
  stateResources,
  capacityRows,
  opportunities,
  stateId,
  countryId,
  isCeo = false,
  corpId,
  rdScore = 0,
  liquidCurrencyCode,
  currentTurn = 0,
  prospectingEnabled = false,
}: ResourceCapacityPanelProps) {
  const rowByResource = new Map((capacityRows ?? []).map((r) => [r.resource, r]));
  const signpost = (opportunities ?? []).filter((o) => o.states.length > 0);
  const showHeadroom = (capacityRows?.length ?? 0) > 0;
  const resourcesTabHref = `${regionUrl(countryId as CountryId, stateId)}?tab=resources`;
  const canProspect = isCeo && prospectingEnabled && !!corpId;

  const [prospectResource, setProspectResource] = useState<ExtractableResource | null>(null);
  const {
    surveys,
    loading: surveysLoading,
    refresh,
  } = useProspectingSurveys({
    stateId,
    corporationId: corpId,
    enabled: canProspect,
  });

  return (
    <section className="rounded-xl border border-card-border bg-card p-6 shadow-card">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-foreground">Resource Availability</h2>
          <p className="text-xs text-muted mt-0.5">
            Extractable deposits in this state. Zero-capacity resources produce no output regardless
            of sector revenue.
          </p>
          <p className="text-xs text-muted mt-1">
            Capacity is set per state per resource. Output above reachable capacity is clamped.
            Scarce-resource shortages raise prices until new capacity is worth working.
          </p>
        </div>
        <Link href={resourcesTabHref} className="shrink-0 text-xs text-primary hover:underline">
          Contracts & capacity →
        </Link>
      </div>

      {signpost.length > 0 && (
        <div className="mb-5 rounded-lg border border-warning/30 bg-warning/10 p-4">
          <p className="text-sm font-semibold text-warning">
            This deposit is limiting your output. Room to grow elsewhere.
          </p>
          <div className="mt-3 space-y-3">
            {signpost.map((opp) => {
              const resource = opp.resource as ExtractableResource;
              const unit = COMMODITY_UNITS[resource] ?? "";
              const label = COMMODITY_LABELS[resource] ?? opp.resource;
              return (
                <div key={opp.resource}>
                  <p className="text-xs text-foreground">
                    {label} is nearly tapped out in this state. States with the most free capacity:
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {opp.states.map((s) => (
                      <li key={s.stateId} className="text-xs">
                        <Link
                          href={`${regionUrl(s.countryId as CountryId, s.stateId)}?tab=resources`}
                          className="text-primary hover:underline"
                        >
                          {s.stateId} ({s.countryId})
                        </Link>
                        <span className="text-muted">
                          {" "}
                          plus {s.headroom.toLocaleString("en-US")} {unit} free
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] text-muted">
            Place or move a mine into one of these states, or switch this sector to a focus that
            matches the deposits here.
          </p>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted text-xs uppercase tracking-widest">
              <th className="text-left font-medium pb-2">Resource</th>
              <th className="text-right font-medium pb-2">Capacity / turn</th>
              {showHeadroom && <th className="text-right font-medium pb-2">Wanted / turn</th>}
              {showHeadroom && <th className="text-right font-medium pb-2">Headroom</th>}
              <th className="text-right font-medium pb-2">Status</th>
              {canProspect && <th className="text-right font-medium pb-2" />}
            </tr>
          </thead>
          <tbody>
            {EXTRACTABLE_RESOURCES.map((resource) => {
              const capacity = stateResources[resource] ?? 0;
              const row = rowByResource.get(resource);
              const unit = COMMODITY_UNITS[resource] ?? "";
              const available = capacity > 0;
              return (
                <tr key={resource} className="border-t border-card-border">
                  <td className="py-2 font-medium">{COMMODITY_LABELS[resource] ?? resource}</td>
                  <td className="py-2 text-right tabular-nums text-muted">
                    {available ? `${capacity.toLocaleString("en-US")} ${unit}` : "n/a"}
                  </td>
                  {showHeadroom && (
                    <td className="py-2 text-right tabular-nums text-muted">
                      {row ? row.desired.toLocaleString("en-US") : "n/a"}
                    </td>
                  )}
                  {showHeadroom && (
                    <td
                      className={`py-2 text-right tabular-nums ${
                        row && row.headroom < 0 ? "text-error" : "text-muted"
                      }`}
                    >
                      {row ? row.headroom.toLocaleString("en-US") : "n/a"}
                    </td>
                  )}
                  <td className="py-2 text-right">
                    {available ? (
                      <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
                        Available
                      </span>
                    ) : (
                      <span className="rounded-full bg-error/15 px-2 py-0.5 text-xs font-medium text-error">
                        No deposits
                      </span>
                    )}
                  </td>
                  {canProspect && (
                    <td className="py-2 text-right">
                      {available && (
                        <button
                          type="button"
                          onClick={() => setProspectResource(resource)}
                          className="rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/15 transition-colors"
                        >
                          Prospect
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canProspect && (
        <div className="mt-5 border-t border-card-border pt-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted">
            Geological surveys
          </p>
          <ProspectingSurveyList
            surveys={surveys}
            currentTurn={currentTurn}
            loading={surveysLoading}
          />
        </div>
      )}

      {canProspect && prospectResource && corpId && (
        <ProspectModal
          corpId={corpId}
          stateId={stateId}
          resource={prospectResource}
          capacity={stateResources[prospectResource] ?? 0}
          rdScore={rdScore}
          liquidCurrencyCode={liquidCurrencyCode}
          onClose={() => setProspectResource(null)}
          onLaunched={() => {
            setProspectResource(null);
            refresh();
          }}
        />
      )}
    </section>
  );
}
