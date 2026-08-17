"use client";

import { useEffect, useState } from "react";
import { Slider } from "@/components/ui";
import { approvalTarget, duesIncomePerTurn, maxDuesForWage } from "@/lib/unions/unionDues";
import type { UnionServiceId } from "@/lib/unions/unionServices";

interface UnionDuesPanelProps {
  unionId: string;
  members: number;
  duesPerWorkerAnnual: number;
  /** Member-weighted average annual wage across this union's sectors. 0 = not known yet. */
  annualWage: number;
  activeServices: readonly UnionServiceId[];
  /** Only the union head may change dues; everyone else sees the read-only summary. */
  isHead: boolean;
  suspended: boolean;
  onSaved: () => void;
}

/**
 * Union dues v1's main lever: the annual charge per member the head sets.
 * Bounded by `maxDuesForWage`, the same 10%-of-wage ceiling the server
 * enforces, so a head can never drag the slider into a value the API will
 * reject. Shows the trade-off live: dues income per turn against what raising
 * the rate does to approval, rather than hiding either behind a tooltip.
 */
export function UnionDuesPanel({
  unionId,
  members,
  duesPerWorkerAnnual,
  annualWage,
  activeServices,
  isHead,
  suspended,
  onSaved,
}: UnionDuesPanelProps) {
  const [draft, setDraft] = useState(duesPerWorkerAnnual);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setDraft(duesPerWorkerAnnual);
  }, [duesPerWorkerAnnual]);

  const wageKnown = annualWage > 0;
  const maxDues = Math.round(maxDuesForWage(annualWage));
  const currentIncome = duesIncomePerTurn(members, duesPerWorkerAnnual);
  const draftIncome = duesIncomePerTurn(members, draft);
  const currentApprovalTarget = approvalTarget({
    duesPerWorkerAnnual,
    annualWage,
    activeServices,
  });
  const draftApprovalTarget = approvalTarget({
    duesPerWorkerAnnual: draft,
    annualWage,
    activeServices,
  });
  const approvalDelta = Math.round((draftApprovalTarget - currentApprovalTarget) * 10) / 10;
  const dirty = draft !== duesPerWorkerAnnual;

  async function handleSave() {
    setSaving(true);
    setResult(null);
    try {
      const res = await fetch(`/api/unions/${unionId}/dues`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duesPerWorkerAnnual: draft }),
      });
      const data = await res.json();
      setResult({
        ok: res.ok,
        text: res.ok ? "Dues updated." : (data.error ?? "Failed to update dues."),
      });
      if (res.ok) onSaved();
    } catch {
      setResult({ ok: false, text: "Network error. Dues were not changed." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">Dues</h3>
        <span className="text-xs text-muted tabular-nums">
          {Math.round(duesPerWorkerAnnual).toLocaleString("en-US")}/member/year
        </span>
      </div>

      {!isHead ? (
        <p className="text-sm text-muted">
          Members pay {Math.round(duesPerWorkerAnnual).toLocaleString("en-US")} a year each,
          bringing in about {Math.round(currentIncome).toLocaleString("en-US")} a turn.
        </p>
      ) : !wageKnown ? (
        <p className="text-sm text-muted">
          Waiting on wage data from this union&apos;s sectors before dues can be set.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted">
            What each member pays a year. Raising it brings in more per turn, and costs approval:
            members judge the bargain, not the number on its own.
          </p>
          <div className="space-y-1.5">
            <Slider
              min={0}
              max={maxDues}
              step={Math.max(1, Math.round(maxDues / 200))}
              value={draft}
              onChange={(e) => setDraft(Number(e.target.value))}
              disabled={saving || suspended}
              aria-label="Annual dues per member"
            />
            <div className="flex justify-between text-[11px] text-muted">
              <span>0</span>
              <span>Max {maxDues.toLocaleString("en-US")}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <div>
              <span className="text-muted">Dues rate:</span>{" "}
              <span className="font-semibold tabular-nums">
                {Math.round(draft).toLocaleString("en-US")}/year
              </span>
            </div>
            <div>
              <span className="text-muted">Income per turn at this rate:</span>{" "}
              <span className="font-semibold tabular-nums">
                {Math.round(draftIncome).toLocaleString("en-US")}
              </span>
            </div>
            <div>
              <span className="text-muted">Approval effect:</span>{" "}
              <span
                className={`font-semibold tabular-nums ${
                  approvalDelta < 0 ? "text-error" : approvalDelta > 0 ? "text-success" : ""
                }`}
              >
                {approvalDelta === 0 ? "None" : `${approvalDelta > 0 ? "+" : ""}${approvalDelta}`}
              </span>
            </div>
          </div>
          <button
            type="button"
            disabled={saving || suspended || !dirty}
            onClick={handleSave}
            className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-primary/90 active:scale-95 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Set Dues"}
          </button>
        </>
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
