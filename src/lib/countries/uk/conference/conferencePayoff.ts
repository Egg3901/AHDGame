import { type Db } from "mongodb";
import { createNotification } from "@/lib/notifications";
import { createSystemNewsPost } from "@/lib/news";
import { recordAudit } from "@/lib/audit/recordAudit";
import type { PartyGroupFavorability } from "@/lib/db/types/partyGroupFavorability";
import {
  getUKPartyConferencesCollection,
  getUKPartyPlatformsCollection,
} from "@/lib/db/collections/ukPartyConferences";
import { pledgeCatalogFor } from "@/lib/uk/manifesto/pledgeCatalog";
import { resolvePartyPsCap, resolvePartyTier } from "@/lib/parties/partyTier";
import { NATIONAL_PS_CAP } from "@/lib/politicalStrength/strengthConstants";
import {
  CONFERENCE_APPROVAL_DELTA,
  CONFERENCE_COHESION_PS,
  CONFERENCE_MAX_PAYOFF_GROUPS,
  CONFERENCE_PAYOFF_DURATION_TURNS,
  conferenceYearForTurn,
  conferenceYearStartTurn,
  isConferencePayoffEnabled,
  payoffGroupsForPledges,
} from "@/lib/uk/conference/rules";
import {
  conferenceDocId,
  conferenceHistoryEntry,
  pushConferenceHistory,
} from "@/lib/uk/conference/conferenceStore";
import type { UKPartyConference } from "@/lib/uk/conference/types";
import type { Character, PoliticalParty } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { partySeqIdOf } from "./conferenceShared";

export interface ConferencePayoff {
  applied: boolean;
  approvalGroups: number;
  cohesionPs: number;
}

/**
 * Pure gate: payoff work still owed? The turn driver uses this shape
 * (payoffDue with no settle marker) so crashed payoffs resume on the next
 * tick instead of stranding a claimed-but-unapplied row.
 */
export function conferencePayoffNeedsSettle(doc: UKPartyConference): boolean {
  return doc.payoffDue === true && doc.payoffSettledTurn == null;
}

function cohesionGrantFor(party: PoliticalParty): number {
  const tier = resolvePartyTier(party);
  const cap = resolvePartyPsCap(tier, party.psCapEarnedRegions?.length ?? 0, NATIONAL_PS_CAP);
  return Math.max(0, Math.min(CONFERENCE_COHESION_PS, cap - (party.politicalStrength ?? 0)));
}

/** Payoff intent from live state, fixed once at claim and replayed thereafter. */
async function computePayoffIntent(
  db: Db,
  countryId: CountryId,
  party: PoliticalParty,
  proposal: UKPartyConference["proposal"]
): Promise<{ grant: number; groups: string[] }> {
  const partyNow =
    (await db.collection<PoliticalParty>("politicalParties").findOne({ _id: party._id })) ?? party;
  let groups: string[] = [];
  if (proposal && isConferencePayoffEnabled(process.env.UK_CONFERENCE_PAYOFF)) {
    const catalog = pledgeCatalogFor(countryId);
    const salience = new Map(catalog.map((e) => [e.id, Object.keys(e.salienceByGroup ?? {})]));
    groups = payoffGroupsForPledges(proposal.pledgeIds, salience).slice(
      0,
      CONFERENCE_MAX_PAYOFF_GROUPS
    );
  }
  return { grant: cohesionGrantFor(partyNow), groups };
}

/**
 * Apply the completion payoff exactly once per conference: favorability rows
 * for the ratified platform's salient groups (gated by UK_CONFERENCE_PAYOFF
 * until worldsim calibration) plus a PS credit clamped at the party's tier
 * cap. Claim + reconcile protocol:
 *
 * 1. Claim: one guarded write fixes the payoff INTENT (cohesion grant from
 *    the claim-time party, approval groups from the ratified proposal) and
 *    marks the row claimed. Resumes replay the same intent, never a
 *    recomputation from drifted state.
 * 2. Approval rows reconcile via upserts keyed by
 *    (sourceConferenceId, groupId): replays converge, concurrent writers
 *    cannot duplicate.
 * 3. The cohesion credit lands in ONE conditional party write that sets the
 *    `lastConferencePayoffId` receipt atomically with the `$inc`: replays
 *    and concurrent callers match zero documents and cannot double-credit.
 * 4. Settle: a guarded write flips `payoffSettledTurn` only after every
 *    effect verifies durable. Returns applied:true solely to the settler,
 *    so turn telemetry counts each payoff once.
 */
export async function applyConferencePayoff(
  db: Db,
  countryId: CountryId,
  party: PoliticalParty,
  doc: UKPartyConference,
  currentTurn: number,
  now: Date
): Promise<ConferencePayoff> {
  const none: ConferencePayoff = { applied: false, approvalGroups: 0, cohesionPs: 0 };
  const collection = getUKPartyConferencesCollection(db);
  const fresh = (await collection.findOne({ _id: doc._id })) ?? doc;
  if (!conferencePayoffNeedsSettle(fresh)) return none;

  let working = fresh;
  if (working.payoffAppliedTurn == null) {
    const intent = await computePayoffIntent(db, countryId, party, working.proposal);
    const claimed = await collection.findOneAndUpdate(
      { _id: doc._id, payoffDue: true, payoffAppliedTurn: null },
      {
        $set: {
          payoffAppliedTurn: currentTurn,
          payoffCohesionPs: intent.grant,
          payoffApprovalGroups: intent.groups,
          updatedAt: now,
        },
      },
      { returnDocument: "after" }
    );
    // A miss means a concurrent caller owns the claim now; it (or a later
    // tick) settles, so this call stands down instead of duplicating work.
    if (!claimed) return none;
    working = claimed;
  }

  if (working.payoffCohesionPs == null || working.payoffApprovalGroups == null) {
    // Pre-intent legacy row: the old claim stamped no intent, so fix it once
    // from current state. Every effect downstream is idempotent or
    // single-winner, so concurrent fixers converge on the re-read intent.
    const intent = await computePayoffIntent(db, countryId, party, working.proposal);
    await collection.updateOne(
      { _id: working._id },
      {
        $set: {
          payoffCohesionPs: working.payoffCohesionPs ?? intent.grant,
          payoffApprovalGroups: working.payoffApprovalGroups ?? intent.groups,
          updatedAt: now,
        },
      }
    );
    working = (await collection.findOne({ _id: working._id })) ?? working;
  }

  const expectedGroups = working.payoffApprovalGroups ?? [];
  const intentGrant = working.payoffCohesionPs ?? 0;

  for (const groupId of expectedGroups) {
    const row: PartyGroupFavorability = {
      countryId,
      partyId: partySeqIdOf(party),
      groupId,
      favorabilityDelta: CONFERENCE_APPROVAL_DELTA,
      sourceConferenceId: working._id,
      expiresAtTurn: currentTurn + CONFERENCE_PAYOFF_DURATION_TURNS,
      createdAt: now,
    };
    await db
      .collection<PartyGroupFavorability>("partyGroupFavorability")
      .updateOne(
        { sourceConferenceId: working._id, groupId },
        { $setOnInsert: row },
        { upsert: true }
      );
  }

  if (working.payoffCohesionAppliedTurn == null && intentGrant > 0) {
    const partyNow =
      (await db.collection<PoliticalParty>("politicalParties").findOne({ _id: party._id })) ??
      party;
    if ((partyNow.lastConferencePayoffId ?? null) !== working._id) {
      // Reclamp at apply time: the party may have earned PS after the claim
      // fixed the intent, and the tier cap stays binding. A zero effective
      // grant settles as skipped-at-cap below.
      const effective = Math.min(intentGrant, cohesionCapRoom(partyNow));
      if (effective > 0) {
        await db.collection<PoliticalParty>("politicalParties").updateOne(
          { _id: partyNow._id, lastConferencePayoffId: { $ne: working._id } },
          {
            $inc: { politicalStrength: effective },
            $set: { lastConferencePayoffId: working._id, updatedAt: now },
          }
        );
      }
    }
  }

  // Verify every effect before settling; anything still missing stays owed
  // for the next tick instead of being marked done.
  const presentGroups = new Set(
    (
      await db
        .collection<PartyGroupFavorability>("partyGroupFavorability")
        .find({ sourceConferenceId: working._id })
        .toArray()
    ).map((row) => row.groupId)
  );
  const partyCheck =
    (await db.collection<PoliticalParty>("politicalParties").findOne({ _id: party._id })) ?? party;
  const cohesionDone =
    working.payoffCohesionAppliedTurn != null ||
    intentGrant <= 0 ||
    (partyCheck.lastConferencePayoffId ?? null) === working._id ||
    cohesionCapRoom(partyCheck) <= 0;
  if (!expectedGroups.every((groupId) => presentGroups.has(groupId)) || !cohesionDone) {
    return none;
  }

  const settled = await collection.findOneAndUpdate(
    { _id: working._id, payoffSettledTurn: null },
    {
      $set: {
        payoffCohesionAppliedTurn: working.payoffCohesionAppliedTurn ?? currentTurn,
        payoffSettledTurn: currentTurn,
        history: pushConferenceHistory(
          working.history ?? [],
          conferenceHistoryEntry(
            currentTurn,
            "payoffApplied",
            `Well-run conference payoff: +${CONFERENCE_APPROVAL_DELTA} favorability in ${expectedGroups.length} group(s), +${intentGrant} party strength`,
            undefined,
            now
          )
        ),
        updatedAt: now,
      },
    },
    { returnDocument: "after" }
  );
  if (!settled) return none;

  // Everything above is persisted; the chair notice is decorative and must
  // never fail the turn or double-pay on retry.
  try {
    const chair = party.chairId
      ? await db
          .collection<Character>("characters")
          .findOne({ _id: party.chairId }, { projection: { userId: 1, name: 1 } })
      : null;
    if (chair?.userId) {
      await createNotification({
        userId: chair.userId,
        type: "system",
        title: "Conference Concluded",
        message: `Your party conference ratified the standing platform. The party gains +${intentGrant} political strength${expectedGroups.length > 0 ? ` and favorability in ${expectedGroups.length} voter groups` : ""}. The leader will finalise the election manifesto from this platform at dissolution.`,
      });
    }
  } catch {
    // Notification is best-effort; the settle guard already prevents duplicates.
  }
  recordAudit({
    source: "turn",
    category: "party",
    action: "uk.conference.payoffApplied",
    outcome: "ok",
    subject: { type: "party", id: partySeqIdOf(party), name: party.name },
    meta: { conferenceId: doc._id, approvalGroups: expectedGroups.length, cohesionPs: intentGrant },
  });
  return { applied: true, approvalGroups: expectedGroups.length, cohesionPs: intentGrant };
}

/** PS room below the party's tier cap (the binding constraint on the grant). */
function cohesionCapRoom(party: PoliticalParty): number {
  const tier = resolvePartyTier(party);
  const cap = resolvePartyPsCap(tier, party.psCapEarnedRegions?.length ?? 0, NATIONAL_PS_CAP);
  return Math.max(0, cap - (party.politicalStrength ?? 0));
}

/** Standing platforms for every UK party with one (election-handoff read). */
export async function getStandingPlatformsForCountry(
  db: Db,
  countryId: CountryId
): Promise<Map<string, string[]>> {
  const rows = await getUKPartyPlatformsCollection(db).find({ countryId }).toArray();
  return new Map(rows.map((r) => [r.partyId, r.pledgeIds]));
}

/** Conference news hook: system post, fire-and-forget at the call site. */
export async function postConferenceNews(
  partyName: string,
  year: number,
  ratified: boolean
): Promise<void> {
  await createSystemNewsPost(
    ratified
      ? `${partyName} closed its annual conference after ratifying a new standing platform. The leader will finalise the election manifesto from it when an election is called.`
      : `${partyName} closed its annual conference without agreeing a standing platform.`,
    "general",
    {
      title: `${partyName} conference ${year}: ${ratified ? "platform ratified" : "no platform agreed"}`,
    }
  );
}

export { conferenceDocId, conferenceYearForTurn, conferenceYearStartTurn };
