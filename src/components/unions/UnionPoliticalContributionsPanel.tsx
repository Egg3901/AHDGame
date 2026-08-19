"use client";

import { useEffect, useState } from "react";
import { Slider } from "@/components/ui";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import { formatLocalAmountFull } from "@/lib/utils/formatters";
import { approvalTarget, duesIncomePerTurn, servicesCostPerTurn } from "@/lib/unions/unionDues";
import type { UnionServiceId } from "@/lib/unions/unionServices";
import {
  MAX_POLITICAL_CONTRIBUTION_APPROVAL_PENALTY,
  MAX_POLITICAL_CONTRIBUTION_OF_FCF,
  clampPoliticalContributionPct,
  freeCashFlowPerTurn,
  politicalContributionPerTurn,
} from "@/lib/unions/unionPoliticalContributions";

interface UnionPoliticalContributionsPanelProps {
  unionId: string;
  countryId: string;
  members: number;
  duesPerWorkerAnnual: number;
  annualWage: number;
  activeServices: readonly UnionServiceId[];
  politicalContributionPct: number;
  /** This viewer's share of union influence, 0-100. Used to preview their cut. */
  myInfluencePct: number;
  isHead: boolean;
  suspended: boolean;
  onSaved: () => void;
}

/**
 * Head-set share of remaining per-turn budget sent to organizers as campaign
 * funds. Remaining budget is dues income minus the service bill, capped at
 * 50% of that free cash flow. Everyone can see the rate; only the head moves
 * the slider.
 */
export function UnionPoliticalContributionsPanel({
  unionId,
  countryId,
  members,
  duesPerWorkerAnnual,
  annualWage,
  activeServices,
  politicalContributionPct,
  myInfluencePct,
  isHead,
  suspended,
  onSaved,
}: UnionPoliticalContributionsPanelProps) {
  const committed = clampPoliticalContributionPct(politicalContributionPct);
  const [draftPct, setDraftPct] = useState(committed);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setDraftPct(clampPoliticalContributionPct(politicalContributionPct));
  }, [politicalContributionPct]);

  const currency = (COUNTRY_CURRENCY_MAP[countryId as keyof typeof COUNTRY_CURRENCY_MAP] ??
    "USD") as CurrencyCode;
  const cash = (value: number) => formatLocalAmountFull(value, currency);

  const duesIncome = duesIncomePerTurn(members, duesPerWorkerAnnual);
  const servicesCost = servicesCostPerTurn(members, annualWage, activeServices);
  const freeCashFlow = freeCashFlowPerTurn(duesIncome, servicesCost);
  const draftPayout = politicalContributionPerTurn(freeCashFlow, draftPct);
  const committedPayout = politicalContributionPerTurn(freeCashFlow, committed);
  const myShare = draftPayout * (Math.max(0, myInfluencePct) / 100);
  const currentApproval = approvalTarget({
    duesPerWorkerAnnual,
    annualWage,
    activeServices,
    politicalContributionPct: committed,
  });
  const draftApproval = approvalTarget({
    duesPerWorkerAnnual,
    annualWage,
    activeServices,
    politicalContributionPct: draftPct,
  });
  const approvalDelta = Math.round((draftApproval - currentApproval) * 10) / 10;
  const capPercent = MAX_POLITICAL_CONTRIBUTION_OF_FCF * 100;
  const draftPercent = draftPct * 100;
  const dirty = draftPct !== committed;

  async function handleSave() {
    setSaving(true);
    setResult(null);
    try {
      const res = await fetch(`/api/unions/${unionId}/political-contributions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ politicalContributionPct: draftPct }),
      });
      const data = await res.json();
      setResult({
        ok: res.ok,
        text: res.ok
          ? "Political contributions updated."
          : (data.error ?? "Failed to update political contributions."),
      });
      if (res.ok) onSaved();
    } catch {
      setResult({
        ok: false,
        text: "Network error. Political contributions were not changed.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">Political contributions</h3>
        <span className="text-xs text-muted tabular-nums">
          {(committed * 100).toFixed(0)}% of remaining budget
        </span>
      </div>

      {!isHead ? (
        <p className="text-sm text-muted">
          {committed <= 0
            ? "This union is not sending political contributions."
            : `This union sends ${(committed * 100).toFixed(0)}% of remaining budget to organizers each turn (${cash(committedPayout)}/turn). Your influence is ${myInfluencePct.toFixed(1)}%, so your share is ${cash(committedPayout * (Math.max(0, myInfluencePct) / 100))}.`}
        </p>
      ) : (
        <>
          <p className="text-sm text-muted">
            A share of this turn&apos;s remaining budget (dues minus services), paid to organizers
            as campaign funds in proportion to their influence. Capped at {capPercent}% of free cash
            flow. Members dislike dues spent on politics: at the cap, approval falls by{" "}
            {MAX_POLITICAL_CONTRIBUTION_APPROVAL_PENALTY} points.
          </p>
          <div className="space-y-1.5">
            <Slider
              min={0}
              max={capPercent}
              step={1}
              value={draftPercent}
              onChange={(e) => setDraftPct(Number(e.target.value) / 100)}
              disabled={saving || suspended}
              aria-label="Political contributions as a percent of remaining budget"
            />
            <div className="flex justify-between text-[11px] text-muted">
              <span>0%</span>
              <span>Max {capPercent}% of remaining budget</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <div>
              <span className="text-muted">Remaining budget per turn:</span>{" "}
              <span className="font-semibold tabular-nums">{cash(freeCashFlow)}</span>
            </div>
            <div>
              <span className="text-muted">Payout per turn:</span>{" "}
              <span className="font-semibold tabular-nums">{cash(draftPayout)}</span>
            </div>
            <div>
              <span className="text-muted">Your share:</span>{" "}
              <span className="font-semibold tabular-nums">{cash(myShare)}</span>
              <span className="text-muted"> ({myInfluencePct.toFixed(1)}% influence)</span>
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
            {saving ? "Saving…" : "Set Political Contributions"}
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
