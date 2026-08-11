/**
 * Per-turn driver for the referendum state machine. Advances every active
 * referendum one edge per turn (the PM's grant/decline and the bill votes are
 * handled out-of-band):
 *
 *   granted     → campaigning              (next turn after the PM grants)
 *   campaigning → polling                  (when the campaign window closes)
 *   polling     → actuating | settled      (resolve the public vote)
 *   actuating   → completed | cancelled    (both consent bills pass / either fails)
 *
 * Registered as the `referendumLifecycle` turn phase, after
 * `independenceDesireDrift` so a settled No-vote dampens the just-updated
 * desire value. Mirrors the structure of other per-turn processors; the
 * vote math lives in pure helpers in `@/lib/constants/referendum`.
 *
 * See docs/superpowers/specs/2026-06-16-independence-process-design.md §5.1.
 */
import type { Db } from "mongodb";
import type { ReferendumStatus } from "@/lib/db/types/referendum";
import type { Bill, StateDemographics } from "@/lib/db/types";
import { getReferendumCollection } from "@/lib/db/collections/referendum";
import { applyReferendumOutcome } from "@/lib/referendum/outcome";
import {
  runReferendumActuation,
  cancelReferendum,
} from "@/lib/referendum/transfer/actuateReferendum";
import { resolveReferendumVote } from "@/lib/constants/referendum";
import { announceConsentBillResolved } from "@/lib/referendum/referendumWebhooks";
import { upsertPollPoint } from "@/lib/referendum/pollSnapshot";
import { buildReferendumCohorts, type ReferendumCohort } from "@/lib/referendum/cohortEngine";
import { cohortAffinitiesFor } from "@/lib/constants/referendumCohorts";
import { referendumYesShare } from "@/lib/referendum/resolveYesShare";
import { recordWireEvent } from "@/lib/referendum/wire";
import { WIRE_SWING_THRESHOLD } from "@/lib/constants/referendum";

/**
 * Snapshot a region's cohort baseline at campaign open. Falls back to a single
 * synthetic cohort (so `yesShare == regionDesire`) when a region has no
 * `stateDemographics` groups.
 */
async function buildCohortBaseline(
  db: Db,
  regionId: string,
  regionDesire: number
): Promise<ReferendumCohort[]> {
  const demo = await db
    .collection<StateDemographics>("stateDemographics")
    .findOne({ _id: regionId });
  if (!demo?.groups || Object.keys(demo.groups).length === 0) {
    return [{ groupId: "_all", share: 1, turnout: 60, yesLean: regionDesire }];
  }
  return buildReferendumCohorts(demo.groups, regionDesire, cohortAffinitiesFor(regionId));
}

const ACTIVE_STATUSES: ReferendumStatus[] = ["granted", "campaigning", "polling", "actuating"];

export interface ReferendumLifecycleResult {
  processed: number;
  transitions: Array<{ referendumId: string; from: string; to: string }>;
}

/**
 * Deterministic [-1, 1] variance from referendum id + turn — avoids
 * `Math.random` so a re-run / resumed turn produces the same result.
 */
export function seededVariance(id: string, turn: number): number {
  let h = 2166136261;
  const s = `${id}:${turn}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

export async function processReferendumLifecycle(
  db: Db,
  currentTurn: number
): Promise<ReferendumLifecycleResult | null> {
  const refs = getReferendumCollection(db);
  const active = await refs.find({ status: { $in: ACTIVE_STATUSES } }).toArray();
  if (active.length === 0) return null;

  const transitions: ReferendumLifecycleResult["transitions"] = [];
  const now = new Date();

  for (const ref of active) {
    const id = String(ref._id);
    const from = ref.status;

    if (ref.status === "granted") {
      // Seed the opening poll point at the campaign's baseline + snapshot the
      // cohort model (anchored to the same baseline desire).
      const openDesire = ref.campaignBaseYesShare ?? ref.yesShare;
      const pollHistory = upsertPollPoint(
        ref.pollHistory,
        ref.campaignOpenTurn ?? currentTurn,
        openDesire
      );
      const cohortBaseline = await buildCohortBaseline(db, ref.regionId, openDesire);
      await refs.updateOne(
        { _id: ref._id },
        { $set: { status: "campaigning", pollHistory, cohortBaseline, updatedAt: now } }
      );
      await recordWireEvent(db, {
        referendumId: ref._id!,
        countryId: ref.countryId,
        regionId: ref.regionId,
        turn: currentTurn,
        kind: "opened",
        summary: "Campaign opened.",
      }).catch(() => {});
      transitions.push({ referendumId: id, from, to: "campaigning" });
      continue;
    }

    if (ref.status === "campaigning") {
      // Live-seed cohorts for a campaign that predates the cohort model.
      if (!ref.cohortBaseline || ref.cohortBaseline.length === 0) {
        ref.cohortBaseline = await buildCohortBaseline(
          db,
          ref.regionId,
          ref.campaignBaseYesShare ?? ref.yesShare
        );
      }
      // Canonical Yes share = cohort aggregate (PS folded in), the value the
      // vote will resolve on — never the stale stored scalar.
      const canonical = referendumYesShare(ref);
      // A notable per-turn move (since the previous reading) hits the wire.
      const prevReading = (ref.pollHistory ?? []).at(-1)?.yesShare ?? null;
      if (prevReading != null && Math.abs(canonical - prevReading) >= WIRE_SWING_THRESHOLD) {
        const delta = canonical - prevReading;
        await recordWireEvent(db, {
          referendumId: ref._id!,
          countryId: ref.countryId,
          regionId: ref.regionId,
          turn: currentTurn,
          kind: "swing",
          side: delta >= 0 ? "yes" : "no",
          delta: Number(delta.toFixed(2)),
          summary: `Yes ${delta >= 0 ? "surged" : "slipped"} ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}.`,
        }).catch(() => {});
      }
      // Live-seed an opening poll point for a campaign that predates poll history.
      let pollHistory = ref.pollHistory ?? [];
      if (pollHistory.length === 0) {
        pollHistory = upsertPollPoint(
          pollHistory,
          ref.campaignOpenTurn ?? currentTurn,
          ref.campaignBaseYesShare ?? ref.yesShare
        );
      }
      pollHistory = upsertPollPoint(pollHistory, currentTurn, canonical);

      if (ref.campaignCloseTurn != null && currentTurn >= ref.campaignCloseTurn) {
        // Fold the final reading into the transition write.
        await refs.updateOne(
          { _id: ref._id },
          {
            $set: {
              status: "polling",
              pollHistory,
              cohortBaseline: ref.cohortBaseline,
              yesShare: canonical,
              updatedAt: now,
            },
          }
        );
        transitions.push({ referendumId: id, from, to: "polling" });
      } else {
        // Display-only write — never let a snapshot failure break the turn.
        await refs
          .updateOne(
            { _id: ref._id },
            {
              $set: {
                pollHistory,
                cohortBaseline: ref.cohortBaseline,
                yesShare: canonical,
                updatedAt: now,
              },
            }
          )
          .catch((err) => console.error(`${ref.regionId} poll snapshot write failed:`, err));
      }
      continue;
    }

    if (ref.status === "polling") {
      // Authoritative Yes share = the cohort aggregate (PS + ground game folded
      // in) — independent of any raced display updates.
      const canonicalYesShare = referendumYesShare(ref);
      const outcome = resolveReferendumVote({
        yesShare: canonicalYesShare,
        varianceRoll: seededVariance(id, currentTurn),
      });
      await applyReferendumOutcome(db, ref, outcome, currentTurn);
      transitions.push({ referendumId: id, from, to: outcome.passed ? "actuating" : "settled" });
      continue;
    }

    if (ref.status === "actuating") {
      // Reunification gates on BOTH consent bills (Westminster releases NI, the
      // Dáil admits it). Order-independent: poll each bill's resolved status —
      //   both passed → convert; EITHER failed/withdrawn/missing → cancel (no
      //   cooldown, the popular vote stands); otherwise (still voting) → wait.
      //   Admins can resolve/block out-of-band via the admin route. Independence
      //   (no bills) awaits the secession engine in Phases 2–3.
      if (ref.kind === "reunification" && ref.westminsterBillId != null && ref.dailBillId != null) {
        const [westminster, dail] = await Promise.all([
          db.collection<Bill>("bills").findOne({ _id: ref.westminsterBillId }),
          db.collection<Bill>("bills").findOne({ _id: ref.dailBillId }),
        ]);
        const billPassed = (b: Bill | null) =>
          b != null && (b.status === "signed" || b.enactedAt != null);
        const billFailed = (b: Bill | null) =>
          b == null || b.status === "failed" || b.status === "withdrawn";

        // Post each consent bill's vote outcome to its parliament's webhook
        // exactly once — Commons → UK, Dáil → IE. "withdrawn" is procedural
        // (our own resolve/block), not a vote outcome, so it is not announced.
        const announce: Partial<
          Pick<typeof ref, "westminsterBillAnnounced" | "dailBillAnnounced">
        > = {};
        const recordConsent = (chamber: "Commons" | "Dáil", passed: boolean) =>
          recordWireEvent(db, {
            referendumId: ref._id!,
            countryId: ref.countryId,
            regionId: ref.regionId,
            turn: currentTurn,
            kind: "consent",
            summary: `The ${chamber} ${passed ? "passed" : "rejected"} the consent bill.`,
          }).catch(() => {});
        if (!ref.westminsterBillAnnounced) {
          if (billPassed(westminster)) {
            await announceConsentBillResolved(ref, "commons", true);
            await recordConsent("Commons", true);
            announce.westminsterBillAnnounced = true;
          } else if (westminster?.status === "failed") {
            await announceConsentBillResolved(ref, "commons", false);
            await recordConsent("Commons", false);
            announce.westminsterBillAnnounced = true;
          }
        }
        if (!ref.dailBillAnnounced) {
          if (billPassed(dail)) {
            await announceConsentBillResolved(ref, "dail", true);
            await recordConsent("Dáil", true);
            announce.dailBillAnnounced = true;
          } else if (dail?.status === "failed") {
            await announceConsentBillResolved(ref, "dail", false);
            await recordConsent("Dáil", false);
            announce.dailBillAnnounced = true;
          }
        }
        if (Object.keys(announce).length > 0) {
          await refs.updateOne({ _id: ref._id }, { $set: { ...announce, updatedAt: now } });
        }

        if (billPassed(westminster) && billPassed(dail)) {
          const res = await runReferendumActuation(db, ref, currentTurn);
          if (res.ok) {
            transitions.push({ referendumId: id, from, to: "completed" });
          } else {
            console.error(`${ref.regionId} auto-conversion failed: ${res.error}`);
          }
        } else if (billFailed(westminster) || billFailed(dail)) {
          await cancelReferendum(db, ref, currentTurn, { cooldown: false });
          transitions.push({ referendumId: id, from, to: "cancelled" });
        }
      }

      // Independence gates on the SINGLE Westminster consent bill (the UK releases
      // the region as a new sovereign country — there is no admitting parliament).
      // Passed → secede via `secedeRegion`; failed/withdrawn/missing → cancel (no
      // cooldown, the popular vote stands); still voting → wait.
      if (ref.kind === "independence" && ref.westminsterBillId != null) {
        const westminster = await db
          .collection<Bill>("bills")
          .findOne({ _id: ref.westminsterBillId });
        const billPassed = (b: Bill | null) =>
          b != null && (b.status === "signed" || b.enactedAt != null);
        const billFailed = (b: Bill | null) =>
          b == null || b.status === "failed" || b.status === "withdrawn";

        if (!ref.westminsterBillAnnounced && (billPassed(westminster) || billFailed(westminster))) {
          const passed = billPassed(westminster);
          // Post the Commons outcome to the UK webhook once. "withdrawn"/missing
          // is procedural (our own resolve/block), not a vote — wire + flag only.
          if (passed || westminster?.status === "failed") {
            await announceConsentBillResolved(ref, "commons", passed);
          }
          await recordWireEvent(db, {
            referendumId: ref._id!,
            countryId: ref.countryId,
            regionId: ref.regionId,
            turn: currentTurn,
            kind: "consent",
            summary: `The Commons ${passed ? "passed" : "rejected"} the consent bill.`,
          }).catch(() => {});
          await refs.updateOne(
            { _id: ref._id },
            { $set: { westminsterBillAnnounced: true, updatedAt: now } }
          );
        }

        if (billPassed(westminster)) {
          const res = await runReferendumActuation(db, ref, currentTurn);
          if (res.ok) {
            transitions.push({ referendumId: id, from, to: "completed" });
          } else {
            console.error(`${ref.regionId} auto-secession failed: ${res.error}`);
          }
        } else if (billFailed(westminster)) {
          await cancelReferendum(db, ref, currentTurn, { cooldown: false });
          transitions.push({ referendumId: id, from, to: "cancelled" });
        }
      }
      continue;
    }
  }

  return { processed: transitions.length, transitions };
}
