import type { Db } from "mongodb";
import type { Bill, BillStatus } from "@/lib/db/types";
import type { LivingConflictDef, LivingConflictState } from "./types";
import { applyTrackDeltas, evaluateConflictTransitions } from "./engine";
import { saveConflictState } from "./driver";

const SUCCESS: ReadonlySet<BillStatus> = new Set(["signed", "veto_override"]);
const FAILURE: ReadonlySet<BillStatus> = new Set([
  "vetoed",
  "override_failed",
  "failed",
  "withdrawn",
  "filibustered",
]);

export function northernIrelandRatificationDeltas(
  bills: Array<Pick<Bill, "countryId" | "status">>,
  state: LivingConflictState
): Record<string, number> {
  const relevant = bills.filter((bill) => bill.countryId === "UK" || bill.countryId === "IE");
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

export async function reconcileNorthernIrelandRatification(
  db: Db,
  def: LivingConflictDef,
  state: LivingConflictState,
  currentYear?: number
): Promise<LivingConflictState> {
  const bills = await db
    .collection<Bill>("bills")
    .find(
      { category: "northern_ireland_peace", countryId: { $in: ["UK", "IE"] } },
      { projection: { countryId: 1, status: 1 } }
    )
    .toArray();
  const deltas = northernIrelandRatificationDeltas(bills, state);
  if (Object.values(deltas).every((delta) => delta === 0)) return state;
  const tracked = applyTrackDeltas(def, state, deltas);
  const transitioned = evaluateConflictTransitions(def, tracked, currentYear).state;
  await saveConflictState(db, transitioned);
  return transitioned;
}
