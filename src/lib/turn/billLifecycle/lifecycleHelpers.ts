/**
 * Shared helpers for the bill-lifecycle engine and the (legacy) US processor.
 * Extracted from billLifecycle.ts so both it and the unified engine can use them
 * without a circular import.
 */
import { ObjectId } from "mongodb";
import { createNotifications } from "@/lib/notifications";
import { didPass } from "@/lib/billLifecycleHelpers";
import type { Bill, BillStatus, Character, ElectedOfficial } from "@/lib/db/types";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { getChamberKeyForOfficeType } from "@/lib/legislature/chamberOfficeType";

type LifecycleDb = Awaited<ReturnType<typeof import("@/lib/mongodb").getDb>>;

/**
 * The chamber's own name, from the country's config — "House of Commons", not
 * "Senate". Falls back to the office type so an unknown key still reads sensibly.
 */
function chamberNameForOfficeType(countryId: string, officeType: string): string {
  const config = getCountryConfig(countryId as CountryId);
  if (!config) return officeType;
  const chamberKey = getChamberKeyForOfficeType(countryId as CountryId, officeType);
  const { lowerChamber, upperChamber } = config.legislature;
  if (chamberKey === lowerChamber.key) return lowerChamber.name;
  if (upperChamber && chamberKey === upperChamber.key) return upperChamber.name;
  return officeType;
}

/**
 * When a bill has been filibustered, it requires 3/5 of the votes cast (for +
 * against + abstain) to be "for" rather than a simple majority. Quorum-based
 * rather than seat-based: senators who never vote don't count against the bill,
 * but an abstention still raises the bar (#3199).
 */
export async function didPassWithFilibusterCheck(
  db: LifecycleDb,
  bill: Bill,
  votesFor: number,
  votesAgainst: number,
  votesAbstain: number = 0
): Promise<boolean> {
  if (!bill.filibusterInvocations?.length) return didPass(votesFor, votesAgainst);

  const filibusterPolicy = await db
    .collection("statePolicies")
    .findOne({ stateId: "federal", legislationTypeId: "senate_filibuster_rules" });
  if (filibusterPolicy && filibusterPolicy.effectDirection === -1) {
    return didPass(votesFor, votesAgainst);
  }

  const votesCast = votesFor + votesAgainst + votesAbstain;
  if (votesCast === 0) return false;
  const clotureThreshold = Math.ceil((3 / 5) * votesCast);
  return votesFor >= clotureThreshold;
}

/** Notify the bill country's sitting President (player) that a bill is on their desk. No-op if vacant or NPP. */
export async function notifyPresidentBillAwaitingSignature(
  db: LifecycleDb,
  bill: Pick<Bill, "_id" | "title" | "countryId">
): Promise<void> {
  const presidentOfficial = await db.collection<ElectedOfficial>("electedOfficials").findOne({
    countryId: bill.countryId ?? "US",
    officeType: "president",
    characterId: { $ne: null },
    isNPP: { $ne: true },
  });
  if (!presidentOfficial?.characterId) return;

  const presidentChar = await db
    .collection<Character>("characters")
    .findOne({ _id: presidentOfficial.characterId }, { projection: { userId: 1 } });
  if (!presidentChar?.userId) return;

  await createNotifications([
    {
      userId: presidentChar.userId,
      type: "bill_enrolled",
      title: "Bill Awaiting Your Signature",
      message: `"${bill.title}" passed Congress and is on your desk. Sign or veto it before the deadline, or it may become law without your signature.`,
      metadata: {
        billId: bill._id.toString(),
        recipientCharacterId: presidentOfficial.characterId.toString(),
      },
    },
  ]);
}

/** Notify all seated members of a chamber that a bill vote has opened. */
export async function notifyChambersVoteOpen(
  db: LifecycleDb,
  bill: Bill,
  chamberType: string
): Promise<void> {
  const officials = await db
    .collection<ElectedOfficial>("electedOfficials")
    // ⚠️ `countryId` was missing. The US, BR and others all share the house/senate
    // office-type keys (the collision `npp/billVoting.ts` works around per bill), so
    // this notified legislators in EVERY country that used the same key. Pre-existing,
    // but PR3 fans this out across every qualifying member of a bloc, which would turn
    // a latent leak into Brazilian legislators being pinged about a NATO bill.
    .find({
      countryId: bill.countryId ?? "US",
      officeType: chamberType,
      characterId: { $ne: null },
      isNPP: { $ne: true },
    })
    .toArray();

  const charIds = officials
    .map((o) => o.characterId)
    .filter((id): id is ObjectId => id instanceof ObjectId);

  const chars = await db
    .collection<Character>("characters")
    .find({ _id: { $in: charIds } }, { projection: { _id: 1, userId: 1 } })
    .toArray();

  // House/Senate was hardcoded, so a Commons vote announced itself as the Senate.
  // Harmless while only the US reached this; PR3 fans it across a whole bloc.
  const chamberName = chamberNameForOfficeType(bill.countryId ?? "US", chamberType);

  await createNotifications(
    chars.map((c) => ({
      userId: c.userId,
      type: "bill_vote_open",
      title: "Vote Now Open",
      message: `Voting on "${bill.title}" is now open in the ${chamberName}.`,
      metadata: { billId: bill._id.toString(), recipientCharacterId: c._id.toString() },
    }))
  );
}

/** Notify the sponsor (and co-sponsors) of a bill outcome. */
export async function notifySponsor(
  db: LifecycleDb,
  bill: Bill,
  type: Bill["status"]
): Promise<void> {
  const notifyIds: ObjectId[] = [];
  if (bill.sponsorId) notifyIds.push(bill.sponsorId);
  for (const cs of bill.coSponsors ?? []) notifyIds.push(cs.characterId);

  if (notifyIds.length === 0) return;

  const chars = await db
    .collection<Character>("characters")
    .find({ _id: { $in: notifyIds } }, { projection: { _id: 1, userId: 1 } })
    .toArray();

  const notifMap: Record<
    BillStatus,
    {
      nType:
        | "bill_passed_chamber"
        | "bill_failed_chamber"
        | "bill_enrolled"
        | "bill_signed"
        | "bill_vetoed";
      title: string;
      message: string;
    }
  > = {
    passed_origin: {
      nType: "bill_passed_chamber",
      title: "Bill Passed Chamber",
      message: `"${bill.title}" passed the ${bill.originChamber === "house" ? "House" : "Senate"} and moves to the other chamber.`,
    },
    active_both: {
      // Entering a concurrent vote is not a chamber PASSING — both chambers open at
      // once. The sponsor is told the floor is open, not that anything advanced.
      nType: "bill_passed_chamber",
      title: "Bill Before Both Chambers",
      message: `"${bill.title}" is before both chambers at once. Each votes separately, and both must pass.`,
    },
    active_other: {
      nType: "bill_passed_chamber",
      title: "Bill Passed Chamber",
      message: `"${bill.title}" passed the ${bill.originChamber === "house" ? "House" : "Senate"} and moves to the other chamber.`,
    },
    enrolled: {
      nType: "bill_enrolled",
      title: "Bill Enrolled",
      message: `"${bill.title}" passed both chambers and has been sent to the President.`,
    },
    signed: {
      nType: "bill_signed",
      title: "Bill Signed Into Law",
      message: `"${bill.title}" has been signed into law.`,
    },
    vetoed: {
      nType: "bill_vetoed",
      title: "Bill Vetoed",
      message: `"${bill.title}" was vetoed by the President.`,
    },
    failed: {
      nType: "bill_failed_chamber",
      title: "Bill Failed",
      // The doc handed to the notifier is the pre-transition one, so a concurrent
      // bill still reads `active_both` here. Naming a chamber would be a coin flip:
      // `currentChamber` is the lower house on every one of these bills, whichever
      // chamber actually voted it down.
      message:
        bill.status === "active_both"
          ? `"${bill.title}" failed. A bill before both chambers has to clear both, and at least one voted it down.`
          : `"${bill.title}" failed to pass the ${bill.currentChamber === "house" ? "House" : "Senate"}.`,
    },
    proposed: { nType: "bill_passed_chamber", title: "", message: "" },
    active: { nType: "bill_passed_chamber", title: "", message: "" },
    withdrawn: { nType: "bill_passed_chamber", title: "", message: "" },
    veto_override: {
      nType: "bill_vetoed",
      title: "Bill Vetoed — Override Vote Open",
      message: `"${bill.title}" was vetoed. Congress has 24 hours to attempt a veto override.`,
    },
    override_failed: {
      nType: "bill_failed_chamber",
      title: "Veto Override Failed",
      message: `The veto override for "${bill.title}" failed. The bill is dead.`,
    },
    filibustered: { nType: "bill_passed_chamber", title: "", message: "" },
    // JP-specific statuses
    cabinet_review: { nType: "bill_passed_chamber", title: "", message: "" },
    override_shugiin: {
      nType: "bill_passed_chamber",
      title: "Shugiin Override Vote Open",
      message: `"${bill.title}" was rejected by the Sangiin. The Shugiin has 24 hours to attempt a 2/3 override.`,
    },
  };

  const info = notifMap[type];
  if (!info?.title) return;

  await createNotifications(
    chars.map((c) => ({
      userId: c.userId,
      type: info.nType,
      title: info.title,
      message: info.message,
      metadata: { billId: bill._id.toString(), recipientCharacterId: c._id.toString() },
    }))
  );
}

export async function awardLawmakerAchievementForSponsor(
  bill: Pick<Bill, "sponsorId">
): Promise<void> {
  if (!bill.sponsorId) return;

  try {
    const { awardAchievement, resolveUserIdFromCharacter } = await import("@/lib/achievements");
    const sponsorUserId = await resolveUserIdFromCharacter(bill.sponsorId);
    if (sponsorUserId) {
      await awardAchievement(sponsorUserId, "lawmaker", bill.sponsorId);
    }
  } catch (e) {
    console.error("Achievement check failed:", e);
  }
}

export type { LifecycleDb };
