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

interface AssessmentView {
  tier: "none" | "existence" | "estimate" | "exact";
  hasProgramme: boolean | null;
  warheads: number | null;
  warheadsAreEstimate: boolean;
  adoptedNodeCount: number | null;
  covertSuspected: boolean;
  covertStage: number | null;
  covertStageCount: number | null;
}

interface MilitaryAssessmentView {
  tier: "none" | "existence" | "estimate" | "exact";
  atWar: boolean | null;
  frontCount: number | null;
  formationCount: number | null;
  meanReadiness: number | null;
  figuresAreEstimate: boolean;
  fronts: Array<{ conflictId: string; supply: number }> | null;
}

interface AssessmentResponse {
  targetCountryId: string;
  domain: "strategic" | "military";
  coverage: number;
  assessment: AssessmentView;
}

interface EconomicAssessmentView {
  tier: "none" | "existence" | "estimate" | "exact";
  hasCorporateSector: boolean | null;
  corporationCount: number | null;
  publicCount: number | null;
  aggregateLiquidCapital: number | null;
  figuresAreEstimate: boolean;
}

interface EconomicAssessmentResponse {
  targetCountryId: string;
  domain: "strategic" | "military" | "economic";
  coverage: number;
  assessment: EconomicAssessmentView;
}

interface MilitaryAssessmentResponse {
  targetCountryId: string;
  domain: "strategic" | "military";
  coverage: number;
  assessment: MilitaryAssessmentView;
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

const TIER_LABEL: Record<string, string> = {
  none: "No assessment",
  existence: "Existence only",
  estimate: "Estimate",
  exact: "Confirmed",
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
/**
 * Assessments for every target this service has coverage on in one domain.
 *
 * Fetched per target rather than folded into the console read, so the console
 * route stays one job and the assessment route stays testable on its own. Each
 * domain reads its OWN coverage row: a service deep in a country's nuclear
 * programme has not thereby earned a look at its army or its books.
 */
function useAssessments<T>(
  view: ServiceView | null,
  countryId: CountryId,
  positionId: string,
  domain: "strategic" | "military" | "economic"
): T[] {
  const [rows, setRows] = useState<T[]>([]);
  useEffect(() => {
    const targets = (view?.coverage ?? [])
      .filter((c) => c.domain === domain && c.value > 0)
      .map((c) => c.targetCountryId);
    // No early return with a synchronous setState: an empty target list flows
    // through the same promise, so every state write lands in a callback.
    let cancelled = false;
    Promise.all(
      targets.map(
        (target) =>
          fetchJson<T>(
            `/api/country/${countryId}/executive/cabinet/${positionId}/intelligence/assessment?target=${target}&domain=${domain}`,
            { feature: `country-intelligence-assessment-${domain}` }
            // A failed assessment drops out rather than blanking the section:
            // one unreachable target should not hide the others.
          ).catch(() => null) as Promise<T | null>
      )
    ).then((settled) => {
      // `Promise.all` reports `Awaited<T>`, which TypeScript cannot prove equals
      // `T` for an unconstrained generic even though every T here is a plain
      // response object. The cast states what the call site already guarantees.
      const fetched = settled as (T | null)[];
      if (!cancelled) setRows(fetched.filter((r): r is T => r !== null));
    });
    return () => {
      cancelled = true;
    };
  }, [view, countryId, positionId, domain]);
  return rows;
}

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

  const assessments = useAssessments<AssessmentResponse>(view, countryId, positionId, "strategic");
  const militaryAssessments = useAssessments<MilitaryAssessmentResponse>(
    view,
    countryId,
    positionId,
    "military"
  );
  const economicAssessments = useAssessments<EconomicAssessmentResponse>(
    view,
    countryId,
    positionId,
    "economic"
  );

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
    <div className="min-w-0 space-y-4">
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

      <section className="min-w-0 overflow-hidden rounded-xl border border-card-border bg-card p-4 shadow-card">
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

      <section className="min-w-0 rounded-xl border border-card-border bg-card p-4 shadow-card">
        <h2 className="font-serif text-lg text-foreground">Nuclear Assessments</h2>
        <p className="mt-0.5 max-w-2xl text-sm text-muted">
          What strategic coverage currently buys you. Estimates carry real error and are stable
          while the coverage is, so re-reading the page will not sharpen them. Only sustained
          coverage confirms a figure.
        </p>
        {assessments.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            No strategic coverage anywhere. Run a collection operation in the strategic domain to
            begin an assessment.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {assessments.map((a) => (
              <li
                key={a.targetCountryId}
                className="rounded-lg border border-card-border bg-background p-3 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{a.targetCountryId}</span>
                  <span className="text-muted">
                    {TIER_LABEL[a.assessment.tier] ?? a.assessment.tier}
                  </span>
                  <span className="ml-auto text-xs text-muted">
                    Coverage {Math.round(a.coverage)}
                  </span>
                </div>
                <p className="mt-1 text-muted">
                  {a.assessment.hasProgramme === null
                    ? "Nothing usable yet."
                    : a.assessment.hasProgramme === false
                      ? "No nuclear weapons programme."
                      : a.assessment.warheads === null
                        ? "A nuclear weapons programme exists. Size unknown."
                        : `${a.assessment.warheadsAreEstimate ? "Estimated" : "Confirmed"} ${a.assessment.warheads} warheads.`}
                  {a.assessment.covertStage !== null
                    ? ` An undeclared programme stands at stage ${a.assessment.covertStage} of ${a.assessment.covertStageCount}.`
                    : a.assessment.covertSuspected
                      ? " Something undeclared is running. Depth unknown."
                      : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="min-w-0 rounded-xl border border-card-border bg-card p-4 shadow-card">
        <h2 className="font-serif text-lg text-foreground">Military Assessments</h2>
        <p className="mt-0.5 max-w-2xl text-sm text-muted">
          What military coverage buys you. This is what a service can read from the outside, not the
          view that a nation gives its own command staff.
        </p>
        {militaryAssessments.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            No military coverage anywhere. Run a collection operation in the military domain to
            begin an assessment.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {militaryAssessments.map((a) => (
              <li
                key={a.targetCountryId}
                className="rounded-lg border border-card-border bg-background p-3 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{a.targetCountryId}</span>
                  <span className="text-muted">
                    {TIER_LABEL[a.assessment.tier] ?? a.assessment.tier}
                  </span>
                  <span className="ml-auto text-xs text-muted">
                    Coverage {Math.round(a.coverage)}
                  </span>
                </div>
                <p className="mt-1 text-muted">
                  {a.assessment.atWar === null
                    ? "Nothing usable yet."
                    : a.assessment.atWar
                      ? `Fighting on ${a.assessment.frontCount} front${a.assessment.frontCount === 1 ? "" : "s"}.`
                      : "Not currently at war."}
                  {a.assessment.formationCount !== null
                    ? ` ${a.assessment.figuresAreEstimate ? "Estimated" : "Confirmed"} ${a.assessment.formationCount} formations at ${a.assessment.meanReadiness} mean readiness.`
                    : ""}
                </p>
                {a.assessment.fronts !== null && a.assessment.fronts.length > 0 && (
                  <p className="mt-1 text-xs text-muted">
                    Supply:{" "}
                    {a.assessment.fronts.map((f) => `${f.conflictId} ${f.supply}`).join(", ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="min-w-0 rounded-xl border border-card-border bg-card p-4 shadow-card">
        <h2 className="font-serif text-lg text-foreground">Economic Assessments</h2>
        <p className="mt-0.5 max-w-2xl text-sm text-muted">
          The national picture of a country&apos;s corporate sector. Reading one company&apos;s
          books is a separate act, and takes an operation rather than a threshold.
        </p>
        {economicAssessments.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            No economic coverage anywhere. Run a collection operation in the economic domain to
            begin an assessment.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {economicAssessments.map((a) => (
              <li
                key={a.targetCountryId}
                className="rounded-lg border border-card-border bg-background p-3 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{a.targetCountryId}</span>
                  <span className="text-muted">
                    {TIER_LABEL[a.assessment.tier] ?? a.assessment.tier}
                  </span>
                  <span className="ml-auto text-xs text-muted">
                    Coverage {Math.round(a.coverage)}
                  </span>
                </div>
                <p className="mt-1 text-muted">
                  {a.assessment.hasCorporateSector === null
                    ? "Nothing usable yet."
                    : a.assessment.hasCorporateSector === false
                      ? "No corporate sector to speak of."
                      : a.assessment.corporationCount === null
                        ? "There is a corporate sector. Size unknown."
                        : `${a.assessment.figuresAreEstimate ? "Estimated" : "Confirmed"} ${a.assessment.corporationCount} companies, ${a.assessment.publicCount} of them listed.`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="min-w-0 rounded-xl border border-card-border bg-card p-4 shadow-card">
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
