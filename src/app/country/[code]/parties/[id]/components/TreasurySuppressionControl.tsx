import { Slider } from "@/components/ui";
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

interface TreasurySuppressionControlProps {
  party: PartyData;
  countryId: string;
  suppressionForm: { percent: number; category: string; group: string; saving: boolean };
  dispatch: (action: TreasuryAction) => void;
  onSave: () => void;
}

export function TreasurySuppressionControl({
  party,
  countryId,
  suppressionForm,
  dispatch,
  onSave,
}: TreasurySuppressionControlProps) {
  const targetableDemos = getTargetableDemographics(countryId);
  const targetableCategories = getTargetableCategories(countryId);
  const categoryLabels = getCategoryLabels(countryId);
  const demoLabels = getDemographicLabels(countryId);

  const supSpend = Math.floor(party.expectedHourlyIncome * (suppressionForm.percent / 100));
  const selectedSupDemo =
    suppressionForm.category && suppressionForm.group
      ? targetableDemos.find(
          (d) => d.category === suppressionForm.category && d.group === suppressionForm.group
        )
      : null;
  const supAlignMult = selectedSupDemo
    ? calculateAlignmentMultiplier(
        party.economicPosition,
        party.socialPosition,
        selectedSupDemo.economicLean,
        selectedSupDemo.socialLean
      )
    : 0;
  const supRawPerState = supSpend / 51;
  const supEstBoost = selectedSupDemo
    ? (supRawPerState / DOLLARS_PER_TURNOUT_POINT) * supAlignMult
    : 0;
  const supDirty =
    suppressionForm.percent !== party.suppressionBudgetPercent ||
    suppressionForm.category !== (party.suppressionTargetCategory ?? "") ||
    suppressionForm.group !== (party.suppressionTargetGroup ?? "");
  const supNeedsTarget =
    suppressionForm.percent > 0 && (!suppressionForm.category || !suppressionForm.group);
  const groupsForSupCat = targetableDemos.filter((d) => d.category === suppressionForm.category);

  return (
    <div className="px-6 py-5 border-b border-card-border/40 border-l-[3px] border-l-error/40">
      <div className="flex items-center gap-2 mb-1">
        <svg
          className="h-4 w-4 text-error"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
          />
        </svg>
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">
          Voter Suppression
        </div>
      </div>
      <p className="text-[11px] text-muted/60 mb-3 ml-6">
        Nationwide dirty tricks. Suppress opponent turnout across all 51 state parties.
      </p>

      <div className="flex items-center gap-4">
        <Slider
          min={0}
          max={25}
          value={suppressionForm.percent}
          onChange={(e) =>
            dispatch({
              type: "SET_SUPPRESSION",
              field: "percent",
              value: parseInt(e.target.value),
            })
          }
          variant="error"
          className="flex-1 max-w-48"
        />
        <span className="text-lg font-bold tabular-nums w-12 text-right">
          {suppressionForm.percent}%
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={suppressionForm.category}
          onChange={(e) => {
            dispatch({
              type: "SET_SUPPRESSION",
              field: "category",
              value: e.target.value,
            });
            dispatch({ type: "SET_SUPPRESSION", field: "group", value: "" });
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
          value={suppressionForm.group}
          onChange={(e) =>
            dispatch({ type: "SET_SUPPRESSION", field: "group", value: e.target.value })
          }
          disabled={!suppressionForm.category}
          className="rounded-lg border border-card-border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-40"
        >
          <option value="">Demographic…</option>
          {groupsForSupCat.map((d) => (
            <option key={d.group} value={d.group}>
              {demoLabels[d.group] ?? d.group}
            </option>
          ))}
        </select>
        {supDirty && (
          <button
            onClick={onSave}
            disabled={suppressionForm.saving || supNeedsTarget}
            className="rounded-lg px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity bg-error"
          >
            {suppressionForm.saving ? "Saving…" : "Save"}
          </button>
        )}
      </div>

      {supNeedsTarget && (
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
          Select a target demographic to activate suppression spending
        </p>
      )}
      {suppressionForm.percent > 0 && selectedSupDemo && (
        <div className="mt-3 ml-6 rounded-lg bg-background/50 border border-card-border/30 p-3 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted">Total spending</span>
            <span className="font-semibold tabular-nums">
              {fmt(supSpend, party.countryId)} / hr
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted">Per state (51)</span>
            <span className="font-medium tabular-nums text-muted">
              {fmt(supRawPerState, party.countryId)} / hr
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted">Counter-alignment</span>
            <span
              className={`font-semibold tabular-nums ${supAlignMult >= 0.5 ? "text-error" : "text-warning"}`}
            >
              {Math.round(supAlignMult * 100)}%
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted">Est. reduction / state</span>
            <span className="font-bold tabular-nums text-error">
              -{supEstBoost.toFixed(3)}% / turn
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
