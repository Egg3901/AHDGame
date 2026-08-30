import type {
  GovernorExecutiveOrder,
  LegislationPolicyOption,
  LegislationType,
  StatePolicy,
} from "@/lib/db/types";
import { effectDirectionAtIndex } from "@/lib/legislature/optionIntensity";

type RevertPolicyFields = Pick<
  StatePolicy,
  "policyOptionIndex" | "effectDirection" | "enactedTurn" | "enactedBy"
> &
  Partial<Pick<StatePolicy, "policyOptionId" | "economic" | "social">>;

export function policyFieldsFromOption(
  option: LegislationPolicyOption,
  policyOptionIndex: number
): Pick<
  StatePolicy,
  "policyOptionIndex" | "policyOptionId" | "economic" | "social" | "effectDirection"
> {
  return {
    policyOptionIndex,
    policyOptionId: option.id,
    economic: option.economic,
    social: option.social,
    effectDirection: option.effectDirection,
  };
}

/**
 * Build the durable policy restored when an executive order ends.
 *
 * Older orders only recorded the numeric before-index. Their zero-valued axis
 * fields were placeholders, not an exact snapshot, so the legislation ladder
 * is authoritative whenever policyOptionIdBefore is absent.
 */
export function buildOrderRevertPolicyFields(
  order: GovernorExecutiveOrder,
  legislationType: Pick<LegislationType, "policyOptions"> | null,
  currentTurn: number
): RevertPolicyFields {
  const indexedOption = legislationType?.policyOptions?.[order.policyOptionIndexBefore];
  const snapshottedOptionIndex = order.policyOptionIdBefore
    ? legislationType?.policyOptions?.findIndex(
        (option) => option.id === order.policyOptionIdBefore
      )
    : -1;
  const snapshotMatchesIndex = snapshottedOptionIndex === order.policyOptionIndexBefore;
  const snapshottedOption = snapshotMatchesIndex
    ? legislationType?.policyOptions?.[snapshottedOptionIndex]
    : undefined;
  const priorOption = snapshottedOption ?? indexedOption;
  // A short-lived legacy expiry bug could leave an order with an option id
  // copied from an already-corrupt row while its numeric before-index remained
  // correct. Never rebuild a hybrid row from contradictory snapshots.
  const hasExactSnapshot = order.policyOptionIdBefore != null && snapshotMatchesIndex;

  return {
    policyOptionIndex: order.policyOptionIndexBefore,
    ...(priorOption?.id ? { policyOptionId: priorOption.id } : {}),
    ...(hasExactSnapshot
      ? {
          ...(order.economicBefore != null
            ? { economic: order.economicBefore }
            : priorOption
              ? { economic: priorOption.economic }
              : {}),
          ...(order.socialBefore != null
            ? { social: order.socialBefore }
            : priorOption
              ? { social: priorOption.social }
              : {}),
        }
      : priorOption
        ? { economic: priorOption.economic, social: priorOption.social }
        : {
            ...(order.economicBefore != null ? { economic: order.economicBefore } : {}),
            ...(order.socialBefore != null ? { social: order.socialBefore } : {}),
          }),
    effectDirection: effectDirectionAtIndex(
      legislationType?.policyOptions,
      order.policyOptionIndexBefore
    ),
    enactedTurn: currentTurn,
    enactedBy: { kind: "expiry", id: order._id! },
  };
}
