"use client";

import { DevolutionDesireReadout } from "@/components/uk/DevolutionDesireReadout";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CountryId } from "@/lib/constants/countries";
import {
  DEVOLUTION_POLICY_CHANGE_AP_COST,
  DEVOLUTION_POLICY_CHANGE_COOLDOWN_TURNS,
  HIGH_DESIRE_BONUS_BAND_SIZE,
  HIGH_DESIRE_BONUS_PER_BAND,
  HIGH_DESIRE_BONUS_THRESHOLD,
  HIGH_DESIRE_BONUS_TIER_COUNT,
  getDevolutionPolicyLabel,
  getIndependenceMetricLabel,
} from "@/lib/constants/devolution";
import type { DevolutionPolicy } from "@/lib/db/types/governorOfficeState";
import { ChangePolicyModal } from "./devolution/ChangePolicyModal";
import { ReferendumPanel, type ReferendumPanelData } from "./devolution/ReferendumPanel";

export interface DevolutionDriverSnapshot {
  drivers: {
    policy: number;
    westminsterPolicy: number;
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
  westminsterPolicy: DevolutionPolicy;
  policyChangedAtTurn: number | null;
  currentTurn: number;
  gubernatorialActions: number;
  /** Holder OR authorized party officer of an NPP-held office. Gates actions. */
  viewerCanManage: boolean;
  viewerIsAdmin: boolean;
  driverPreview: DevolutionDriverSnapshot;
  /** Current First Minister party eligible for the high-desire bonus. */
  firstMinisterPartyName: string | null;
  /** Current additive vote-share bonus after desire, policy, and office-holder
   *  eligibility are considered. */
  highDesireElectionBonus: number;
  /** Current/most-recent referendum + request eligibility for this region. */
  referendum: ReferendumPanelData;
}

/** Build the tier strip from the constants so the UI stays in lockstep
 *  with the engine if the thresholds, step size, or band count are ever
 *  retuned. */
const HIGH_DESIRE_BONUS_TIERS = Array.from({ length: HIGH_DESIRE_BONUS_TIER_COUNT }, (_, i) => ({
  threshold: HIGH_DESIRE_BONUS_THRESHOLD + i * HIGH_DESIRE_BONUS_BAND_SIZE,
  bonusPct: (i + 1) * HIGH_DESIRE_BONUS_PER_BAND * 100,
}));
const HIGH_DESIRE_BONUS_MAX_PCT =
  HIGH_DESIRE_BONUS_TIERS[HIGH_DESIRE_BONUS_TIERS.length - 1].bonusPct;
const HIGH_DESIRE_BONUS_FIRST_PCT = HIGH_DESIRE_BONUS_TIERS[0].bonusPct;

const POLICY_OPTIONS: DevolutionPolicy[] = ["anti", "pro", "independence"];

const POLICY_BLURBS: Record<DevolutionPolicy, string> = {
  anti: "Defend the Union. There is no future in separation, and devolved powers should not expand further.",
  pro: "The current devolution settlement works. We govern locally, but the great national questions remain reserved.",
  independence:
    "Our nation deserves to chart its own course. Building the case for separation is the work of this Government.",
};

const POLICY_NIR_REUNIFICATION_BLURB =
  "The future of this island is its reunification. Working with partners north and south to make it inevitable.";

export function DevolutionTab(props: Props) {
  const router = useRouter();
  const [modalMode, setModalMode] = useState<"normal" | "admin" | null>(null);
  const modalOpen = modalMode !== null;

  const cooldownReadyAt =
    props.policyChangedAtTurn != null
      ? props.policyChangedAtTurn + DEVOLUTION_POLICY_CHANGE_COOLDOWN_TURNS
      : null;
  const cooldownRemaining =
    cooldownReadyAt != null ? Math.max(0, cooldownReadyAt - props.currentTurn) : 0;
  const onCooldown = cooldownRemaining > 0;
  const apShort = props.gubernatorialActions < DEVOLUTION_POLICY_CHANGE_AP_COST;
  const canChange = props.viewerCanManage && !onCooldown && !apShort;

  return (
    <div className="space-y-6">
      <DevolutionDesireReadout
        data={{
          stateId: props.stateId,
          previous: props.currentValue,
          trend: props.currentTrend,
          policy: props.currentPolicy,
          westminsterPolicy: props.westminsterPolicy,
          ...props.driverPreview,
        }}
      />

      {/* First Minister party election bonus */}
      <div className="rounded-xl border border-card-border bg-card p-6">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm text-muted">Election bonus</h2>
          <div className="text-xs text-muted">
            Active at {HIGH_DESIRE_BONUS_THRESHOLD}+ · steps every {HIGH_DESIRE_BONUS_BAND_SIZE}pp ·
            capped at +{HIGH_DESIRE_BONUS_MAX_PCT}%
          </div>
        </div>
        {props.highDesireElectionBonus > 0 ? (
          <div className="mt-3 flex items-end gap-3">
            <div className="text-3xl font-bold tabular-nums text-emerald-500">
              +{(props.highDesireElectionBonus * 100).toFixed(1)}%
            </div>
            <div className="pb-1 text-sm text-muted">
              vote bonus to{" "}
              <span className="font-medium text-foreground/90">
                {props.firstMinisterPartyName ?? "the First Minister's party"}
              </span>{" "}
              in every {props.stateName} election. This does not penalise rivals.
            </div>
          </div>
        ) : props.currentPolicy !== "independence" ? (
          <div className="mt-3 text-sm text-muted">
            No bonus active. Devolution Policy must be set to{" "}
            {getDevolutionPolicyLabel(props.stateId, "independence")} and{" "}
            {getIndependenceMetricLabel(props.stateId).toLowerCase()} must reach{" "}
            {HIGH_DESIRE_BONUS_THRESHOLD}.
          </div>
        ) : props.currentValue < HIGH_DESIRE_BONUS_THRESHOLD ? (
          <div className="mt-3 text-sm text-muted">
            No bonus active. {getIndependenceMetricLabel(props.stateId).toLowerCase()} must reach{" "}
            {HIGH_DESIRE_BONUS_THRESHOLD} to unlock +{HIGH_DESIRE_BONUS_FIRST_PCT}%.
          </div>
        ) : (
          <div className="mt-3 text-sm text-muted">
            No bonus active. The current First Minister must belong to a party.
          </div>
        )}
        <ul
          className="mt-4 grid gap-2 text-center text-xs"
          style={{
            gridTemplateColumns: `repeat(${HIGH_DESIRE_BONUS_TIER_COUNT}, minmax(0, 1fr))`,
          }}
        >
          {HIGH_DESIRE_BONUS_TIERS.map((tier) => {
            const active =
              props.highDesireElectionBonus > 0 && props.currentValue >= tier.threshold;
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
          <h2 className="text-sm text-muted">Devolution policy</h2>
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
            + Admin override
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
