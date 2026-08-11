import type { Db } from "mongodb";
import { createNotifications } from "@/lib/notifications";
import type { Bill, Character } from "@/lib/db/types";
import type { BillLifecycleConfig } from "../types";

const VOTING_HOURS = 24;

/**
 * Notify a UK bill's sponsor of the outcome. Royal Assent on enact; failed to
 * pass Parliament on reject; Lords revision when held in enrolled.
 */
async function notifyUKSponsor(db: Db, bill: Bill, status: Bill["status"]): Promise<void> {
  if (status !== "signed" && status !== "failed" && status !== "enrolled") return;
  if (!bill.sponsorId) return;
  try {
    const sponsor = await db
      .collection<Character>("characters")
      .findOne({ _id: bill.sponsorId }, { projection: { userId: 1 } });
    if (!sponsor) return;

    const message =
      status === "signed"
        ? `Your bill "${bill.title}" has passed Parliament and received Royal Assent.`
        : status === "enrolled"
          ? `Your bill "${bill.title}" has cleared the Commons and is under Lords revision before Royal Assent.`
          : `Your bill "${bill.title}" has failed to pass Parliament.`;

    await createNotifications([
      {
        userId: sponsor.userId,
        type:
          status === "signed"
            ? "bill_signed"
            : status === "enrolled"
              ? "bill_enrolled"
              : "bill_failed_chamber",
        title:
          status === "signed"
            ? "Bill Enacted"
            : status === "enrolled"
              ? "Lords Revision"
              : "Bill Failed",
        message,
        metadata: { billId: bill._id.toString() },
      },
    ]);
  } catch {
    // Non-critical — don't halt processing.
  }
}

/**
 * UK Parliament national lifecycle: Commons vote → (optional Lords revision
 * hold) → Royal Assent. No playable Lords seats — the hold is tempo + wire
 * flavor only. Frozen while the UK government is forming (S#17).
 *
 * The executiveAction stage exists so `closeExecutiveStage` can pocket-enact
 * bills held in `enrolled` after a Lords revision delay; most bills still
 * enact immediately on Commons pass when the revision roll misses.
 */
export const UK_NATIONAL_CONFIG: BillLifecycleConfig = {
  country: "UK",
  level: "national",
  originChambers: ["commons", "lords"],
  skipWhenGovPending: true,
  notifySponsor: notifyUKSponsor,
  lordsRevisionFlavor: {
    chance: 0.28,
    delayTurnsMin: 1,
    delayTurnsMax: 2,
  },
  stages: [
    {
      kind: "chamberVote",
      status: "active",
      voteField: "votes",
      officeTypeFor: (b) => b.currentChamber,
      passRule: "simpleMajority",
      onReject: "fail",
      // Points at enrolled so a delayed bill can sit there; immediate path
      // still short-circuits to signed when the Lords roll misses.
      onPassStatus: "enrolled",
      votingDurationHours: VOTING_HOURS,
    },
    {
      kind: "executiveAction",
      status: "enrolled",
      execKind: "assent",
      officeType: "",
      // Max Lords hold (turns). Actual delay is rolled per bill in the engine.
      windowHours: 2,
      onTimeout: "enact",
    },
  ],
};
