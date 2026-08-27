/** Chancellor-authored annual omnibus Budget for the UK. */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface TaxLever {
  id: string;
  label: string;
  taxType: string;
  minRate: number;
  maxRate: number;
  step: number;
  currentRate: number;
}

interface ProgramLever {
  id: string;
  label: string;
  category: string;
  currentLevel: number;
  levels: Array<{ level: number; label: string; description: string }>;
}

interface BudgetResponse {
  fiscalYear: number;
  isChancellor: boolean;
  isActingChancellor: boolean;
  canAuthor: boolean;
  chancellorVacant: boolean;
  taxLevers: TaxLever[];
  programLevers: ProgramLever[];
  budget: {
    status: "draft" | "tabled" | "passed" | "defeated";
    taxRates: Record<string, number>;
    programLevels: Record<string, number>;
  } | null;
}

interface BudgetPreview {
  ok: true;
  current: { revenue: number; spending: number; balance: number };
  projected: { revenue: number; spending: number; balance: number };
  categoryDeltas: Record<string, number>;
  phaseInTurns: number;
}

function funds(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${sign}£${(abs / 1_000_000_000).toFixed(2)}bn`;
  if (abs >= 1_000_000) return `${sign}£${(abs / 1_000_000).toFixed(1)}m`;
  return `${sign}£${abs.toFixed(1)}`;
}

export function BudgetAuthoringPanel({ countryCode }: { countryCode: string }) {
  const endpoint = `/api/country/${countryCode}/budget`;
  const [data, setData] = useState<BudgetResponse | null>(null);
  const [taxRates, setTaxRates] = useState<Record<string, number>>({});
  const [programLevels, setProgramLevels] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<BudgetPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(endpoint)
      .then((response) => (response.ok ? response.json() : null))
      .then((json: BudgetResponse | null) => {
        if (!alive || !json) return;
        const liveTaxRates = Object.fromEntries(
          json.taxLevers.map((lever) => [lever.id, lever.currentRate])
        );
        const liveProgramLevels = Object.fromEntries(
          json.programLevers.map((lever) => [lever.id, lever.currentLevel])
        );
        setData(json);
        setTaxRates({ ...liveTaxRates, ...(json.budget?.taxRates ?? {}) });
        setProgramLevels({ ...liveProgramLevels, ...(json.budget?.programLevels ?? {}) });
      })
      .catch((cause) => {
        if (alive) setError(cause instanceof Error ? cause.message : "Could not load the Budget");
      });
    return () => {
      alive = false;
    };
  }, [endpoint]);

  const hasChanges = useMemo(() => {
    if (!data) return false;
    return (
      data.taxLevers.some((lever) => taxRates[lever.id] !== lever.currentRate) ||
      data.programLevers.some((lever) => programLevels[lever.id] !== lever.currentLevel)
    );
  }, [data, programLevels, taxRates]);

  const programsByCategory = useMemo(() => {
    const grouped = new Map<string, ProgramLever[]>();
    for (const lever of data?.programLevers ?? []) {
      grouped.set(lever.category, [...(grouped.get(lever.category) ?? []), lever]);
    }
    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [data]);

  const submit = useCallback(
    async (action: "preview" | "save" | "table") => {
      setBusy(true);
      setError(null);
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ taxRates, programLevels, action }),
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok || json?.ok === false) {
          setError(json?.error ?? "Could not process the Budget");
          return;
        }
        if (action === "preview") {
          setPreview(json as BudgetPreview);
          return;
        }
        setData((current) =>
          current
            ? {
                ...current,
                budget: {
                  status: action === "table" ? "tabled" : "draft",
                  taxRates,
                  programLevels,
                },
              }
            : current
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not process the Budget");
      } finally {
        setBusy(false);
      }
    },
    [endpoint, programLevels, taxRates]
  );

  if (!data) return null;
  if (!data.canAuthor) {
    return (
      <div className="rounded-2xl border border-card-border bg-card p-6 shadow-card">
        <h3 className="text-caption font-semibold uppercase tracking-wider text-muted">
          Budget {data.fiscalYear}
        </h3>
        <p className="mt-2 text-body-sm text-muted">
          Only the Chancellor of the Exchequer can author the annual Budget. If the office is
          vacant, the Prime Minister may act until an appointment is made.
        </p>
      </div>
    );
  }

  const locked = Boolean(data.budget?.status && data.budget.status !== "draft");
  return (
    <div className="space-y-5 rounded-2xl border border-card-border bg-card p-6 shadow-card">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h3 className="text-caption font-semibold uppercase tracking-wider text-muted">
            Budget {data.fiscalYear}
          </h3>
          <p className="mt-1 text-body-sm text-muted">
            Bundle tax rates and statutory programme levels into one Commons confidence vote.
            Ordinary laws remain effective and whichever measure passes later controls.
          </p>
        </div>
        <span className="text-body-sm capitalize text-muted">{data.budget?.status ?? "new"}</span>
      </div>

      {data.isActingChancellor ? (
        <p className="rounded border border-warning/40 bg-warning/10 p-3 text-body-sm text-muted">
          The Chancellorship is vacant. As Prime Minister, you have acting Chancellor authority;
          appointing a Chancellor will transfer authoring authority.
        </p>
      ) : null}

      <section>
        <h4 className="mb-2 text-body-sm font-medium text-foreground">Tax measures</h4>
        <div className="grid gap-2 md:grid-cols-2">
          {data.taxLevers.map((lever) => (
            <label key={lever.id} className="flex items-center justify-between gap-3 text-body-sm">
              <span className="text-muted">{lever.label}</span>
              <span className="flex items-center gap-1">
                <input
                  aria-label={lever.label}
                  type="number"
                  min={lever.minRate}
                  max={lever.maxRate}
                  step={lever.step}
                  disabled={locked}
                  value={taxRates[lever.id] ?? lever.currentRate}
                  onChange={(event) => {
                    setPreview(null);
                    setTaxRates((rates) => ({
                      ...rates,
                      [lever.id]: Number(event.target.value),
                    }));
                  }}
                  className="w-20 rounded border border-card-border bg-card-muted px-2 py-1 text-right text-foreground disabled:opacity-50"
                />
                <span className="text-muted">%</span>
              </span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">
          Tax changes phase in at one percentage point per turn.
        </p>
      </section>

      <section>
        <h4 className="mb-2 text-body-sm font-medium text-foreground">Statutory programmes</h4>
        <div className="space-y-2">
          {programsByCategory.map(([category, levers]) => (
            <details
              key={category}
              open={category === "defense"}
              className="rounded border border-card-border p-3"
            >
              <summary className="cursor-pointer text-body-sm font-medium capitalize text-foreground">
                {category} ({levers.length})
              </summary>
              <div className="mt-3 space-y-3">
                {levers.map((lever) => (
                  <label
                    key={lever.id}
                    className="grid gap-1 text-body-sm md:grid-cols-[1fr_16rem] md:items-center"
                  >
                    <span className="text-muted">{lever.label}</span>
                    <select
                      aria-label={lever.label}
                      disabled={locked}
                      value={programLevels[lever.id] ?? lever.currentLevel}
                      onChange={(event) => {
                        setPreview(null);
                        setProgramLevels((levels) => ({
                          ...levels,
                          [lever.id]: Number(event.target.value),
                        }));
                      }}
                      className="rounded border border-card-border bg-card-muted px-2 py-1 text-foreground disabled:opacity-50"
                    >
                      {lever.levels.map((level) => (
                        <option key={level.level} value={level.level}>
                          {level.label}
                        </option>
                      ))}
                    </select>
                    <span className="text-xs leading-snug text-muted md:col-start-2">
                      {
                        lever.levels.find(
                          (level) => level.level === (programLevels[lever.id] ?? lever.currentLevel)
                        )?.description
                      }
                    </span>
                  </label>
                ))}
              </div>
            </details>
          ))}
        </div>
      </section>

      {preview ? (
        <div className="rounded border border-card-border bg-card-muted p-4 text-body-sm">
          <p className="font-medium text-foreground">
            Projected {preview.projected.balance >= 0 ? "surplus" : "deficit"}:{" "}
            {funds(Math.abs(preview.projected.balance))}
          </p>
          <p className="mt-1 text-muted">
            Current {preview.current.balance >= 0 ? "surplus" : "deficit"}{" "}
            {funds(Math.abs(preview.current.balance))}. Projected revenue{" "}
            {funds(preview.projected.revenue)}; spending {funds(preview.projected.spending)}.
            {preview.phaseInTurns > 0
              ? ` Full tax effect after about ${preview.phaseInTurns} turns.`
              : " No tax phase-in delay."}
          </p>
          {Object.keys(preview.categoryDeltas).length > 0 ? (
            <ul className="mt-2 space-y-1 border-t border-card-border pt-2 text-muted">
              {Object.entries(preview.categoryDeltas)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([category, delta]) => (
                  <li key={category} className="flex justify-between gap-3">
                    <span className="capitalize">{category} spending</span>
                    <span className="font-mono text-foreground">{funds(delta)}</span>
                  </li>
                ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="text-body-sm text-danger">{error}</p> : null}

      {locked ? (
        <p className="text-body-sm text-muted">
          The Budget has been tabled before the Commons and can no longer be edited.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy || !hasChanges}
            onClick={() => submit("preview")}
            className="rounded border border-card-border px-3 py-1.5 text-body-sm text-muted disabled:opacity-50"
          >
            Preview Budget
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => submit("save")}
            className="rounded border border-card-border px-3 py-1.5 text-body-sm text-muted disabled:opacity-50"
          >
            Save draft
          </button>
          <button
            type="button"
            disabled={busy || !hasChanges}
            onClick={() => submit("table")}
            className="rounded border border-foreground bg-foreground px-3 py-1.5 text-body-sm text-background disabled:opacity-50"
          >
            Table Budget
          </button>
        </div>
      )}
    </div>
  );
}
