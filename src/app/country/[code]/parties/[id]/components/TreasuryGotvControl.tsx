import { Slider } from "@/components/ui";
import { contrastTextColor } from "@/lib/utils/colorContrast";
import {
  DOLLARS_PER_TURNOUT_POINT,
  calculateAlignmentMultiplier,
  getTargetableDemographics,
  getTargetableCategories,
  getCategoryLabels,
  getDemographicLabels,
} from "@/lib/utils/demographicAlignment";
import type { PartyData } from "./types";
import type { TreasuryAction } from "./treasuryReducer";
import { fmt } from "./helpers";

interface TreasuryGotvControlProps {
  party: PartyData;
  countryId: string;
  gotvForm: { percent: number; category: string; group: string; saving: boolean };
  dispatch: (action: TreasuryAction) => void;
  onSave: () => void;
}

export function TreasuryGotvControl({
  party,
  countryId,
  gotvForm,
  dispatch,
  onSave,
}: TreasuryGotvControlProps) {
  const targetableDemos = getTargetableDemographics(countryId);
  const targetableCategories = getTargetableCategories(countryId);
  const categoryLabels = getCategoryLabels(countryId);
  const demoLabels = getDemographicLabels(countryId);

  const gotvSpend = Math.floor(party.expectedHourlyIncome * (gotvForm.percent / 100));
  const selectedGotvDemo =
    gotvForm.category && gotvForm.group
      ? targetableDemos.find((d) => d.category === gotvForm.category && d.group === gotvForm.group)
      : null;
  const gotvAlignMult = selectedGotvDemo
    ? calculateAlignmentMultiplier(
        party.economicPosition,
        party.socialPosition,
        selectedGotvDemo.economicLean,
        selectedGotvDemo.socialLean
      )
    : 0;
  const gotvRawPerState = gotvSpend / 51;
  const gotvEstBoost = selectedGotvDemo
    ? (gotvRawPerState / DOLLARS_PER_TURNOUT_POINT) * gotvAlignMult
    : 0;
  const gotvDirty =
    gotvForm.percent !== party.gotvBudgetPercent ||
    gotvForm.category !== (party.gotvTargetCategory ?? "") ||
    gotvForm.group !== (party.gotvTargetGroup ?? "");
  const gotvNeedsTarget = gotvForm.percent > 0 && (!gotvForm.category || !gotvForm.group);
  const groupsForGotvCat = targetableDemos.filter((d) => d.category === gotvForm.category);

  return (
    <div className="px-6 py-5 border-b border-card-border/40 border-l-[3px] border-l-primary/40">
      <div className="flex items-center gap-2 mb-1">
        <svg
          className="h-4 w-4 text-primary"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"
          />
        </svg>
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">
          GOTV — Get Out the Vote
        </div>
      </div>
      <p className="text-[11px] text-muted/60 mb-3 ml-6">
        Nationwide voter mobilization. Spending is divided equally across all 51 state parties.
      </p>

      <div className="flex items-center gap-4">
        <Slider
          min={0}
          max={25}
          value={gotvForm.percent}
          onChange={(e) =>
            dispatch({
              type: "SET_GOTV",
              field: "percent",
              value: parseInt(e.target.value),
            })
          }
          variant="primary"
          className="flex-1 max-w-48"
        />
        <span className="text-lg font-bold tabular-nums w-12 text-right">{gotvForm.percent}%</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={gotvForm.category}
          onChange={(e) => {
            dispatch({ type: "SET_GOTV", field: "category", value: e.target.value });
            dispatch({ type: "SET_GOTV", field: "group", value: "" });
          }}
          className="rounded-lg border border-card-border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">Category…</option>
          {targetableCategories.map((cat) => (
            <option key={cat} value={cat}>
              {categoryLabels[cat] ?? cat}
            </option>
          ))}
        </select>
        <select
          value={gotvForm.group}
          onChange={(e) => dispatch({ type: "SET_GOTV", field: "group", value: e.target.value })}
          disabled={!gotvForm.category}
          className="rounded-lg border border-card-border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-40"
        >
          <option value="">Demographic…</option>
          {groupsForGotvCat.map((d) => (
            <option key={d.group} value={d.group}>
              {demoLabels[d.group] ?? d.group}
            </option>
          ))}
        </select>
        {gotvDirty && (
          <button
            onClick={onSave}
            disabled={gotvForm.saving || gotvNeedsTarget}
            className="rounded-lg px-4 py-1.5 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
            style={{ backgroundColor: party.color, color: contrastTextColor(party.color) }}
          >
            {gotvForm.saving ? "Saving…" : "Save"}
          </button>
        )}
      </div>

      {gotvNeedsTarget && (
        <p className="mt-2 text-xs text-error flex items-center gap-1.5 ml-6">
          <svg
            className="h-3 w-3 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          Select a target demographic to activate GOTV spending
        </p>
      )}
      {gotvForm.percent > 0 && selectedGotvDemo && (
        <div className="mt-3 ml-6 rounded-lg bg-background/50 border border-card-border/30 p-3 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted">Total spending</span>
            <span className="font-semibold tabular-nums">
              {fmt(gotvSpend, party.countryId)} / hr
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted">Per state (51)</span>
            <span className="font-medium tabular-nums text-muted">
              {fmt(gotvRawPerState, party.countryId)} / hr
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted">Alignment efficacy</span>
            <span
              className={`font-semibold tabular-nums ${gotvAlignMult >= 0.5 ? "text-success" : "text-warning"}`}
            >
              {Math.round(gotvAlignMult * 100)}%
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted">Est. boost / state</span>
            <span className="font-bold tabular-nums text-success">
              +{gotvEstBoost.toFixed(3)}% / turn
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
