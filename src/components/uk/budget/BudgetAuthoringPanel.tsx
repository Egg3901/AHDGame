/**
 * Chancellor's Budget authoring panel (epic #856, ticket #858).
 *
 * Tax levers + departmental spending shares (must sum to 100). Save a draft or
 * table it for the Commons confidence vote. Only the Chancellor sees the
 * controls; others get a read-only note. The confidence consequence of a defeat
 * stays gated downstream.
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface Lever {
  id: string;
  label: string;
}
interface BudgetResponse {
  fiscalYear: number;
  isChancellor: boolean;
  taxLevers: Lever[];
  spendingCategories: string[];
  budget: {
    status: "draft" | "tabled" | "passed" | "defeated";
    taxRates: Record<string, number>;
    spendingAllocations: Record<string, number>;
  } | null;
}

const SPENDING_TOLERANCE = 0.5;

export function BudgetAuthoringPanel({ countryCode }: { countryCode: string }) {
  const endpoint = `/api/country/${countryCode}/budget`;
  const [data, setData] = useState<BudgetResponse | null>(null);
  const [taxRates, setTaxRates] = useState<Record<string, number>>({});
  const [spending, setSpending] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(endpoint)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: BudgetResponse | null) => {
        if (!alive || !json) return;
        setData(json);
        setTaxRates(json.budget?.taxRates ?? {});
        setSpending(json.budget?.spendingAllocations ?? {});
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : "Could not load the Budget");
      });
    return () => {
      alive = false;
    };
  }, [endpoint]);

  const spendingTotal = useMemo(
    () => Object.values(spending).reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0),
    [spending]
  );
  const balanced = Math.abs(spendingTotal - 100) <= SPENDING_TOLERANCE;
  const locked = data?.budget?.status && data.budget.status !== "draft";

  const submit = useCallback(
    async (action: "save" | "table") => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ taxRates, spendingAllocations: spending, action }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(json?.error ?? "Could not save the Budget");
          return;
        }
        setData((d) =>
          d
            ? {
                ...d,
                budget: {
                  ...(d.budget ?? { taxRates, spendingAllocations: spending }),
                  status: action === "table" ? "tabled" : "draft",
                  taxRates,
                  spendingAllocations: spending,
                },
              }
            : d
        );
      } finally {
        setBusy(false);
      }
    },
    [endpoint, taxRates, spending]
  );

  if (!data) return null;

  if (!data.isChancellor) {
    return (
      <div className="rounded-2xl border border-card-border bg-card p-6 shadow-card">
        <h3 className="text-caption font-semibold uppercase tracking-wider text-muted">
          Budget {data.fiscalYear}
        </h3>
        <p className="mt-2 text-body-sm text-muted">
          Only the Chancellor of the Exchequer sets the Budget.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-card-border bg-card p-6 shadow-card space-y-5">
      <div className="flex items-baseline justify-between">
        <h3 className="text-caption font-semibold uppercase tracking-wider text-muted">
          Budget {data.fiscalYear}
        </h3>
        <span className="text-body-sm text-muted capitalize">{data.budget?.status ?? "new"}</span>
      </div>

      <div>
        <h4 className="mb-2 text-body-sm font-medium text-foreground">Tax levers</h4>
        <div className="space-y-2">
          {data.taxLevers.map((lever) => (
            <label key={lever.id} className="flex items-center justify-between gap-3 text-body-sm">
              <span className="text-muted">{lever.label}</span>
              <span className="flex items-center gap-1">
                <input
                  type="number"
                  disabled={Boolean(locked)}
                  value={taxRates[lever.id] ?? ""}
                  onChange={(e) =>
                    setTaxRates((r) => ({ ...r, [lever.id]: Number(e.target.value) }))
                  }
                  className="w-16 rounded border border-card-border bg-card-muted px-2 py-1 text-right text-foreground disabled:opacity-50"
                />
                <span className="text-muted">%</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <h4 className="text-body-sm font-medium text-foreground">Departmental spending</h4>
          <span
            className="text-body-sm font-medium"
            style={{ color: balanced ? "#16a34a" : "#dc2626" }}
          >
            {spendingTotal.toFixed(0)} / 100
          </span>
        </div>
        <div className="space-y-2">
          {data.spendingCategories.map((cat) => (
            <label key={cat} className="flex items-center justify-between gap-3 text-body-sm">
              <span className="capitalize text-muted">{cat}</span>
              <span className="flex items-center gap-1">
                <input
                  type="number"
                  disabled={Boolean(locked)}
                  value={spending[cat] ?? ""}
                  onChange={(e) => setSpending((s) => ({ ...s, [cat]: Number(e.target.value) }))}
                  className="w-16 rounded border border-card-border bg-card-muted px-2 py-1 text-right text-foreground disabled:opacity-50"
                />
                <span className="text-muted">%</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {error ? <p className="text-body-sm text-danger">{error}</p> : null}

      {locked ? (
        <p className="text-body-sm text-muted">
          The Budget has been tabled before the Commons and can no longer be edited.
        </p>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => submit("save")}
            className="rounded border border-card-border px-3 py-1.5 text-body-sm text-muted hover:text-foreground disabled:opacity-50"
          >
            Save draft
          </button>
          <button
            type="button"
            disabled={busy || !balanced}
            onClick={() => submit("table")}
            className="rounded border border-foreground bg-foreground px-3 py-1.5 text-body-sm text-background disabled:opacity-50"
            title={balanced ? "Table the Budget for the Commons" : "Spending must sum to 100%"}
          >
            Table Budget
          </button>
        </div>
      )}
    </div>
  );
}
