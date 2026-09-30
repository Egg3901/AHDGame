/**
 * Northern Ireland settlement consent comes from both parliaments and the public.
 * Each parliament's latest bill replaces its previous attempt; campaign support
 * cannot exceed either community's independently negotiated consent.
 */
import type { Bill, BillStatus } from "@/lib/db/types";
import type { LivingConflictState } from "../types";

export const SUCCESS: ReadonlySet<BillStatus> = new Set(["signed", "veto_override"]);
const FAILURE: ReadonlySet<BillStatus> = new Set([
  "vetoed",
  "override_failed",
  "failed",
  "withdrawn",
  "filibustered",
]);

export function northernIrelandRatificationDeltas(
  bills: Array<
    Pick<Bill, "countryId" | "status"> & Partial<Pick<Bill, "proposedTurn" | "proposedAt">>
  >,
  state: LivingConflictState
): Record<string, number> {
  const latest = new Map<string, (typeof bills)[number]>();
  for (const bill of bills) {
    if (bill.countryId !== "UK" && bill.countryId !== "IE") continue;
    const previous = latest.get(bill.countryId);
    if (
      !previous ||
      (bill.proposedTurn ?? -1) > (previous.proposedTurn ?? -1) ||
      ((bill.proposedTurn ?? -1) === (previous.proposedTurn ?? -1) &&
        (bill.proposedAt?.getTime() ?? 0) > (previous.proposedAt?.getTime() ?? 0))
    ) {
      latest.set(bill.countryId, bill);
    }
  }
  const relevant = [...latest.values()];
  const authorizedCountries = new Set(
    relevant.filter((bill) => SUCCESS.has(bill.status)).map((bill) => bill.countryId)
  );
  const failedCountries = new Set(
    relevant.filter((bill) => FAILURE.has(bill.status)).map((bill) => bill.countryId)
  );
  const current = state.tracks?.ratificationAuthorization ?? 0;
  const currentFailures = state.tracks?.ratificationFailureCount ?? 0;
  const target = authorizedCountries.size;
  const newlyFailed = Math.max(0, failedCountries.size - currentFailures);
  return {
    ratificationAuthorization: target - current,
    ratificationFailureCount: failedCountries.size - currentFailures,
    ...(newlyFailed > 0 && target < 2
      ? { settlementMomentum: -4 * newlyFailed, legitimacy: -3 * newlyFailed }
      : {}),
  };
}

export function northernIrelandCampaignSupport(state: LivingConflictState): number {
  return Math.max(
    0,
    Math.min(
      100,
      state.tracks?.unionistConsent ?? 0,
      state.tracks?.nationalistConsent ?? 0,
      state.tracks?.legitimacy ?? 0
    )
  );
}

/** Reconcile the public mandate and apply a rejected ballot exactly once. */
export function northernIrelandPublicConsentDeltas(
  state: LivingConflictState,
  billDeltas: Record<string, number>,
  publicConsent: { freshAuthorization: boolean; passed: boolean; rejectionId?: string }
): { deltas: Record<string, number>; newlyRejected: boolean } {
  const deltas: Record<string, number> = {
    ...billDeltas,
    ratificationAuthorization: publicConsent.freshAuthorization
      ? billDeltas.ratificationAuthorization
      : -(state.tracks?.ratificationAuthorization ?? 0),
    referendumRatification:
      Number(publicConsent.passed) - (state.tracks?.referendumRatification ?? 0),
  };
  const newlyRejected = Boolean(
    publicConsent.rejectionId && publicConsent.rejectionId !== state.rejectedPeaceReferendumId
  );
  return {
    deltas: newlyRejected
      ? {
          ...deltas,
          settlementMomentum: (deltas.settlementMomentum ?? 0) - 15,
          legitimacy: (deltas.legitimacy ?? 0) - 10,
        }
      : deltas,
    newlyRejected,
  };
}
