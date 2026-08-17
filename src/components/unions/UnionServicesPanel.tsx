"use client";

import { useEffect, useState } from "react";
import { duesIncomePerTurn, servicesCostPerTurn } from "@/lib/unions/unionDues";
import { UNION_SERVICES, normalizeServiceIds, type UnionServiceId } from "@/lib/unions/unionServices";

interface UnionServicesPanelProps {
  unionId: string;
  members: number;
  /** Member-weighted average annual wage across this union's sectors. 0 = not known yet. */
  annualWage: number;
  treasury: number;
  duesPerWorkerAnnual: number;
  activeServices: readonly UnionServiceId[];
  /** Only the union head may toggle services; everyone else sees the read-only list. */
  isHead: boolean;
  suspended: boolean;
  onSaved: () => void;
}

function sortedIds(ids: readonly UnionServiceId[]): string {
  return [...ids].sort().join(",");
}

/**
 * The four service tiers from `UNION_SERVICES`, toggled on and paid for out of
 * the treasury every turn. Warns plainly when the slate the head is about to
 * save costs more per turn than dues bring in, because an unfunded slate
 * lapses and stops paying approval rather than erroring loudly.
 */
export function UnionServicesPanel({
  unionId,
  members,
  annualWage,
  treasury,
  duesPerWorkerAnnual,
  activeServices,
  isHead,
  suspended,
  onSaved,
}: UnionServicesPanelProps) {
  const [draft, setDraft] = useState<UnionServiceId[]>(() => normalizeServiceIds(activeServices));
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setDraft(normalizeServiceIds(activeServices));
  }, [activeServices]);

  function toggle(id: UnionServiceId) {
    setDraft((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const committed = normalizeServiceIds(activeServices);
  const activeSet = new Set(isHead ? draft : committed);
  const draftCostPerTurn = servicesCostPerTurn(members, annualWage, draft);
  const duesIncome = duesIncomePerTurn(members, duesPerWorkerAnnual);
  const unfunded = draftCostPerTurn > duesIncome;
  const dirty = sortedIds(draft) !== sortedIds(committed);

  async function handleSave() {
    setSaving(true);
    setResult(null);
    try {
      const res = await fetch(`/api/unions/${unionId}/services`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeServices: draft }),
      });
      const data = await res.json();
      setResult({
        ok: res.ok,
        text: res.ok ? "Services updated." : (data.error ?? "Failed to update services."),
      });
      if (res.ok) onSaved();
    } catch {
      setResult({ ok: false, text: "Network error. Services were not changed." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">Services</h3>
        <span className="text-xs text-muted tabular-nums">
          {activeSet.size} of {UNION_SERVICES.length} running
        </span>
      </div>
      <p className="text-sm text-muted">
        Programmes the union runs out of its treasury every turn. Each one raises approval while
        it is funded; if the treasury can&apos;t cover the bill, it lapses and stops paying
        approval.
      </p>

      <ul className="divide-y divide-card-border rounded-lg border border-card-border">
        {UNION_SERVICES.map((service) => {
          const on = activeSet.has(service.id);
          const costPerTurn = servicesCostPerTurn(members, annualWage, [service.id]);
          return (
            <li key={service.id} className="flex items-start justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{service.name}</p>
                <p className="text-xs text-muted">{service.description}</p>
                <p className="mt-1 text-[11px] text-muted">
                  Costs {Math.round(costPerTurn).toLocaleString("en-US")}/turn · +
                  {service.approvalBonus} approval while funded
                </p>
              </div>
              {isHead ? (
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={`${service.name}${on ? ", on" : ", off"}`}
                  disabled={saving || suspended}
                  onClick={() => toggle(service.id)}
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
                    on
                      ? "bg-primary text-white"
                      : "border border-card-border text-muted hover:bg-card-elevated"
                  }`}
                >
                  {on ? "On" : "Off"}
                </button>
              ) : (
                <span
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                    on ? "bg-primary/15 text-primary" : "text-muted"
                  }`}
                >
                  {on ? "Running" : "Off"}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap gap-4 text-sm">
        <div>
          <span className="text-muted">Combined cost per turn:</span>{" "}
          <span className="font-semibold tabular-nums">
            {Math.round(draftCostPerTurn).toLocaleString("en-US")}
          </span>
        </div>
        <div>
          <span className="text-muted">Dues income per turn:</span>{" "}
          <span className="font-semibold tabular-nums">
            {Math.round(duesIncome).toLocaleString("en-US")}
          </span>
        </div>
        <div>
          <span className="text-muted">Treasury:</span>{" "}
          <span className="font-semibold tabular-nums">
            {Math.round(treasury).toLocaleString("en-US")}
          </span>
        </div>
      </div>

      {unfunded && (
        <p className="text-xs font-medium text-warning">
          This slate costs more per turn than dues bring in. Unfunded services lapse and stop
          paying approval.
        </p>
      )}

      {isHead && (
        <button
          type="button"
          disabled={saving || suspended || !dirty}
          onClick={handleSave}
          className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-primary/90 active:scale-95 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save Services"}
        </button>
      )}

      {result && (
        <p
          role={result.ok ? "status" : "alert"}
          className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${
            result.ok
              ? "border-success/30 bg-success/10 text-success"
              : "border-error/30 bg-error/10 text-error"
          }`}
        >
          <span aria-hidden>{result.ok ? "✓" : "⚠"}</span>
          <span>{result.text}</span>
        </p>
      )}
    </div>
  );
}
