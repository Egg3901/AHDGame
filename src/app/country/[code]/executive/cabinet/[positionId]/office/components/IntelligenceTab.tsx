"use client";
import { useCallback, useEffect, useState } from "react";
import { fetchJson } from "@/lib/observability/fetchJson";
import type { CountryId } from "@/lib/constants/countries";

interface AgencyView {
  tradecraft: number;
  counterIntel: number;
  budgetRemaining: number;
  foundedTurn: number;
  hasDirector: boolean;
}

interface NetworkView {
  targetCountryId: string;
  level: number;
  progress: number;
  funding: string;
  suspicion: number;
  status: string;
  cooledUntilTurn: number | null;
}

interface CoverageView {
  targetCountryId: string;
  domain: string;
  value: number;
  lastCollectedTurn: number;
}

interface IncidentView {
  targetCountryId: string;
  domain: string;
  opType: string;
  outcome: string;
  compromise: string;
  effectSummary: string;
  turn: number;
}

interface ServiceView {
  agency: AgencyView;
  turn: number;
  slotsRemaining: number;
  networks: NetworkView[];
  coverage: CoverageView[];
  incidents: IncidentView[];
}

const DOMAIN_LABEL: Record<string, string> = {
  strategic: "Strategic",
  military: "Military",
  economic: "Economic",
};

const COMPROMISE_LABEL: Record<string, string> = {
  clean: "Clean",
  blown: "Blown",
  detected: "Detected",
  attributed: "Attributed",
};

/**
 * The intelligence console, rendered as a tab on the director's own cabinet
 * office page.
 *
 * It lives here rather than at a top-level route because that is where this repo
 * puts seat-owned machinery: the defence seat's Commands and Doctrine tabs, and
 * the covert nuclear panel, are all inside the office. A standalone page would
 * also have had no navigation into it.
 */
export default function IntelligenceTab({
  countryId,
  positionId,
}: {
  countryId: CountryId;
  positionId: string;
}) {
  const [view, setView] = useState<ServiceView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchJson<ServiceView>(
      `/api/country/${countryId}/executive/cabinet/${positionId}/intelligence`,
      { feature: "country-intelligence" }
    )
      .then(setView)
      .catch(() => setError("This office's records are not open to you."));
  }, [countryId, positionId]);

  useEffect(load, [load]);

  if (error) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6 text-sm text-muted">
        {error}
      </div>
    );
  }
  if (!view) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6 text-sm text-muted">
        Loading the service…
      </div>
    );
  }

  const coverageFor = (target: string) => view.coverage.filter((c) => c.targetCountryId === target);

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-card-border bg-card p-4 shadow-card">
        <h2 className="font-serif text-lg text-foreground">The Service</h2>
        <p className="mt-0.5 max-w-2xl text-sm text-muted">
          Networks are slow to build and are what a compromise costs you. Coverage is perishable: it
          decays every turn, so a service that stops collecting goes blind on what it already knows.
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Tradecraft</dt>
            <dd className="text-lg font-semibold text-foreground">{view.agency.tradecraft}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Counter-Intelligence</dt>
            <dd className="text-lg font-semibold text-foreground">{view.agency.counterIntel}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Operations Left</dt>
            <dd className="text-lg font-semibold text-foreground">{view.slotsRemaining}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Budget</dt>
            <dd className="text-lg font-semibold text-foreground">
              {view.agency.budgetRemaining.toLocaleString()}
            </dd>
          </div>
        </dl>
        {!view.agency.hasDirector && (
          <p className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-foreground">
            The service has no director. Existing networks keep running and existing files stay
            readable, but no new work can be funded until the seat is filled.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-card-border bg-card p-4 shadow-card">
        <h2 className="font-serif text-lg text-foreground">Networks</h2>
        {view.networks.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            No networks abroad. Fund one in a target country to begin.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[42rem] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="py-2">Country</th>
                  <th className="py-2">Level</th>
                  <th className="py-2">Funding</th>
                  <th className="py-2">Suspicion</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Coverage</th>
                </tr>
              </thead>
              <tbody>
                {view.networks.map((n) => (
                  <tr key={n.targetCountryId} className="border-t border-card-border">
                    <td className="py-2 font-medium text-foreground">{n.targetCountryId}</td>
                    <td className="py-2 text-foreground">{n.level}</td>
                    <td className="py-2 capitalize text-muted">{n.funding}</td>
                    <td className="py-2 text-muted">{n.suspicion}</td>
                    <td className="py-2 capitalize text-muted">
                      {n.status}
                      {n.status === "burned" && n.cooledUntilTurn != null
                        ? ` until turn ${n.cooledUntilTurn}`
                        : ""}
                    </td>
                    <td className="py-2 text-muted">
                      {coverageFor(n.targetCountryId).length === 0
                        ? "None"
                        : coverageFor(n.targetCountryId)
                            .map(
                              (c) => `${DOMAIN_LABEL[c.domain] ?? c.domain} ${Math.round(c.value)}`
                            )
                            .join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-card-border bg-card p-4 shadow-card">
        <h2 className="font-serif text-lg text-foreground">Recent Operations</h2>
        {view.incidents.length === 0 ? (
          <p className="mt-2 text-sm text-muted">The service has run nothing yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {view.incidents.map((i, idx) => (
              <li
                key={`${i.turn}-${i.targetCountryId}-${idx}`}
                className="rounded-lg border border-card-border bg-background p-3 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{i.targetCountryId}</span>
                  <span className="text-muted">{DOMAIN_LABEL[i.domain] ?? i.domain}</span>
                  <span className="text-muted">{i.outcome === "success" ? "Success" : "Miss"}</span>
                  <span className="text-muted">
                    {COMPROMISE_LABEL[i.compromise] ?? i.compromise}
                  </span>
                  <span className="ml-auto text-xs text-muted">Turn {i.turn}</span>
                </div>
                <p className="mt-1 text-muted">{i.effectSummary}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
