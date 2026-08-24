import type { Db } from "mongodb";
import type { LegislationType } from "@/lib/db/types";
import { computeProvisionEffectChips } from "@/lib/legislature/provisionEffects";
import { optionIntensity } from "@/lib/legislature/optionIntensity";
import { effectTargetLabelFromMetricId } from "@/lib/legislature/metricLabels";
import { MIRROR_CONTROLLED_METRIC_IDS } from "@/lib/metricEngine/fiscalMirror";
import {
  resolveCurrentLaw,
  resolveProposedLabel,
  type LiveCurrentPolicy,
  type SnapshottedProvision,
} from "./currentLaw";
import { resolveProvisionFiscal } from "./fiscal";
import type { FiscalScope, ProvisionDisplay } from "./types";

/** True when any option on the ladder takes a non-zero stance on this axis. */
function axisRelevant(
  lt: LegislationType | null | undefined,
  axis: "economic" | "social"
): boolean {
  if (!lt?.policyOptions?.length) return false;
  return lt.policyOptions.some((opt) => (opt[axis] ?? 0) !== 0);
}

/**
 * Effect targets for the chip computation.
 *
 * The headline-effectTarget fallback synthesizes weight +1, which flips the
 * displayed sign for laws whose real (removed) weighted entry was negative — and
 * mirror-owned metrics never move from legislation anyway, so they never get a
 * synthesized chip. This fallback was national-only before the merge.
 */
function effectTargets(lt: LegislationType | null | undefined) {
  if (lt?.effectTargetsWeighted?.length) return lt.effectTargetsWeighted;
  if (lt?.effectTarget?.metricId && !MIRROR_CONTROLLED_METRIC_IDS.has(lt.effectTarget.metricId)) {
    return [
      {
        metricCategoryId: lt.effectTarget.metricCategoryId,
        metricId: lt.effectTarget.metricId,
        weight: 1,
      },
    ];
  }
  return [];
}

export interface ResolvePolicyProvisionArgs {
  scope: FiscalScope;
  lt: LegislationType | null | undefined;
  provision: SnapshottedProvision & { legislationTypeId: string; proposedRate?: number };
  live: LiveCurrentPolicy | undefined;
  legislationTypeName: string;
  directionLabel: "Left" | "Center" | "Right";
  positionLabel?: string;
}

/**
 * One policy provision, resolved for display.
 *
 * The single implementation behind both the national and the regional bill
 * pages. Before the merge these were two independent implementations, and the
 * regional one silently lacked snapshot awareness.
 */
export async function resolvePolicyProvision(
  db: Db,
  args: ResolvePolicyProvisionArgs
): Promise<ProvisionDisplay> {
  const { scope, lt, provision, live, legislationTypeName, directionLabel, positionLabel } = args;

  const proposed = resolveProposedLabel(lt, provision, positionLabel ?? `${directionLabel} policy`);
  const current = resolveCurrentLaw(lt, provision, live);

  const options = lt?.policyOptions ?? [];
  const proposedIntensity =
    proposed.index !== undefined
      ? optionIntensity(options, proposed.index)
      : Math.sign(provision.effectDirection);
  const currentIntensity =
    current.index !== undefined ? optionIntensity(options, current.index) : 0;

  const effects = computeProvisionEffectChips({
    effectTargetsWeighted: effectTargets(lt),
    proposedIntensity,
    currentIntensity,
  });

  const proposedOption = proposed.index !== undefined ? options[proposed.index] : undefined;

  return {
    legislationTypeId: provision.legislationTypeId,
    legislationTypeName,
    ...(provision.policyOptionId ? { policyOptionId: provision.policyOptionId } : {}),
    proposed: proposed.label,
    ...(current.label ? { current: current.label } : {}),
    ...(proposed.index !== undefined ? { proposedPolicyIndex: proposed.index } : {}),
    ...(current.index !== undefined ? { currentPolicyIndex: current.index } : {}),
    effectDirection: provision.effectDirection,
    directionLabel,
    ...(positionLabel ? { positionLabel } : {}),
    ...(lt?.effectTarget?.metricId
      ? { effectTargetLabel: effectTargetLabelFromMetricId(lt.effectTarget.metricId) }
      : {}),
    effectTargetsWeighted: lt?.effectTargetsWeighted ?? [],
    ...(effects.length ? { effects } : {}),
    ...(proposedOption?.archetypeApprovals
      ? { archetypeApprovals: proposedOption.archetypeApprovals }
      : proposedOption?.groupApprovals
        ? { archetypeApprovals: proposedOption.groupApprovals }
        : {}),
    ...(proposedOption?.groupApprovals ? { groupApprovals: proposedOption.groupApprovals } : {}),
    ...(lt?.policyDomain ? { policyDomain: lt.policyDomain } : {}),
    ...(options.length
      ? { policyOptionScores: options.map((o) => (o.economic ?? 0) + (o.social ?? 0)) }
      : {}),
    ...(provision.economic != null && axisRelevant(lt, "economic")
      ? { economic: provision.economic }
      : {}),
    ...(provision.social != null && axisRelevant(lt, "social") ? { social: provision.social } : {}),
    annualCostPerCapita: proposedOption?.annualCostPerCapita ?? null,
    gdpPerCapitaMultiplier: proposedOption?.gdpPerCapitaMultiplier ?? null,
    ...(await resolveProvisionFiscal(db, scope, lt, provision, proposed.index, current.index)),
  };
}
