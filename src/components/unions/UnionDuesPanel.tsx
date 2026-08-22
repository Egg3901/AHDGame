"use client";

import { useEffect, useState } from "react";
import { Slider } from "@/components/ui";
import {
  COUNTRY_CURRENCY_MAP,
  CURRENCY_SYMBOLS,
  type CurrencyCode,
} from "@/lib/constants/currencies";
import {
  approvalTarget,
  duesIncomePerTurn,
  MAX_DUES_FRACTION_OF_WAGE,
  maxDuesForWage,
} from "@/lib/unions/unionDues";
import type { UnionServiceId } from "@/lib/unions/unionServices";

interface UnionDuesPanelProps {
  unionId: string;
  /** Country the union operates in; used to label money figures with the local currency. */
  countryId: string;
  members: number;
  duesPerWorkerAnnual: number;
  /** Member-weighted average annual wage across this union's sectors. 0 = not known yet. */
  annualWage: number;
  activeServices: readonly UnionServiceId[];
  /** Current political contribution rate, so the approval preview matches the engine. */
  politicalContributionPct?: number;
  /** Only the union head may change dues; everyone else sees the read-only summary. */
  isHead: boolean;
  suspended: boolean;
  onSaved: () => void;
}

/**
 * Union dues v1's main lever: what each member pays, set as a SHARE OF THEIR
 * ANNUAL WAGE rather than as a cash figure.
 *
 * The cash slider it replaces was unusable in practice. A member's annual wage
 * in this economy is single digits, so the 10% ceiling came out near 1, and the
 * control rounded both its range and its readout to whole units: the whole
 * usable band collapsed onto "0" or "1" and the head had no way to pick a rate
 * (player ticket #1112). A percentage is also what the model itself reasons in,
 * `duesBurdenRatio` divides the rate by the wage before approval ever sees it,
 * so the same slider position means the same thing in every country and era,
 * which is the property `unionServices.ts` documents as the whole reason costs
 * are fractions there too.
 *
 * The cash equivalent is shown alongside, and the request still sends an
 * absolute `duesPerWorkerAnnual`, so the API and its clamp are unchanged.
 */
/**
 * Money in this economy runs to single digits per member per year, so a whole
 * number readout hides the entire dues range. Show enough precision to tell two
 * rates apart, and drop it again once the figure is large.
 */
function money(value: number, currency: CurrencyCode): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? "$";
  const abs = Math.abs(value);
  const decimals = abs === 0 ? 0 : abs < 10 ? 2 : 0;
  return `${symbol}${value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

export function UnionDuesPanel({
  unionId,
  countryId,
  members,
  duesPerWorkerAnnual,
  annualWage,
  activeServices,
  politicalContributionPct = 0,
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

  const currency = (COUNTRY_CURRENCY_MAP[countryId as keyof typeof COUNTRY_CURRENCY_MAP] ??
    "USD") as CurrencyCode;
  /** Money reads as money: currency symbol, with cents kept while the figure is small. */
  const cash = (value: number) => money(value, currency);
  const wageKnown = annualWage > 0;
  const maxDues = maxDuesForWage(annualWage);
  const maxPercent = MAX_DUES_FRACTION_OF_WAGE * 100;
  /** The draft rate as a share of annual wage, which is what the slider moves. */
  const draftPercent = wageKnown ? (draft / annualWage) * 100 : 0;
  // A persisted rate can exceed today's ceiling (wages fell after it was set),
  // so the slider widens rather than misrepresenting the stored value.
  const sliderMaxPercent = Math.max(maxPercent, draftPercent);
  const duesLocked = maxDues <= 0;
  const currentIncome = duesIncomePerTurn(members, duesPerWorkerAnnual);
  const draftIncome = duesIncomePerTurn(members, draft);
  const currentApprovalTarget = approvalTarget({
    duesPerWorkerAnnual,
    annualWage,
    activeServices,
    politicalContributionPct,
  });
  const draftApprovalTarget = approvalTarget({
    duesPerWorkerAnnual: draft,
    annualWage,
    activeServices,
    politicalContributionPct,
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
          {cash(duesPerWorkerAnnual)}/member/year
        </span>
      </div>

      {!isHead ? (
        <p className="text-sm text-muted">
          Members pay {cash(duesPerWorkerAnnual)} a year each, bringing in about{" "}
          {cash(currentIncome)} a turn.
        </p>
      ) : !wageKnown ? (
        <p className="text-sm text-muted">
          Waiting on wage data from this union&apos;s sectors before dues can be set.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted">
            What each member pays, as a share of their pay. Dues are the treasury&apos;s standing
            income, and the treasury is what funds services, organizing drives and bargaining.
            Raising the rate brings in more per turn and costs approval: members judge the bargain,
            not the number on its own.
          </p>
          <div className="space-y-1.5">
            <Slider
              min={0}
              max={sliderMaxPercent}
              step={0.1}
              value={draftPercent}
              onChange={(e) => setDraft((Number(e.target.value) / 100) * annualWage)}
              disabled={saving || suspended || duesLocked}
              aria-label="Annual dues as a percent of member wages"
            />
            <div className="flex justify-between text-[11px] text-muted">
              <span>0%</span>
              <span>Max {maxPercent}% of wages</span>
            </div>
            {duesLocked && (
              <p className="text-[11px] text-muted">
                Dues cannot be set until the union represents a paid workforce.
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <div>
              <span className="text-muted">Dues rate:</span>{" "}
              <span className="font-semibold tabular-nums">
                {draftPercent.toFixed(1)}% of wages
              </span>{" "}
              <span className="text-muted tabular-nums">({cash(draft)}/member/year)</span>
            </div>
            <div>
              <span className="text-muted">Income per turn at this rate:</span>{" "}
              <span className="font-semibold tabular-nums">{cash(draftIncome)}</span>
            </div>
            <div>
              <span className="text-muted">Change from dues edit:</span>{" "}
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
