import type { Db } from "mongodb";
import { createNotifications } from "@/lib/notifications";
import type { Bill, Character } from "@/lib/db/types";
import type { BillLifecycleConfig } from "../types";

const VOTING_HOURS = 24;

/**
 * Notify an IE bill's sponsor of the outcome. Reproduces the legacy
 * `notifyIESponsor` copy exactly. Only `signed`/`failed` are reachable in the
 * single-chamber Dáil graph; other statuses are no-ops.
 */
async function notifyIESponsor(db: Db, bill: Bill, status: Bill["status"]): Promise<void> {
  if (status !== "signed" && status !== "failed") return;
  if (!bill.sponsorId) return;
  try {
    const sponsor = await db
      .collection<Character>("characters")
      .findOne({ _id: bill.sponsorId }, { projection: { userId: 1 } });
    if (!sponsor) return;

    const message =
      status === "signed"
        ? `Your bill "${bill.title}" has passed the Dáil and is now law.`
        : `Your bill "${bill.title}" failed to pass the Dáil.`;

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
 * Ireland national lifecycle: single Dáil vote → immediate enactment on pass,
 * failed on reject. The Seanad is excluded from the player loop (design §3.3), so
 * there is no second chamber. Reproduces the phase previously in
 * ieBillLifecycle.ts; the engine additionally scopes votes to current seat
 * holders (#0836/#0982).
 */
export const IE_NATIONAL_CONFIG: BillLifecycleConfig = {
  country: "IE",
  level: "national",
  originChambers: ["dail"],
  notifySponsor: notifyIESponsor,
  stages: [
    {
      kind: "chamberVote",
      status: "active",
      voteField: "votes",
      officeTypeFor: (b) => b.currentChamber, // Dáil TDs hold officeType "dail"
      passRule: "simpleMajority", // nat/priv two-thirds handled by the engine evaluator
      onReject: "fail",
      onPassStatus: "signed", // terminal — enacts immediately
      votingDurationHours: VOTING_HOURS,
    },
  ],
};
