import { withSessionDb, afterCommit } from "@/lib/db/sessionDb";
/**
 * Conversion-window resolution for a passed referendum.
 *
 * When a referendum passes it enters a `actuating` conversion window
 * (`CONVERSION_WINDOW_TURNS`). During the window:
 *   - an admin may RESOLVE it early (run the transfer now), or
 *   - an admin may BLOCK it (the region does not transfer; `cancelled`).
 * The turn processor converts after all required consent bills are enacted.
 *
 * Both referendum kinds actuate here: reunification transfers the region to the
 * target country (NI → Ireland), and independence stands the region up as a new
 * sovereign country (Scotland/Wales leave the UK) via `secedeRegion`.
 */
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Bill } from "@/lib/db/types";
import type { Referendum } from "@/lib/db/types/referendum";
import { getReferendumCollection } from "@/lib/db/collections/referendum";
import { DECLINE_COOLDOWN_TURNS } from "@/lib/constants/referendum";
import {
  announceReunificationComplete,
  announceSecessionComplete,
} from "@/lib/referendum/referendumWebhooks";
import { recordWireEvent } from "@/lib/referendum/wire";
import { transferRegion } from "./transferRegion";
import { secedeRegion } from "@/lib/referendum/secede/secedeRegion";
import { isCountryEnabledForPlayers } from "@/lib/countryAccess";
import { enterCountryForPlayers } from "@/lib/world/playerHandoff";

/** Province grouping for NI under Ireland. */
const NIR_PROVINCE = "Ulster";
/** Display name NI takes once reunified — shown as the province of Ulster. */
const NIR_IE_NAME = "Ulster";
/** Where NI's evacuated NPP politicians (+ their corporations) relocate in the UK. */
const NIR_RELOCATE_REGION = "LON";

/** Withdraw the referendum's consent bills (Westminster and, when present, Dáil) if either is
 *  still being voted on (moot once the conversion resolves another way). A
 *  signed/failed bill is left as the historical record. */
async function withdrawActiveConsentBills(db: Db, ref: Referendum): Promise<void> {
  const ids = [ref.westminsterBillId, ref.dailBillId].filter(
    (x): x is NonNullable<typeof x> => x != null
  );
  if (ids.length === 0) return;
  await db
    .collection<Bill>("bills")
    .updateMany(
      { _id: { $in: ids }, status: "active" },
      { $set: { status: "withdrawn", updatedAt: new Date() } }
    );
}

/**
 * Cancel a passed referendum's conversion (the region does NOT transfer).
 * `cooldown` gates whether a new referendum is blocked for a while: admin block
 * applies a cooldown; a parliamentary rejection does not (the popular vote stands).
 */
export async function cancelReferendum(
  db: Db,
  ref: Referendum,
  currentTurn: number,
  opts: { cooldown: boolean }
): Promise<boolean> {
  return withSessionDb(db, (transactionDb) =>
    cancelReferendumInTransaction(transactionDb, ref, currentTurn, opts)
  );
}

async function cancelReferendumInTransaction(
  db: Db,
  ref: Referendum,
  currentTurn: number,
  opts: { cooldown: boolean }
): Promise<boolean> {
  const cancelled = await getReferendumCollection(db).updateOne(
    { _id: ref._id, status: "actuating" },
    {
      $set: {
        status: "cancelled",
        cooldownReadyAtTurn: opts.cooldown ? currentTurn + DECLINE_COOLDOWN_TURNS : null,
        updatedAt: new Date(),
      },
    }
  );
  if (cancelled.modifiedCount === 0) return false;
  await withdrawActiveConsentBills(db, ref);
  return true;
}

/**
 * Run the map-changing actuation and mark the referendum completed — dispatches
 * on `ref.kind` (independence → `secedeRegion`, reunification → `transferRegion`).
 * Shared by the admin "resolve" path and the turn processor's auto-convert.
 */
export async function runReferendumActuation(
  db: Db,
  ref: Referendum,
  currentTurn: number
): Promise<{ ok: boolean; error?: string; report?: unknown }> {
  return withSessionDb(db, (transactionDb) =>
    runReferendumActuationInTransaction(transactionDb, ref, currentTurn)
  );
}

async function runReferendumActuationInTransaction(
  db: Db,
  ref: Referendum,
  currentTurn: number
): Promise<{ ok: boolean; error?: string; report?: unknown }> {
  const claim = await getReferendumCollection(db).updateOne(
    { _id: ref._id, status: "actuating" },
    { $inc: { conversionRevision: 1 } }
  );
  if (claim.modifiedCount === 0)
    return { ok: false, error: "Referendum conversion is no longer pending." };
  // ── Independence: the region stands up as a new sovereign country ───────────
  if (ref.kind === "independence") {
    // Gate: the single Westminster consent bill must be signed for actuation.
    const bill = ref.westminsterBillId
      ? await db.collection<Bill>("bills").findOne({ _id: ref.westminsterBillId })
      : null;
    if (bill == null || (bill.status !== "signed" && bill.enactedAt == null)) {
      return { ok: false, error: "Westminster consent bill is not signed." };
    }
    const res = await secedeRegion(db, {
      regionId: ref.regionId,
      fromCountryId: ref.countryId,
      currentTurn,
    });
    if (!res.ok || res.skipped) {
      return {
        ok: false,
        error: `Secession did not run (${res.skipped ?? "unknown"}). Existing map changes require review before completion.`,
      };
    }
    await getReferendumCollection(db).updateOne(
      { _id: ref._id },
      { $set: { status: "completed", updatedAt: new Date() } }
    );
    // Force-resolved while the consent bill was still voting? Withdraw it (moot).
    await withdrawActiveConsentBills(db, ref);
    await afterCommit(db, () => announceSecessionComplete(ref).catch(() => {}));
    await recordWireEvent(db, {
      referendumId: ref._id!,
      countryId: ref.countryId,
      regionId: ref.regionId,
      turn: currentTurn,
      kind: "seceded",
      side: "yes",
      summary: `${ref.regionId} became an independent country.`,
    }).catch(() => {});
    return { ok: true, report: res.report };
  }

  if (ref.kind !== "reunification" || !ref.targetCountryId) {
    return { ok: false, error: "Only reunification referendums can be actuated in this phase." };
  }
  const consentIds = [ref.westminsterBillId, ref.dailBillId].filter(
    (id): id is NonNullable<typeof id> => id != null
  );
  if (ref.westminsterBillId == null)
    return { ok: false, error: "Westminster consent is required." };
  const consentBills = await db
    .collection<Bill>("bills")
    .find({ _id: { $in: consentIds } })
    .toArray();
  if (
    consentBills.length !== consentIds.length ||
    consentBills.some((bill) => bill.status !== "signed" && bill.enactedAt == null)
  )
    return { ok: false, error: "All required consent bills must be enacted." };
  const targetWasPlayerEnabled = await isCountryEnabledForPlayers(db, ref.targetCountryId);
  const result = await transferRegion(db, {
    regionId: ref.regionId,
    fromCountryId: ref.countryId,
    toCountryId: ref.targetCountryId,
    province: NIR_PROVINCE,
    displayName: NIR_IE_NAME,
    relocateToRegionId: NIR_RELOCATE_REGION,
    currentTurn,
  });
  if (!result.ok || result.skipped) {
    return {
      ok: false,
      error: `Transfer did not run (${result.skipped ?? "unknown"}). Existing map changes require review before completion.`,
    };
  }
  if (!targetWasPlayerEnabled) {
    await enterCountryForPlayers(db, ref.targetCountryId, {
      now: new Date(),
      status: "active",
    });
  }
  await getReferendumCollection(db).updateOne(
    { _id: ref._id },
    { $set: { status: "completed", updatedAt: new Date() } }
  );
  // If an admin force-resolved while a consent bill was still voting, that bill
  // is now moot. A bill that passed is already `signed`.
  await withdrawActiveConsentBills(db, ref);
  await afterCommit(db, () => announceReunificationComplete(ref).catch(() => {}));
  await recordWireEvent(db, {
    referendumId: ref._id!,
    countryId: ref.countryId,
    regionId: ref.regionId,
    turn: currentTurn,
    kind: "reunified",
    side: "yes",
    summary: `${ref.regionId} reunified with Ireland.`,
  }).catch(() => {});
  return { ok: true, report: result.report };
}

/**
 * Admin blocks a passed referendum's conversion — the region does NOT transfer.
 * Sets `cancelled` + a cooldown, and withdraws any active consent bill.
 */
export async function blockReferendumConversion(
  db: Db,
  ref: Referendum,
  currentTurn: number
): Promise<boolean> {
  return cancelReferendum(db, ref, currentTurn, { cooldown: true });
}

export type ActuateAction = "resolve" | "block";

export interface ActuateReferendumInput {
  referendumId: string;
  currentTurn: number;
  action: ActuateAction;
}

export interface ActuateReferendumResult {
  status: number;
  body: { error?: string; ok?: boolean; blocked?: boolean; regionId?: string; report?: unknown };
}

export async function actuateReferendumTransfer(
  db: Db,
  input: ActuateReferendumInput
): Promise<ActuateReferendumResult> {
  if (!ObjectId.isValid(input.referendumId))
    return { status: 400, body: { error: "Invalid referendum ID." } };
  const refs = getReferendumCollection(db);
  const ref = await refs.findOne({ _id: new ObjectId(input.referendumId) });
  if (!ref) return { status: 404, body: { error: "Referendum not found." } };
  if (ref.status !== "actuating") {
    return { status: 400, body: { error: "Referendum is not in the conversion window." } };
  }

  if (input.action === "block") {
    const blocked = await blockReferendumConversion(db, ref, input.currentTurn);
    if (!blocked)
      return { status: 409, body: { error: "Referendum conversion is no longer pending." } };
    return { status: 200, body: { ok: true, blocked: true, regionId: ref.regionId } };
  }

  const res = await runReferendumActuation(db, ref, input.currentTurn);
  if (!res.ok) return { status: 400, body: { error: res.error } };
  return { status: 200, body: { ok: true, regionId: ref.regionId, report: res.report } };
}
