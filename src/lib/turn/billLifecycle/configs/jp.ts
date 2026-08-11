import type { Db } from "mongodb";
import { createNotifications } from "@/lib/notifications";
import type { Bill, Character } from "@/lib/db/types";
import { getOfficeTypeForChamber } from "@/lib/legislature/chamberOfficeType";
import type { BillLifecycleConfig, SponsorNotifier } from "../types";

const VOTING_HOURS = 24;

/**
 * Notify a JP bill's sponsor. Diet notifications are free-form per transition;
 * the engine calls this with the transition's target status, so we key the copy
 * on status (best-effort). The legacy resolver had four distinct "failed" copies
 * and per-transition wording; those collapse here (notification copy is not part
 * of the parity contract — createNotifications is fire-and-forget).
 */
const notifyJPSponsor: SponsorNotifier = async (db: Db, bill: Bill, status: Bill["status"]) => {
  if (!bill.sponsorId) return;
  const message =
    status === "active"
      ? "Your cabinet bill passed review and enters the Shugiin for debate."
      : status === "active_other"
        ? "Your bill passed the Shugiin and moves to the Sangiin."
        : status === "override_shugiin"
          ? "Your bill was rejected by the Sangiin. The Shugiin may attempt a 2/3 override."
          : status === "signed"
            ? "Your bill passed the Diet and is now law."
            : status === "failed"
              ? "Your bill failed in the Diet."
              : null;
  if (!message) return;
  try {
    const sponsor = await db
      .collection<Character>("characters")
      .findOne({ _id: bill.sponsorId }, { projection: { userId: 1 } });
    if (!sponsor) return;
    await createNotifications([
      {
        userId: sponsor.userId,
        type: "system",
        title: `Diet Bill: ${bill.title}`,
        message,
        metadata: { billId: bill._id.toString() },
      },
    ]);
  } catch {
    // Non-critical.
  }
};

/**
 * Japan Diet national lifecycle:
 *  - cabinet_review (Cabinet vote, simple majority of votes cast) → pass re-enters
 *    the Shūgiin (`active`, fresh vote) / fail → failed.
 *  - active (Shūgiin) → pass advances to Sangiin (`active_other`) / fail → failed.
 *  - active_other (Sangiin) → pass → signed (no executive veto); reject routes by
 *    origin: sangiin-origin → failed, Shūgiin/cabinet-origin → `override_shugiin`
 *    (fresh Shūgiin vote, Shūgiin whip records cleared).
 *  - override_shugiin (Shūgiin 2/3 of votes cast ≡ legacy didPassOverride) → pass →
 *    signed / fail → failed.
 * Frozen while the JP government is forming (S#17). The engine additionally scopes
 * votes to current seat holders (#0836/#0982).
 */
export const JP_NATIONAL_CONFIG: BillLifecycleConfig = {
  country: "JP",
  level: "national",
  originChambers: ["shugiin", "sangiin", "cabinet"],
  skipWhenGovPending: true,
  notifySponsor: notifyJPSponsor,
  stages: [
    {
      kind: "chamberVote",
      status: "cabinet_review",
      voteField: "votes",
      // Cabinet review is a vote of player-held cabinet positions, not an elected
      // chamber — "cabinet" matches no electedOfficials, so it falls back to the
      // raw votes-cast majority (matching the legacy un-scoped cabinet vote).
      officeTypeFor: () => "cabinet",
      passRule: "simpleMajority",
      onReject: "fail",
      onPassStatus: "active",
      votingDurationHours: VOTING_HOURS,
    },
    {
      kind: "chamberVote",
      status: "active",
      voteField: "votes",
      officeTypeFor: (b) => getOfficeTypeForChamber("JP", b.currentChamber),
      passRule: "simpleMajority",
      onReject: "fail",
      onPassStatus: "active_other",
      votingDurationHours: VOTING_HOURS,
      chamberOnEnter: () => "shugiin", // cabinet → active re-enters the Shūgiin
    },
    {
      kind: "chamberVote",
      status: "active_other",
      voteField: "otherChamberVotes",
      officeTypeFor: (b) => getOfficeTypeForChamber("JP", b.currentChamber),
      passRule: "simpleMajority",
      onReject: "fail",
      // Shūgiin supremacy: sangiin-origin bills cannot be overridden; Shūgiin- or
      // cabinet-origin bills return to the Shūgiin for a 2/3 override.
      onRejectFn: (b) =>
        b.originChamber === "sangiin" ? "fail" : { toStatus: "override_shugiin" },
      onPassStatus: "signed",
      votingDurationHours: VOTING_HOURS,
      chamberOnEnter: () => "sangiin",
    },
    {
      kind: "chamberVote",
      status: "override_shugiin",
      voteField: "votes",
      officeTypeFor: (b) => getOfficeTypeForChamber("JP", b.currentChamber),
      passRule: "twoThirdsCast",
      onReject: "fail",
      onPassStatus: "signed",
      votingDurationHours: VOTING_HOURS,
      chamberOnEnter: () => "shugiin",
      clearWhippedFrom: true,
      onEnterHook: async (db, bill) => {
        // Clear Shūgiin whip records from the original phase so the override is a
        // fresh vote (2-whip allowance + cross-pressure resolver reset).
        await db.collection("billWhips").deleteMany({
          targetType: "bill",
          targetId: (bill as { _id: unknown })._id,
          chamber: "shugiin",
        });
      },
    },
  ],
};
