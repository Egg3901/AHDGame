"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CountryId } from "@/lib/constants/countries";
import {
  DEVOLUTION_POLICY_CHANGE_AP_COST,
  DEVOLUTION_POLICY_CHANGE_COOLDOWN_TURNS,
  MEAN_REVERSION_TARGET,
  PRO_INDY_BONUS_BAND_SIZE,
  PRO_INDY_BONUS_PER_BAND,
  PRO_INDY_BONUS_THRESHOLD,
  PRO_INDY_BONUS_TIER_COUNT,
  getDevolutionPolicyLabel,
  getIndependenceMetricLabel,
} from "@/lib/constants/devolution";
import type { DevolutionPolicy } from "@/lib/db/types/governorOfficeState";
import { ChangePolicyModal } from "./devolution/ChangePolicyModal";
import { ReferendumPanel, type ReferendumPanelData } from "./devolution/ReferendumPanel";

export interface DevolutionDriverSnapshot {
  drivers: {
    policy: number;
    regionalApproval: number;
    nationalApproval: number;
    inflation: number;
    meanReversion: number;
  };
  delta: number;
  next: number;
  inputs: {
    regionalApproval: number;
    nationalApproval: number;
    inflationPercent: number;
  };
}

interface Props {
  countryId: CountryId;
  stateId: string;
  stateName: string;
  currentValue: number;
  currentTrend: number;
  currentPolicy: DevolutionPolicy;
  policyChangedAtTurn: number | null;
  currentTurn: number;
  gubernatorialActions: number;
  /** Holder OR authorized party officer of an NPP-held office. Gates actions. */
  viewerCanManage: boolean;
  viewerIsAdmin: boolean;
  driverPreview: DevolutionDriverSnapshot;
  /** Current additive vote-share bonus the region's pro-indy party gets in
   *  every election here, derived from independenceDesire. 0 when desire < 60. */
  proIndyElectionBonus: number;
  /** Current/most-recent referendum + request eligibility for this region. */
  referendum: ReferendumPanelData;
}

const PRO_INDY_PARTY_LABEL: Record<string, string> = {
  SCO: "Scottish National Party",
  WAL: "Plaid Cymru",
  NIR: "Sinn Féin",
};

/** Build the tier strip from the constants so the UI stays in lockstep
 *  with the engine if the thresholds, step size, or band count are ever
 *  retuned. */
const PRO_INDY_BONUS_TIERS = Array.from({ length: PRO_INDY_BONUS_TIER_COUNT }, (_, i) => ({
  threshold: PRO_INDY_BONUS_THRESHOLD + i * PRO_INDY_BONUS_BAND_SIZE,
  bonusPct: (i + 1) * PRO_INDY_BONUS_PER_BAND * 100,
}));
const PRO_INDY_BONUS_MAX_PCT = PRO_INDY_BONUS_TIERS[PRO_INDY_BONUS_TIERS.length - 1].bonusPct;
const PRO_INDY_BONUS_FIRST_PCT = PRO_INDY_BONUS_TIERS[0].bonusPct;

const POLICY_OPTIONS: DevolutionPolicy[] = ["anti", "pro", "independence"];

const POLICY_BLURBS: Record<DevolutionPolicy, string> = {
  anti: "Defend the Union. There is no future in separation, and devolved powers should not expand further.",
  pro: "The current devolution settlement works. We govern locally, but the great national questions remain reserved.",
  independence:
    "Our nation deserves to chart its own course. Building the case for separation is the work of this Government.",
};

const POLICY_NIR_REUNIFICATION_BLURB =
  "The future of this island is its reunification. Working with partners north and south to make it inevitable.";

function fmt(n: number): string {
  const r = Math.round(n * 1000) / 1000;
  return r >= 0 ? `+${r.toFixed(3)}` : r.toFixed(3);
}

function trendArrow(trend: number): string {
  if (trend > 0.005) return "▲";
  if (trend < -0.005) return "▼";
  return "─";
}

export function DevolutionTab(props: Props) {
  const router = useRouter();
  const [modalMode, setModalMode] = useState<"normal" | "admin" | null>(null);
  const modalOpen = modalMode !== null;

  const metricLabel = getIndependenceMetricLabel(props.stateId);
  const cooldownReadyAt =
    props.policyChangedAtTurn != null
      ? props.policyChangedAtTurn + DEVOLUTION_POLICY_CHANGE_COOLDOWN_TURNS
      : null;
  const cooldownRemaining =
    cooldownReadyAt != null ? Math.max(0, cooldownReadyAt - props.currentTurn) : 0;
  const onCooldown = cooldownRemaining > 0;
  const apShort = props.gubernatorialActions < DEVOLUTION_POLICY_CHANGE_AP_COST;
  const canChange = props.viewerCanManage && !onCooldown && !apShort;

  const arrow = trendArrow(props.currentTrend);
  const arrowColor =
    props.currentTrend > 0.005
      ? "text-emerald-500"
      : props.currentTrend < -0.005
        ? "text-rose-500"
        : "text-muted";

  return (
    <div className="space-y-6">
      {/* Metric card */}
      <div className="rounded-xl border border-card-border bg-card p-6">
        <h2 className="text-sm uppercase tracking-widest text-muted">{metricLabel}</h2>
        <div className="mt-2 flex items-end gap-3">
          {/* Show 2 decimals so the deliberately-slow drift (~0.05/turn) is visible —
              a floored integer only ticks once every ~20 turns and reads as "stuck".
              Bonus-threshold alignment still holds: the election-bonus logic floors
              internally, so e.g. 59.70 is unambiguously below the 60 unlock. */}
          <div className="text-5xl font-bold tabular-nums">{props.currentValue.toFixed(2)}</div>
          <div className={`pb-2 text-3xl ${arrowColor}`}>{arrow}</div>
          <div className={`pb-2 text-base font-semibold tabular-nums ${arrowColor}`}>
            {fmt(props.currentTrend)}/turn
          </div>
        </div>
        <div className="mt-1 text-xs text-muted">
          0 = staunchly against · 50 = neutral · 100 = full separation/reunification
        </div>
        {/* Bar */}
        <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-card-border">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${Math.max(0, Math.min(100, props.currentValue))}%` }}
            aria-hidden
          />
        </div>
      </div>

      {/* Driver breakdown */}
      <div className="rounded-xl border border-card-border bg-card p-6">
        <h2 className="text-sm uppercase tracking-widest text-muted">Drift drivers (per turn)</h2>
        <ul className="mt-3 space-y-2 text-sm">
          <DriverRow
            label={`Your "${getDevolutionPolicyLabel(props.stateId, props.currentPolicy)}" policy`}
            value={props.driverPreview.drivers.policy}
          />
          <DriverRow
            label={`Regional approval ${props.driverPreview.inputs.regionalApproval.toFixed(0)}%`}
            value={props.driverPreview.drivers.regionalApproval}
          />
          <DriverRow
            label={`Westminster approval ${props.driverPreview.inputs.nationalApproval.toFixed(0)}%`}
            value={props.driverPreview.drivers.nationalApproval}
          />
          <DriverRow
            label={`UK inflation ${props.driverPreview.inputs.inflationPercent.toFixed(1)}%`}
            value={props.driverPreview.drivers.inflation}
          />
          <DriverRow
            label={`Mean reversion toward ${MEAN_REVERSION_TARGET}`}
            value={props.driverPreview.drivers.meanReversion}
          />
        </ul>
        <div className="mt-4 flex justify-between border-t border-card-border pt-3 text-sm font-medium">
          <span>Net drift next turn</span>
          <span className={`tabular-nums ${arrowColor}`}>{fmt(props.driverPreview.delta)}</span>
        </div>
      </div>

      {/* Pro-indy election bonus */}
      <div className="rounded-xl border border-card-border bg-card p-6">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm uppercase tracking-widest text-muted">Election bonus</h2>
          <div className="text-xs text-muted">
            Active at {PRO_INDY_BONUS_THRESHOLD}+ · steps every {PRO_INDY_BONUS_BAND_SIZE}pp ·
            capped at +{PRO_INDY_BONUS_MAX_PCT}%
          </div>
        </div>
        {props.proIndyElectionBonus > 0 ? (
          <div className="mt-3 flex items-end gap-3">
            <div className="text-3xl font-bold tabular-nums text-emerald-500">
              +{(props.proIndyElectionBonus * 100).toFixed(1)}%
            </div>
            <div className="pb-1 text-sm text-muted">
              vote bonus to{" "}
              <span className="font-medium text-foreground/90">
                {PRO_INDY_PARTY_LABEL[props.stateId.toUpperCase()] ?? "the pro-indy party"}
              </span>{" "}
              in every {props.stateName} election (additive — does not penalise rivals).
            </div>
          </div>
        ) : (
          <div className="mt-3 text-sm text-muted">
            No bonus active — {getIndependenceMetricLabel(props.stateId).toLowerCase()} would need
            to reach {PRO_INDY_BONUS_THRESHOLD} to unlock +{PRO_INDY_BONUS_FIRST_PCT}%.
          </div>
        )}
        <ul
          className="mt-4 grid gap-2 text-center text-xs"
          style={{
            gridTemplateColumns: `repeat(${PRO_INDY_BONUS_TIER_COUNT}, minmax(0, 1fr))`,
          }}
        >
          {PRO_INDY_BONUS_TIERS.map((tier) => {
            const active = props.currentValue >= tier.threshold;
            return (
              <li
                key={tier.threshold}
                className={`rounded-md border px-2 py-2 ${
                  active
                    ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-500"
                    : "border-card-border bg-background/40 text-muted"
                }`}
              >
                <div className="font-semibold tabular-nums">≥{tier.threshold}</div>
                <div className="tabular-nums">+{tier.bonusPct.toFixed(1)}%</div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Policy selector */}
      <div className="rounded-xl border border-card-border bg-card p-6">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm uppercase tracking-widest text-muted">Devolution Policy</h2>
          <div className="text-xs text-muted">
            {DEVOLUTION_POLICY_CHANGE_AP_COST} AP · {DEVOLUTION_POLICY_CHANGE_COOLDOWN_TURNS}-turn
            cooldown
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {POLICY_OPTIONS.map((policy) => {
            const isCurrent = policy === props.currentPolicy;
            return (
              <div
                key={policy}
                className={`flex flex-col rounded-lg border p-4 ${
                  isCurrent ? "border-primary bg-primary/5" : "border-card-border bg-background/50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">
                    {getDevolutionPolicyLabel(props.stateId, policy)}
                  </span>
                  {isCurrent && (
                    <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase text-white">
                      Current
                    </span>
                  )}
                </div>
                <p className="mt-2 text-xs leading-snug text-muted">
                  {policy === "independence" && props.stateId.toUpperCase() === "NIR"
                    ? POLICY_NIR_REUNIFICATION_BLURB
                    : POLICY_BLURBS[policy]}
                </p>
              </div>
            );
          })}
        </div>
        {props.viewerCanManage && (
          <div className="mt-4 flex items-center justify-between">
            <div className="text-xs text-muted">
              {onCooldown
                ? `Locked for ${cooldownRemaining} more turns`
                : apShort
                  ? `Need ${DEVOLUTION_POLICY_CHANGE_AP_COST} AP to change (you have ${props.gubernatorialActions})`
                  : "Ready to change"}
            </div>
            <button
              type="button"
              onClick={() => setModalMode("normal")}
              disabled={!canChange}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Change policy
            </button>
          </div>
        )}
      </div>

      {props.viewerIsAdmin && (
        <div className="flex flex-col gap-2 rounded-xl border border-error/40 bg-error/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-sm font-semibold">Admin — change Devolution Policy</div>
            <div className="text-xs text-muted">
              Bypasses the office-holder check, AP cost, and cooldown.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setModalMode("admin")}
            className="self-end rounded-lg bg-error px-3 py-1.5 text-sm font-medium text-white hover:bg-error/80 sm:self-auto"
          >
            + Admin Override
          </button>
        </div>
      )}

      <ReferendumPanel
        countryId={props.countryId}
        stateId={props.stateId}
        currentTurn={props.currentTurn}
        viewerCanManage={props.viewerCanManage}
        data={props.referendum}
      />

      <ChangePolicyModal
        open={modalOpen}
        countryId={props.countryId}
        stateId={props.stateId}
        currentPolicy={props.currentPolicy}
        gubernatorialActions={props.gubernatorialActions}
        adminOverride={modalMode === "admin"}
        onClose={() => setModalMode(null)}
        onSuccess={() => {
          setModalMode(null);
          router.refresh();
        }}
      />
    </div>
  );
}

function DriverRow({ label, value }: { label: string; value: number }) {
  const color =
    value > 0.0005 ? "text-emerald-500" : value < -0.0005 ? "text-rose-500" : "text-muted";
  return (
    <li className="flex justify-between">
      <span className="text-foreground/90">{label}</span>
      <span className={`tabular-nums ${color}`}>{fmt(value)}</span>
    </li>
  );
}
