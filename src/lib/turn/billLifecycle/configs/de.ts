import type { Db } from "mongodb";
import { createNotifications } from "@/lib/notifications";
import type { Bill, Character } from "@/lib/db/types";
import type { BillLifecycleConfig } from "../types";

const VOTING_HOURS = 24;

/**
 * Notify a DE bill's sponsor of the outcome. Reproduces the legacy
 * `notifyDESponsor` copy exactly. Only `signed`/`failed` are reachable in the
 * single-chamber Bundestag graph; other statuses are no-ops.
 */
async function notifyDESponsor(db: Db, bill: Bill, status: Bill["status"]): Promise<void> {
  if (status !== "signed" && status !== "failed") return;
  if (!bill.sponsorId) return;
  try {
    const sponsor = await db
      .collection<Character>("characters")
      .findOne({ _id: bill.sponsorId }, { projection: { userId: 1 } });
    if (!sponsor) return;

    const message =
      status === "signed"
        ? `Your bill "${bill.title}" has passed the Bundestag and is now law.`
        : `Your bill "${bill.title}" failed to pass the Bundestag.`;

    await createNotifications([
      {
        userId: sponsor.userId,
        type: status === "signed" ? "bill_signed" : "bill_failed_chamber",
        title: status === "signed" ? "Bill Enacted" : "Bill Failed",
        message,
        metadata: { billId: bill._id.toString() },
      },
    ]);
  } catch {
    // Non-critical — don't halt processing.
  }
}

/**
 * Germany national lifecycle: single Bundestag vote → immediate enactment on
 * pass, failed on reject. No override, no gov-pending freeze. Reproduces the
 * phase previously in deBillLifecycle.ts; the engine additionally scopes votes to
 * current seat holders (#0836/#0982).
 */
export const DE_NATIONAL_CONFIG: BillLifecycleConfig = {
  country: "DE",
  level: "national",
  originChambers: ["bundestag"],
  notifySponsor: notifyDESponsor,
  stages: [
    {
      kind: "chamberVote",
      status: "active",
      voteField: "votes",
      officeTypeFor: (b) => b.currentChamber, // Bundestag members hold officeType "bundestag"
      passRule: "simpleMajority", // nat/priv two-thirds handled by the engine evaluator
      onReject: "fail",
      onPassStatus: "signed", // terminal — enacts immediately
      votingDurationHours: VOTING_HOURS,
    },
  ],
};
