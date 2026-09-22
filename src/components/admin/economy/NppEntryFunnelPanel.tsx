"use client";

import { useEffect, useState } from "react";
import { normalizeMarketFormationSnapshot } from "@/lib/economy/marketFormationSnapshot";
import type { MarketFormationSnapshot } from "@/lib/db/types/marketFormation";
import type { NppMarketEntryFunnel } from "@/lib/db/types/marketFormation";
import type { EconomicVitalSigns } from "@/lib/db/types/economicVitalSigns";

function pct(share: number | null): string {
  return share == null ? "n/a" : `${(share * 100).toFixed(1)}%`;
}

// Read-only operator view over the persisted #991 evidence: the NPP entry
// funnel (one primary reason per candidate) and the state-sector coverage
// aggregates already embedded in the vital-signs snapshot. This view changes
// no entry mechanics and manages no experiment flags.
export function NppEntryFunnelPanel() {
  const [funnel, setFunnel] = useState<NppMarketEntryFunnel | null>(null);
  const [funnelMissing, setFunnelMissing] = useState(false);
  const [coverage, setCoverage] = useState<MarketFormationSnapshot | null>(null);
  const [coverageMissing, setCoverageMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [funnelRes, vitalRes] = await Promise.all([
          fetch("/api/admin/economy/npp-entry-funnel"),
          fetch("/api/admin/economy/vital-signs"),
        ]);
        if (!funnelRes.ok) {
          if (funnelRes.status === 404) setFunnelMissing(true);
          else throw new Error(`Funnel HTTP ${funnelRes.status}`);
        } else {
          const body = (await funnelRes.json()) as { funnel: NppMarketEntryFunnel };
          if (!cancelled) setFunnel(body.funnel);
        }
        if (!vitalRes.ok) {
          if (vitalRes.status === 404) setCoverageMissing(true);
          else throw new Error(`Vital signs HTTP ${vitalRes.status}`);
        } else {
          const body = (await vitalRes.json()) as { snapshot: EconomicVitalSigns };
          if (!cancelled)
            setCoverage(normalizeMarketFormationSnapshot(body.snapshot?.marketFormation));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <div>Loading entry evidence...</div>;
  if (error) return <div className="text-red-500">Failed to load entry evidence: {error}</div>;

  const reasons = funnel
    ? Object.entries(funnel.reasonCounts).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    : [];
  const classifications = coverage
    ? (Object.entries(coverage.classificationCounts) as Array<[string, number]>).sort(
        (a, b) => b[1] - a[1]
      )
    : [];

  return (
    <div className="space-y-6 rounded border p-4">
      <div>
        <h3 className="text-lg font-semibold">NPP entry funnel</h3>
        {funnelMissing || !funnel ? (
          <p>No funnel snapshot yet. It is written by the NPP turn phase.</p>
        ) : (
          <>
            <p>
              Turn {funnel.turn}: {funnel.corporationsObserved} observed, {funnel.entered} entered,{" "}
              {funnel.rejected} rejected.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Primary reason</th>
                  <th>Candidates</th>
                </tr>
              </thead>
              <tbody>
                {reasons.map(([reason, count]) => (
                  <tr key={reason}>
                    <td>{reason}</td>
                    <td>{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
      <div>
        <h3 className="text-lg font-semibold">State-sector coverage</h3>
        {coverageMissing || !coverage ? (
          <p>No vital-signs snapshot yet.</p>
        ) : (
          <>
            <p>
              {coverage.emptyCells} of {coverage.cellsObserved} cells empty (
              {pct(coverage.emptyShare)}), {coverage.facilityReadyEmptyCells} facility-ready (
              {pct(coverage.facilityReadyEmptyShare)} of empty).
            </p>
            {coverage.coverageByCountry.length === 0 && (
              <p>Per-state coverage starts with snapshots written by this build.</p>
            )}
            <table>
              <thead>
                <tr>
                  <th>Empty-cell classification</th>
                  <th>Cells</th>
                </tr>
              </thead>
              <tbody>
                {classifications.map(([name, count]) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td>{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
      <p className="text-sm opacity-70">
        Read-only evidence. This view recomputes nothing and changes no entry mechanics.
      </p>
    </div>
  );
}
