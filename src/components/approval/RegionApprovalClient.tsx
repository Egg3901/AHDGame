"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { netModifierEffect, type ActiveModifier } from "@/lib/utils/approvalModifiers";
import { regionUrl, regionApiSubUrl, approvalUrl } from "@/lib/urls";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { ModifierList } from "@/components/approval/ModifierChip";
import { computeRegionalConditionMargin } from "@/lib/states/conditions/marginEffects";

interface StateApprovalData {
  stateId: string;
  stateName: string;
  governmentApproval: number;
  governmentApprovalBase: number;
  governmentApprovalModifiers: ActiveModifier[];
}

function approvalColor(v: number) {
  return v >= 50 ? "text-success" : v >= 40 ? "text-warning" : "text-error";
}

export function RegionApprovalClient({
  countryId,
  stateId,
}: {
  countryId: CountryId;
  stateId: string;
}) {
  const config = COUNTRY_CONFIGS[countryId];
  const countryShortLabel = config?.code ?? countryId;

  const [data, setData] = useState<StateApprovalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = regionApiSubUrl(countryId, stateId, "metrics");

    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Not found"))))
      .then((d) => {
        setData({
          stateId: d.stateId ?? stateId,
          stateName: d.stateName ?? d.regionName ?? stateId,
          governmentApproval: d.governmentApproval ?? 50,
          governmentApprovalBase: d.governmentApprovalBase ?? d.governmentApproval ?? 50,
          governmentApprovalModifiers: d.governmentApprovalModifiers ?? [],
        });
      })
      .catch(() => setError("Failed to load data"))
      .finally(() => setLoading(false));
  }, [countryId, stateId]);

  const modifiers = data?.governmentApprovalModifiers ?? [];
  const netApproval = netModifierEffect(modifiers);
  const netMargin = computeRegionalConditionMargin(modifiers);

  const backHref = regionUrl(countryId, stateId);
  const nationalHref = approvalUrl(countryId);

  return (
    <div className="min-h-screen bg-background pb-16">
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <div className="flex items-center gap-2 mb-4 text-xs text-muted">
          <Link href={nationalHref} className="hover:text-foreground transition-colors">
            {countryShortLabel} Approval &amp; Active Effects
          </Link>
          <span>/</span>
          <span>{data?.stateName ?? stateId}</span>
        </div>

        <h1 className="text-2xl font-bold mb-1">
          {data?.stateName ?? stateId} — Approval &amp; Active Effects
        </h1>
        <p className="text-sm text-muted mb-8">
          Approval relative to the national average, adjusted by named conditions, and their
          knock-on effects on in-state sector profit margins.
        </p>

        {loading && (
          <div className="rounded-xl border border-card-border bg-card p-12 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-error/30 bg-error/5 p-8 text-center">
            <p className="text-error">{error}</p>
          </div>
        )}

        {!loading && !error && data && (
          <div className="space-y-6">
            <div className="rounded-xl border border-card-border bg-card p-6 shadow-panel">
              <div className="flex flex-wrap items-end gap-8">
                <div>
                  <p className="text-xs uppercase tracking-widest text-muted font-medium mb-1">
                    Base Score
                  </p>
                  <p className="text-4xl font-bold tabular-nums text-foreground">
                    {data.governmentApprovalBase.toFixed(1)}%
                  </p>
                  <p className="text-xs text-muted mt-1">Metrics vs national average</p>
                </div>
                <div className="text-2xl text-muted font-light">&rarr;</div>
                <div>
                  <p className="text-xs uppercase tracking-widest text-muted font-medium mb-1">
                    Net Approval
                  </p>
                  <p
                    className={`text-4xl font-bold tabular-nums ${netApproval >= 0 ? "text-success" : "text-error"}`}
                  >
                    {netApproval >= 0 ? "+" : ""}
                    {netApproval}
                  </p>
                  <p className="text-xs text-muted mt-1">{modifiers.length} active</p>
                </div>
                <div className="text-2xl text-muted font-light">=</div>
                <div>
                  <p className="text-xs uppercase tracking-widest text-muted font-medium mb-1">
                    Approval
                  </p>
                  <p
                    className={`text-5xl font-bold tabular-nums ${approvalColor(data.governmentApproval)}`}
                  >
                    {data.governmentApproval.toFixed(1)}%
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-card-border bg-card p-6 shadow-panel">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">
                  Active Effects
                </h2>
                {modifiers.length > 0 && (
                  <div className="flex gap-4 text-right text-xs">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted">
                        Net approval
                      </div>
                      <div
                        className={
                          "mt-0.5 font-semibold tabular-nums " +
                          (netApproval > 0
                            ? "text-emerald-500"
                            : netApproval < 0
                              ? "text-rose-500"
                              : "text-muted")
                        }
                      >
                        {netApproval > 0 ? "+" : ""}
                        {netApproval}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted">
                        Net margin
                      </div>
                      <div
                        className={
                          "mt-0.5 font-semibold tabular-nums " +
                          (netMargin > 0
                            ? "text-emerald-500"
                            : netMargin < 0
                              ? "text-rose-500"
                              : "text-muted")
                        }
                      >
                        {netMargin > 0 ? "+" : ""}
                        {netMargin}pp
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <ModifierList modifiers={modifiers} emptyText="No active effects." />
            </div>
          </div>
        )}

        <div className="mt-8 flex items-center gap-3 pt-4 border-t border-card-border/40">
          <Link
            href={backHref}
            className="rounded-lg border border-card-border bg-card px-4 py-2 text-sm font-medium text-muted hover:text-foreground transition-colors"
          >
            &larr; {data?.stateName ?? "Back"}
          </Link>
          <Link
            href={nationalHref}
            className="rounded-lg border border-card-border bg-card px-4 py-2 text-sm font-medium text-muted hover:text-foreground transition-colors"
          >
            {countryShortLabel} Approval Rankings
          </Link>
        </div>
      </main>
    </div>
  );
}
