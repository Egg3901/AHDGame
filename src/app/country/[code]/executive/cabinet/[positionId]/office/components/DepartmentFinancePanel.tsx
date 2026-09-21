"use client";

import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/contexts/ToastContext";
import type { DepartmentFinanceReadModel } from "@/lib/governmentFinance/readModel";
import { DepartmentProgramPanel } from "./DepartmentProgramPanel";

function money(value: number, symbol: string): string {
  return `${symbol}${Math.round(value).toLocaleString()}`;
}

export function DepartmentFinancePanel({
  department,
  currencySymbol,
  canAct = false,
  countryCode,
  positionId,
  currentTurn,
  onUpdate,
}: {
  department: DepartmentFinanceReadModel;
  currencySymbol: string;
  canAct?: boolean;
  countryCode?: string;
  positionId?: string;
  currentTurn?: number;
  onUpdate?: () => void | Promise<void>;
}) {
  const { showToast } = useToast();
  const allocatablePrograms = useMemo(
    () =>
      department.programs.filter(
        (program) =>
          program.programId && (program.status === "authorized" || program.status === "operating")
      ),
    [department.programs]
  );
  const defaultShare = allocatablePrograms.length > 0 ? 100 / allocatablePrograms.length : 0;
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setAllocations(
      Object.fromEntries(
        allocatablePrograms.map((program) => [
          program.programId!,
          program.allocationPercent ?? defaultShare,
        ])
      )
    );
  }, [allocatablePrograms, defaultShare]);
  const allocationTotal = Object.values(allocations).reduce((sum, value) => sum + value, 0);
  const allocationLocked =
    currentTurn !== undefined && department.lastAllocationChangedTurn === currentTurn;

  async function saveAllocations() {
    if (!countryCode || !positionId) return;
    if (Math.abs(allocationTotal - 100) > 0.1) {
      showToast(
        `Program allocations must total 100%. Current total: ${allocationTotal.toFixed(1)}%.`,
        "error"
      );
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(
        `/api/country/${countryCode}/executive/cabinet/${positionId}/department-allocation`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            departmentId: department.departmentId,
            programAllocationPercents: allocations,
          }),
        }
      );
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        showToast(body.error ?? "Failed to update program allocations.", "error");
        return;
      }
      showToast("Department program allocations updated.", "success");
      await onUpdate?.();
    } catch {
      showToast("Network error. Please try again.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-card-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Department account</p>
            <h2 className="text-lg font-semibold">{department.departmentName}</h2>
          </div>
          <span className="rounded-full border border-card-border px-3 py-1 text-xs font-semibold uppercase">
            {department.kind.replaceAll("_", " ")}
          </span>
        </div>
        <p className="mt-3 text-sm text-muted">{department.explanation}</p>
        {department.balance !== undefined && (
          <dl className="mt-4 grid gap-x-5 gap-y-3 border-t border-card-border pt-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted">Account balance</dt>
              <dd>{money(department.balance, currencySymbol)}</dd>
            </div>
            <div>
              <dt className="text-muted">Available</dt>
              <dd>{money(department.availableBalance ?? 0, currencySymbol)}</dd>
            </div>
            <div>
              <dt className="text-muted">Encumbered</dt>
              <dd>{money(department.encumbered ?? 0, currencySymbol)}</dd>
            </div>
            <div>
              <dt className="text-muted">Arrears</dt>
              <dd>{money(department.arrears ?? 0, currencySymbol)}</dd>
            </div>
          </dl>
        )}
      </section>

      {allocatablePrograms.length > 0 && (
        <section className="rounded-lg border border-card-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">Program allocation</h3>
              <p className="mt-1 text-sm text-muted">
                Set the department&apos;s emphasis when same-tier program claims exceed available
                funds. Existing commitments and arrears are paid first.
              </p>
            </div>
            <span
              className={
                Math.abs(allocationTotal - 100) <= 0.1 ? "text-sm text-muted" : "text-sm text-error"
              }
            >
              {allocationTotal.toFixed(1)}%
            </span>
          </div>
          <div className="mt-4 space-y-3">
            {allocatablePrograms.map((program) => (
              <label
                key={program.programId}
                className="flex items-center justify-between gap-4 text-sm"
              >
                <span>{program.programName}</span>
                <span className="flex items-center gap-2">
                  <input
                    className="w-24 rounded-md border border-card-border bg-background px-2 py-1 text-right"
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={allocations[program.programId!] ?? 0}
                    disabled={!canAct || allocationLocked || saving}
                    onChange={(event) =>
                      setAllocations((current) => ({
                        ...current,
                        [program.programId!]: Number(event.target.value),
                      }))
                    }
                  />
                  <span className="text-muted">%</span>
                </span>
              </label>
            ))}
          </div>
          {canAct && (
            <button
              type="button"
              className="mt-4 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              disabled={allocationLocked || saving || Math.abs(allocationTotal - 100) > 0.1}
              onClick={saveAllocations}
            >
              {allocationLocked ? "Updated this turn" : saving ? "Saving..." : "Save allocation"}
            </button>
          )}
        </section>
      )}

      {department.programs.map((program) => (
        <DepartmentProgramPanel
          key={`${department.departmentId}:${program.programName}`}
          program={program}
          currencySymbol={currencySymbol}
        />
      ))}
    </div>
  );
}
