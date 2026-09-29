/**
 * Northern Ireland peace agreements require both parliaments and a public ballot.
 * The ordinary referendum campaign records the exact bills being ratified;
 * rejected texts return to talks and need fresh authorization in both countries.
 */
import { createHash } from "node:crypto";
import { ObjectId, type Db } from "mongodb";
import type { Bill } from "@/lib/db/types";
import type { Referendum } from "@/lib/db/types/referendum";
import { CAMPAIGN_WINDOW_TURNS } from "@/lib/constants/referendum";
import { recordWireEvent } from "@/lib/referendum/wire";
import type { LivingConflictDef, LivingConflictState } from "./types";
import { applyTrackDeltas, evaluateConflictTransitions, phaseFor } from "./engine";
import { saveConflictState } from "./driver";
import {
  SUCCESS,
  northernIrelandPublicConsentDeltas,
  northernIrelandCampaignSupport,
  northernIrelandRatificationDeltas,
} from "./rules/northernIrelandRatification";

export { northernIrelandRatificationDeltas } from "./rules/northernIrelandRatification";

type RatificationBill = Pick<Bill, "_id" | "countryId" | "status" | "proposedTurn" | "proposedAt">;

export async function reconcileNorthernIrelandRatification(
  db: Db,
  def: LivingConflictDef,
  state: LivingConflictState,
  currentYear?: number,
  currentTurn = state.lastProcessedTurn ?? state.totalTurns
): Promise<LivingConflictState> {
  if (!state.hasOpened || state.status === "closed") return state;
  const bills = await db
    .collection<RatificationBill>("bills")
    .find(
      { category: "northern_ireland_peace", countryId: { $in: ["UK", "IE"] } },
      { projection: { countryId: 1, status: 1, proposedTurn: 1, proposedAt: 1 } }
    )
    .sort({ proposedTurn: -1, proposedAt: -1, _id: -1 })
    .toArray();
  const uk = bills.find((bill) => bill.countryId === "UK");
  const ie = bills.find((bill) => bill.countryId === "IE");
  const refs = db.collection<Referendum>("referendums");
  const previousRejection = await refs.findOne(
    { kind: "peace_agreement", "peaceAgreement.conflictKey": def.key, "result.passed": false },
    { sort: { "result.resolvedTurn": -1 } }
  );
  const freshAuthorization =
    !previousRejection ||
    [uk, ie].every(
      (bill) => bill != null && bill.proposedTurn > (previousRejection.result?.resolvedTurn ?? -1)
    );
  const authorized =
    freshAuthorization && uk?._id && ie?._id && SUCCESS.has(uk.status) && SUCCESS.has(ie.status);
  const agreementKey = uk?._id && ie?._id ? `${uk._id}:${ie._id}` : null;
  const ballotId = agreementKey
    ? new ObjectId(
        createHash("sha256").update(`northern_ireland:${agreementKey}`).digest("hex").slice(0, 24)
      )
    : null;
  let ballot = ballotId ? await refs.findOne({ _id: ballotId }) : null;
  if (
    authorized &&
    uk?._id &&
    ie?._id &&
    ballotId &&
    agreementKey &&
    !ballot &&
    phaseFor(def, state.phaseLevel)?.key === "agreement"
  ) {
    // Keep the existing regional campaign as the sole active ballot. A border
    // poll remains a separate constitutional question and is never overwritten.
    const active = await refs.findOne(
      {
        countryId: "UK",
        regionId: "NIR",
        status: {
          $in: ["requested", "granted", "campaigning", "polling", "actuating"],
        },
      },
      { projection: { _id: 1 } }
    );
    if (!active) {
      const now = new Date();
      const support = northernIrelandCampaignSupport(state);
      const opened: Referendum = {
        _id: ballotId,
        countryId: "UK",
        regionId: "NIR",
        kind: "peace_agreement",
        targetCountryId: null,
        status: "granted",
        peaceAgreement: { conflictKey: "northern_ireland", agreementKey },
        requestedTurn: currentTurn,
        grantedTurn: currentTurn,
        campaignOpenTurn: currentTurn,
        campaignCloseTurn: currentTurn + CAMPAIGN_WINDOW_TURNS,
        yesShare: support,
        campaignBaseYesShare: support,
        campaignSpendUnits: { yes: 0, no: 0 },
        conversionDeadlineTurn: null,
        westminsterBillId: uk._id,
        dailBillId: ie._id,
        result: null,
        cooldownReadyAtTurn: null,
        createdAt: now,
        updatedAt: now,
      };
      // Deterministic _id plus insert-only fields make a turn retry safe without
      // resetting spending, opening support, the deadline, or an existing result.
      await refs.updateOne({ _id: ballotId }, { $setOnInsert: opened }, { upsert: true });
      ballot = await refs.findOne({ _id: ballotId });
      await recordWireEvent(db, {
        referendumId: ballotId,
        countryId: "UK",
        regionId: "NIR",
        turn: currentTurn,
        kind: "consent",
        summary:
          "Westminster and the Dáil authorized a public vote on the Northern Ireland peace agreement.",
      }).catch(() => {});
    }
  }
  const rejectionId = previousRejection?._id?.toHexString();
  const plan = northernIrelandPublicConsentDeltas(
    state,
    northernIrelandRatificationDeltas(bills, state),
    {
      freshAuthorization,
      passed: Boolean(authorized && ballot?.status === "completed" && ballot.result?.passed),
      rejectionId,
    }
  );
  // The turn driver owns ordinary phase advancement. Reconciliation only
  // advances in response to newly recorded parliamentary or public consent.
  // Preserve identity and timestamp on an idle retry, as well as avoiding I/O.
  if (!plan.newlyRejected && Object.values(plan.deltas).every((delta) => delta === 0)) {
    return state;
  }
  let tracked = applyTrackDeltas(def, state, plan.deltas);
  if (plan.newlyRejected) {
    tracked = {
      ...tracked,
      rejectedPeaceReferendumId: rejectionId,
      phaseLevel: def.phases.find((phase) => phase.key === "multiparty_talks")!.level,
      status: "negotiating",
      phaseTurns: 0,
      emitPhaseEntryNextTurn: true,
    };
  } else {
    tracked = evaluateConflictTransitions(def, tracked, currentYear).state;
  }
  await saveConflictState(db, tracked);
  return tracked;
}
