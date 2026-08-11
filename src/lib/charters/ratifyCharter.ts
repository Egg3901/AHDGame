import type { Db, ObjectId } from "mongodb";
import { ObjectId as ObjectIdCtor } from "mongodb";
import type {
  Character,
  PartyCharter,
  PartyCharterPlatform,
  PoliticalParty,
  State,
  StatePartyOrg,
} from "@/lib/db/types";
import { getNextSequentialId } from "@/lib/db/sequentialId";
import { getCountryState } from "@/lib/countryState";
import { vacateDepartedLeadership } from "@/lib/parties/vacateDepartedLeadership";
import { recomputePartyMemberCount } from "@/lib/parties/recomputePartyMemberCount";
import { withdrawFromPartyLeadershipElections } from "@/lib/elections/withdrawFromPartyLeadershipElections";
import { cleanupCaucusParticipationForCharacters } from "@/lib/caucus/cleanupCaucusParticipationForCharacters";
import { getCurrentTurn } from "@/lib/turn/currentTurn";

/**
 * Phase 6 — internal helper called by `signCharter` once the 3-of-3
 * threshold is hit. Spawns the actual `politicalParties` row and
 * transitions the charter to `ratified` with `partyId` set.
 *
 * Default party position fields (`economicPosition`, `socialPosition`)
 * are derived from the charter's economic + social axes scaled from
 * `[-60, +60]` to the existing `[-5, +5]` party-position scale.
 *
 * Idempotent: a charter that's already `ratified` returns its existing
 * `partyId`. Caller is responsible for transactional safety — this
 * helper does not run inside a session.
 *
 * See plan §"Phase 6 — Tasks" 6.2.
 */

/** Convert charter axis [-60, 60] → party position [-5, 5]. */
function axisToPartyPosition(axis: number): number {
  return Math.max(-5, Math.min(5, axis / 12));
}

export interface RatifyCharterResult {
  partyId: string;
  partySequentialId: number;
  /**
   * True when the new party was created in a country with
   * `governmentType: "onePartyState"`, which forces an initial
   * `regimeStatus: "banned"`. The UI uses this to render the
   * dedicated "banned at creation" explanation panel instead of
   * the standard success state.
   */
  bannedAtCreation: boolean;
}

export async function ratifyCharter(
  charterId: ObjectId,
  db: Db,
  now: Date = new Date()
): Promise<RatifyCharterResult> {
  const charter = await db.collection<PartyCharter>("partyCharters").findOne({ _id: charterId });
  if (!charter) {
    throw new Error(`Charter ${charterId.toString()} not found`);
  }
  // Idempotent fast-path: charter already ratified.
  if (charter.status === "ratified" && charter.partyId) {
    const existing = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ sequentialId: Number(charter.partyId), countryId: charter.countryId });
    return {
      partyId: charter.partyId,
      partySequentialId: Number(charter.partyId),
      bannedAtCreation: existing?.regimeStatus === "banned",
    };
  }

  // Founder slot 0 is the "anchor founder" (the proposer; `draftCharter`
  // always puts them here). They anchor the party's geography (home state
  // for the NPP founding cohort) and the cohort favorability baseline, and
  // are stamped as `createdBy` — but they receive NO leadership role.
  // Leadership starts vacant and is decided by the cycle-aligned national
  // leadership elections opened at the end of this function.
  const anchorFounderCharacterId = charter.foundersCharacterIds[0];
  const anchorFounder = anchorFounderCharacterId
    ? await db.collection<Character>("characters").findOne({ _id: anchorFounderCharacterId })
    : null;

  const sequentialId = await getNextSequentialId(db, "party", charter.countryId);
  const partyIdStr = String(sequentialId);

  // One-party-state guard: player-created parties in a one-party country
  // are born banned. Admin can promote them to "approved" later via the
  // Phase 4 regime-status endpoint. Reads runtime governmentType so a
  // post-Stage-4 conversion immediately allows new parties to spawn
  // un-banned.
  const runtime = await getCountryState(db, charter.countryId);
  const regimeStatus: "banned" | null =
    runtime.governmentType === "onePartyState" ? "banned" : null;

  const platform: PartyCharterPlatform = charter.platform;
  const newParty: PoliticalParty = {
    _id: new ObjectIdCtor(),
    sequentialId,
    countryId: charter.countryId,
    name: charter.proposedName,
    abbreviation: charter.proposedAbbr,
    color: "#4f46e5", // neutral indigo until chair customizes
    economicPosition: axisToPartyPosition(platform.economic),
    socialPosition: axisToPartyPosition(platform.social),
    foreignPolicy: axisToPartyPosition(platform.foreignPolicy),
    culture: axisToPartyPosition(platform.culture),
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    memberCount: anchorFounder ? 1 : 0,
    isDefault: false,
    // D5 — new chartered parties start Minor (PS cap 100, grows by region as
    // they reach ≥20% Org). The partyTierTurn phase graduates them to Major
    // once they hold ≥20% Org in ≥⌈regions/3⌉ regions.
    tier: "minor",
    regimeStatus,
    createdBy: anchorFounder?._id ?? null,
    treasury: 0,
    nationalTaxRate: 0,
    politicalStrength: 0,
    // 2026-05-22 treasury-two-person-approval: chartered parties
    // default to double-approval at ratification, matching default-
    // party seeds.
    transactionApprovalMode: "double",
    createdAt: now,
    updatedAt: now,
  };
  await db.collection<PoliticalParty>("politicalParties").insertOne(newParty);

  // Atomic claim: only one concurrent caller wins this transition. The
  // status guard `pending-signatures` ensures double-ratification by
  // racing 3rd-signers cannot double-spawn parties.
  const claim = await db.collection<PartyCharter>("partyCharters").findOneAndUpdate(
    { _id: charterId, status: "pending-signatures" },
    {
      $set: {
        status: "ratified",
        partyId: partyIdStr,
        ratifiedAt: now,
        // Clear deadlines per schema invariant: ratified charters have no expiry.
        expiresAt: null,
        expiresOnTurn: null,
        founderReplacementDeadline: null,
        founderReplacementDeadlineTurn: null,
        updatedAt: now,
      },
    },
    { returnDocument: "before" }
  );

  if (!claim) {
    // Lost the race — another caller already ratified. Roll back the
    // party row we just inserted (the winner's row is the canonical one)
    // and return the winning ratification's partyId.
    await db.collection<PoliticalParty>("politicalParties").deleteOne({ _id: newParty._id });
    const winner = await db.collection<PartyCharter>("partyCharters").findOne({ _id: charterId });
    if (winner?.status === "ratified" && winner.partyId) {
      const winningParty = await db
        .collection<PoliticalParty>("politicalParties")
        .findOne({ sequentialId: Number(winner.partyId), countryId: charter.countryId });
      return {
        partyId: winner.partyId,
        partySequentialId: Number(winner.partyId),
        bannedAtCreation: winningParty?.regimeStatus === "banned",
      };
    }
    throw new Error(`Charter ${charterId.toString()} ratification race lost without winner`);
  }

  // Phase 6 closeout fix F1 — create one StatePartyOrg row per state in
  // the country so the new party can participate in state-level politics
  // (org / pressure / Reg). Mirrors the legacy POST's initial-org
  // provisioning but starts every state at 0% org with the chair's home
  // state flagged `hasPresence: true`.
  const homeState = anchorFounder?.homeState ?? null;
  const states = await db
    .collection<State>("states")
    .find({ countryId: charter.countryId })
    .project<{ _id: string }>({ _id: 1 })
    .toArray();
  if (states.length > 0) {
    const orgRecords: StatePartyOrg[] = states.map((state) => ({
      _id: `${state._id}_${partyIdStr}`,
      stateId: state._id,
      partyId: partyIdStr,
      countryId: charter.countryId,
      organization: 0,
      politicalStrength: 0,
      chairId: null,
      viceChairId: null,
      treasurerId: null,
      treasury: 0,
      stateTaxRate: 0,
      hasPresence: homeState !== null && state._id === homeState,
      createdAt: now,
      updatedAt: now,
    }));
    // Use ordered:false so existing partial provisioning (e.g. from a
    // crashed earlier ratify attempt) doesn't fail the whole insert.
    try {
      await db
        .collection<StatePartyOrg>("statePartyOrg")
        .insertMany(orgRecords, { ordered: false });
    } catch {
      // Duplicate-key exceptions on retry are expected; partyOrg rows are
      // idempotent by `_id = `${stateId}_${partyId}`. Other errors bubble
      // through — but ratification has already succeeded, so we log and
      // continue rather than fail the whole flow.
    }
  }

  // Phase 6 closeout fix F2 — join all 3 founders to the new party. Each
  // founder co-signed the charter; ratification commits them to membership.
  // Old-party memberCounts are decremented; mismatched primary candidacies
  // are withdrawn so the party-switch is clean.
  //
  // Founder identity is `characterId` so the lookup is direct (no
  // userId→characters pivot). This also makes multi-character users work
  // correctly: each chartered character moves to the new party
  // independently, even if two of them share a userId.
  const founderCharacters = await db
    .collection<Character>("characters")
    .find({ _id: { $in: charter.foundersCharacterIds } })
    .toArray();
  // Founders join the new party now — stamp the tenure anchor (leadershipTenure.ts).
  const charterCurrentTurn = await getCurrentTurn(db);
  // Group departing founders by their former party so per-party cleanup
  // (memberCount recompute, leadership-election withdrawal) runs once each.
  const departuresByOldParty = new Map<number, ObjectId[]>();
  for (const ch of founderCharacters) {
    const oldPartyStr = ch.party;
    const oldPartySeqId =
      oldPartyStr && oldPartyStr !== "independent" ? parseInt(oldPartyStr, 10) : Number.NaN;
    if (oldPartyStr === partyIdStr) continue;
    await db.collection<Character>("characters").updateOne(
      { _id: ch._id },
      {
        $set: {
          party: partyIdStr,
          partyJoinedAt: now,
          partyJoinedTurn: charterCurrentTurn,
          // Founding a party is a join — stamp the durable party-switch
          // cooldown anchor too (mirrors the join route), so a founder who
          // later goes independent still carries it and can't dodge the 24h
          // join cooldown via a leave→rejoin hop. See antiAbuseGuards.ts.
          lastPartySwitchAt: now,
          updatedAt: now,
        },
      }
    );
    if (!Number.isNaN(oldPartySeqId)) {
      const departing = departuresByOldParty.get(oldPartySeqId) ?? [];
      departing.push(ch._id);
      departuresByOldParty.set(oldPartySeqId, departing);
    }
    try {
      const { withdrawFromMismatchedPrimaries } = await import("@/lib/utils/electionCandidacy");
      await withdrawFromMismatchedPrimaries(ch._id, partyIdStr);
    } catch {
      /* non-fatal */
    }
  }
  // Drop former-party caucus membership for every founder who actually moved.
  // Charter ratification is a party-switch and must clear factionId the same
  // way leave/join do, or founders stay blocked from founding caucuses in the
  // new party (ticket #1030).
  const foundersWhoMoved = founderCharacters
    .filter((ch) => ch.party !== partyIdStr)
    .map((ch) => ch._id);
  if (foundersWhoMoved.length > 0) {
    try {
      await cleanupCaucusParticipationForCharacters(db, foundersWhoMoved, {
        removeMembership: true,
        membershipStatus: "left",
        now,
      });
    } catch {
      /* non-fatal — party spawn already succeeded */
    }
  }
  // Per former party, now that the founders have left:
  //   (a) Recompute memberCount from live membership. A blind `$inc: -1` per
  //       founder drove the stored count negative on an already-drifted party
  //       (#0701); recomputing is authoritative and can never go negative.
  //   (b) Tear the founders out of that party's leadership races — withdraw
  //       their candidacies and delete their (and votes-for-them) ballots, so
  //       they no longer stand for chair/VC/treasurer of a party they left.
  for (const [oldSeqId, departingIds] of departuresByOldParty) {
    await recomputePartyMemberCount(db, charter.countryId, oldSeqId);
    await withdrawFromPartyLeadershipElections(
      db,
      departingIds,
      String(oldSeqId),
      charter.countryId
    );
  }
  // F2b (#0701 split-cleanup) — vacate any leadership slot on the founders'
  // FORMER parties that still points at a departing founder. Founding a new
  // party is a party-switch, but the charter flow only moved `character.party`
  // and decremented memberCount — it never cleared leadership, leaving e.g. a
  // party whose entire leadership chartered a breakaway still listing those
  // three as its own chair / VC / treasurer. The just-created party is still
  // excluded defensively, though it now starts with vacant leadership and
  // has nothing to sweep.
  await vacateDepartedLeadership(
    db,
    charter.countryId,
    founderCharacters.map((ch) => ch._id),
    { exceptPartySequentialId: sequentialId }
  );

  // memberCount on the new party reflects all founder characters (the
  // initial anchor-only count from the insert was a placeholder). Correct
  // it here.
  await db
    .collection<PoliticalParty>("politicalParties")
    .updateOne({ _id: newParty._id }, { $set: { memberCount: founderCharacters.length } });

  // Open the party's first national leadership elections immediately so
  // there is no window with neither leaders nor an open election. The
  // creator is idempotent (only fills missing party+position pairs) and
  // aligns endTurn to the shared default cycle. The hourly leadership-
  // voting phase remains the safety net if this fails.
  try {
    const { createMissingNationalElections } = await import("@/lib/nationalPartyElections");
    await createMissingNationalElections(charterCurrentTurn, undefined, now, charter.countryId);
  } catch {
    /* non-fatal — the hourly phase will create them */
  }

  // Notify every founder that the party is live. Non-fatal. Leadership
  // starts vacant, so instead of role announcements every founder is
  // pointed at the freshly opened leadership elections.
  try {
    const { createNotification } = await import("@/lib/notifications");
    for (const ch of founderCharacters) {
      if (!ch.userId) continue;
      const message =
        `The charter passed 3-of-3 and the party is now live. Leadership starts vacant — ` +
        `leadership elections are open on the party page, so declare your candidacy.`;
      await createNotification({
        userId: ch.userId,
        type: "charter_ratified",
        title: `${charter.proposedName} is now ratified`,
        message,
        metadata: {
          charterId: charter._id.toString(),
          partyId: partyIdStr,
          countryId: charter.countryId,
          href: `/country/${charter.countryId.toLowerCase()}/parties/${partyIdStr}`,
        },
      });
    }
  } catch {
    /* non-fatal */
  }

  // F4 (2026-05-22 redesign): spawn the founding NPP cohort so the newly-
  // ratified party has presence beyond its 3 chartered characters.
  //
  // Cohort size = 3 (down from legacy 5):
  //   - NPP 1 always spawns in the anchor founder's home state with the
  //     charter's platform positions (the implicit "anchor" of the party's
  //     geography).
  //   - NPPs 2 & 3 come from `charter.foundingCohort` — player-picked states
  //     (validated against home-state adjacency at draft time) and player-
  //     chosen per-NPP positions. Legacy charters drafted before the F4
  //     redesign have no `foundingCohort` and fall back to all 3 in the
  //     anchor founder's home state at platform positions — matches the
  //     legacy spawn-on-creation behavior.
  //   - Same-state double-up is allowed (picker permits picking the home
  //     state again or repeating an adjacent state).
  //
  // All 3 cohort NPPs are seeded as "true believers": high loyalty (75-95),
  // modest ambition (40-55), moderate stubbornness (40-60). Favorability
  // tracks the anchor founder's favorability ±5 — at ratification the
  // proposing founder is the party's public face, so their approval is the
  // natural baseline for founding cadre.
  //
  // Non-fatal: NPP spawning failures don't roll back ratification.
  try {
    if (anchorFounder?.homeState) {
      const { generateUniqueNPPName } = await import("@/lib/npp/nameGenerator");
      const { selectPoliticianImage, weightedRandomEthnicity } =
        await import("@/lib/npp/generator");
      const { getNextSequentialId } = await import("@/lib/db/sequentialId");
      const existingNPPs = await db
        .collection("npps")
        .find({ retiredAt: null })
        .project<{ name: string }>({ name: 1 })
        .toArray();
      const existingNames = new Set(existingNPPs.map((n) => n.name));

      const platformEcon = axisToPartyPosition(charter.platform.economic);
      const platformSoc = axisToPartyPosition(charter.platform.social);

      // Pick #1 is always the fixed home-state anchor with platform positions.
      const fixedPick = {
        stateId: anchorFounder.homeState,
        economicPosition: platformEcon,
        socialPosition: platformSoc,
      };
      // Picks #2 and #3 come from the proposer's draft picks. Legacy drafts
      // (no foundingCohort) reuse the fixed home-state anchor — equivalent
      // to "all 3 in home state" with platform positions.
      const cohortSpecs: (typeof fixedPick)[] = charter.foundingCohort
        ? [fixedPick, ...charter.foundingCohort]
        : [fixedPick, { ...fixedPick }, { ...fixedPick }];

      // The anchor founder's favorability is the de facto party baseline at
      // ratification (no party-level favorability field exists yet).
      // Defensive: if they somehow lack favorability, fall back to neutral 50.
      const baselineFavorability =
        typeof anchorFounder.favorability === "number" ? anchorFounder.favorability : 50;

      const npcDocs = [];
      for (let i = 0; i < cohortSpecs.length; i++) {
        const spec = cohortSpecs[i]!;
        let name = generateUniqueNPPName(Array.from(existingNames), 100, charter.countryId);
        if (!name) name = `Founding ${charter.proposedAbbr.toUpperCase()} ${i + 1}`;
        existingNames.add(name);
        const sequentialId = await getNextSequentialId(db, "npp");
        const gender: "male" | "female" = Math.random() < 0.5 ? "male" : "female";
        const ethnicity = weightedRandomEthnicity(charter.countryId);
        const avatarUrl = selectPoliticianImage(charter.countryId, gender, ethnicity, name);
        npcDocs.push({
          _id: new ObjectIdCtor(),
          sequentialId,
          name,
          countryId: charter.countryId,
          homeState: spec.stateId,
          gender,
          ethnicity,
          ...(avatarUrl && { avatarUrl }),
          politicalInfluence: 10,
          favorability: Math.max(0, Math.min(100, baselineFavorability + (Math.random() * 10 - 5))),
          policies: {
            economic: spec.economicPosition,
            social: spec.socialPosition,
          },
          party: partyIdStr,
          currentOffice: null,
          personality: {
            // True believer profile per F4 redesign:
            loyalty: 75 + Math.random() * 20, // [75, 95)
            ambition: 40 + Math.random() * 15, // [40, 55)
            stubbornness: 40 + Math.random() * 20, // [40, 60)
          },
          generatedAt: now,
          retiredAt: null,
          influenceState: { totalTimesInfluenced: 0 },
          funds: 0,
          donorBaseLevel: 0,
          actionPoints: 0,
          lastActionProcessedTurn: 0,
          archetypeApprovals: {},
          electionCooldowns: {},
          createdAt: now,
          updatedAt: now,
        });
      }
      await db.collection("npps").insertMany(npcDocs);
      // Bump the party's memberCount to reflect the cohort.
      await db
        .collection<PoliticalParty>("politicalParties")
        .updateOne({ _id: newParty._id }, { $inc: { memberCount: npcDocs.length } });
    }
  } catch {
    /* non-fatal */
  }

  return {
    partyId: partyIdStr,
    partySequentialId: sequentialId,
    bannedAtCreation: regimeStatus === "banned",
  };
}
