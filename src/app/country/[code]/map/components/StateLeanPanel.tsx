"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fetchJson } from "@/lib/observability/fetchJson";
import { regionUrl } from "@/lib/urls";
import { getDisplayLean } from "@/lib/utils/demographics";
import {
  getEconomicPositionName,
  getSocialPositionName,
  interpolateLeanHex,
} from "@/lib/utils/politics";
import type { StateDemographicGroup } from "@/lib/db/types";

interface RegionDemographicsResponse {
  stateId: string;
  stateName: string;
  groups: Record<string, StateDemographicGroup>;
  calculatedEconomicLean: number;
  calculatedSocialLean: number;
  categories: { id: string; name: string; groups: { id: string; name: string }[] }[];
}

interface GroupRow {
  id: string;
  name: string;
  population: number;
  economicLean: number;
  socialLean: number;
}

const fmt = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;

function LeanValue({
  value,
  axis,
  halfRange,
}: {
  value: number;
  axis: "economic" | "social";
  halfRange: number;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 tabular-nums">
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-sm"
        style={{ backgroundColor: interpolateLeanHex(value, axis, halfRange) }}
      />
      {fmt(value)}
    </span>
  );
}

/**
 * Demographic breakdown behind a state's political lean, opened by clicking a
 * state on the lean map. Groups are the same records `calculateStateLean`
 * averages (share × turnout × category weight), so the panel shows which blocs
 * pull the state where.
 */
export function StateLeanPanel({
  countryCode,
  stateId,
  onClose,
}: {
  countryCode: string;
  stateId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<RegionDemographicsResponse | null>(null);
  const [error, setError] = useState(false);

  // Callers key this component by stateId, so each state starts a fresh mount
  // and no in-effect state reset is needed.
  useEffect(() => {
    let cancelled = false;
    fetchJson<RegionDemographicsResponse>(
      `/api/country/${countryCode.toLowerCase()}/region/${stateId}/demographics`,
      { feature: "map-lean-panel" }
    )
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [countryCode, stateId]);

  // Per-category rows for groups this state actually carries, largest first.
  const sections = useMemo(() => {
    if (!data) return [];
    return data.categories
      .map((cat) => {
        const rows: GroupRow[] = cat.groups
          .map((g) => {
            const sg = data.groups[g.id];
            if (!sg) return null;
            return {
              id: g.id,
              name: g.name,
              population: Number(sg.population) || 0,
              economicLean: Number(sg.economicLean) || 0,
              socialLean: Number(sg.socialLean) || 0,
            };
          })
          .filter((r): r is GroupRow => r !== null && r.population > 0)
          .sort((a, b) => b.population - a.population);
        return { id: cat.id, name: cat.name, rows };
      })
      .filter((s) => s.rows.length > 0);
  }, [data]);

  // One shared colour domain across all group chips so shades are comparable.
  const groupHalfRange = useMemo(() => {
    let max = 0.5;
    for (const s of sections) {
      for (const r of s.rows) {
        max = Math.max(max, Math.abs(r.economicLean), Math.abs(r.socialLean));
      }
    }
    return max;
  }, [sections]);

  const combined = data
    ? getDisplayLean(data.calculatedEconomicLean, data.calculatedSocialLean)
    : 0;

  return (
    <div className="mt-4 rounded-xl border border-card-border bg-card p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold truncate">
            {data?.stateName ?? stateId} lean breakdown
          </h2>
          {data && (
            <p className="mt-1 text-sm text-muted">
              Combined {fmt(combined)} ({getEconomicPositionName(combined)}) · Economic{" "}
              {fmt(data.calculatedEconomicLean)} (
              {getEconomicPositionName(data.calculatedEconomicLean)}) · Social{" "}
              {fmt(data.calculatedSocialLean)} ({getSocialPositionName(data.calculatedSocialLean)})
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={regionUrl(countryCode, stateId)}
            className="rounded-lg border border-card-border bg-card-elevated px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground transition-colors"
          >
            Open state page →
          </Link>
          <button
            onClick={onClose}
            aria-label="Close breakdown"
            className="rounded-lg border border-card-border px-2.5 py-1.5 text-xs text-muted hover:text-foreground transition-colors"
          >
            ✕
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-4 text-sm text-muted">No demographic data available for this state.</p>
      )}
      {!data && !error && <p className="mt-4 text-sm text-muted">Loading demographics…</p>}

      {data && sections.length > 0 && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {sections.map((cat) => (
            <div
              key={cat.id}
              className="rounded-lg border border-card-border/60 bg-card-elevated/40 p-3"
            >
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                {cat.name}
              </h3>
              <table className="mt-2 w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-muted">
                    <th className="pb-1 font-medium">Group</th>
                    <th className="pb-1 font-medium text-right">Share</th>
                    <th className="pb-1 font-medium text-right">Econ</th>
                    <th className="pb-1 font-medium text-right">Social</th>
                  </tr>
                </thead>
                <tbody>
                  {cat.rows.map((r) => (
                    <tr key={r.id} className="border-t border-card-border/40">
                      <td className="py-1 pr-2">{r.name}</td>
                      <td className="py-1 text-right tabular-nums">{r.population.toFixed(0)}%</td>
                      <td className="py-1 pl-2 text-right">
                        <LeanValue
                          value={r.economicLean}
                          axis="economic"
                          halfRange={groupHalfRange}
                        />
                      </td>
                      <td className="py-1 pl-2 text-right">
                        <LeanValue value={r.socialLean} axis="social" halfRange={groupHalfRange} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {data && (
        <p className="mt-3 text-[10px] text-muted">
          State lean is the turnout-weighted average of these groups (share × turnout × category
          weight), on the −5…+5 position ruler.
        </p>
      )}
    </div>
  );
}
