// src/app/api/parties/[id]/whippable-leadership/route.ts
import { NextResponse } from "next/server";
import { handleRouteError, forbidden, notFound } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { getCountryConfig, COUNTRY_CONFIGS } from "@/lib/constants/countries";
import type {
  BillWhip,
  CabinetNomination,
  ElectedOfficial,
  SpeakerElection,
  SpeakerNomination,
  SpeakerVacateMotion,
  HouseLeadershipElection,
  HouseLeadershipNomination,
  SenateLeadershipElection,
  SenateLeadershipNomination,
} from "@/lib/db/types";
import {
  getPMAppointmentVotesCollection,
  getNoConfidenceVotesCollection,
} from "@/lib/db/collections/governmentFormation";
import type { CountryId } from "@/lib/constants/countries";
import { getCabinetWhipChamber, getConfidenceWhipChamber } from "@/lib/partyWhips/constraints";
import { getOfficeTypeForChamber } from "@/lib/legislature/chamberOfficeType";
import {
  summarizePlayerWhips,
  type PlayerWhipSummaryEntry,
} from "@/lib/partyWhips/playerWhipSummary";
import { isVotingDeadlinePassed } from "@/lib/legislature/billVotingWindow";
import { isVoteClosed } from "@/lib/turn/parliamentaryGovernment";
import { isLeadershipElectionClosed } from "@/lib/congress/leadershipElections";
import { impeachmentStageChamberKey } from "@/lib/impeachment/impeachmentTally";
import type { Impeachment } from "@/lib/db/types/impeachment";
import { getGameTime } from "@/lib/time/gameTime";
import { getPartyMap } from "@/lib/db/partyMap";
import { getHouseComposition } from "@/lib/congress/houseComposition";
import { getSenateComposition } from "@/lib/congress/senateComposition";
import {
  buildChamberLeadershipContext,
  isPartyEligible,
  POLICY_BY_ROLE,
  type ChamberLeadershipContext,
} from "@/lib/congress/leadership/rolePolicy";
import {
  houseElectionRoleToLeader,
  senateElectionRoleToLeader,
} from "@/lib/congress/leadership/electionRoleMap";

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

interface CandidacyInfo {
  id: string;
  nomineeName: string;
  nomineeParty?: string;
  votesFor: number;
}

interface WhipSummary {
  existingWhips: Array<{ candidacyId?: string; attemptNumber: number }>;
  canWhip: boolean;
}

interface PlayerWhipSummary {
  existingWhips: PlayerWhipSummaryEntry[];
  canWhip: boolean;
}

interface LeadershipElectionItem {
  id: string;
  type: string;
  chamber: string;
  endsAt: Date;
  candidacies: CandidacyInfo[];
  nppWhip: WhipSummary;
  playerWhip: PlayerWhipSummary;
  // Back-compat aliases for NPP whip — mirror nppWhip.*
  existingWhips: Array<{ candidacyId?: string; attemptNumber: number }>;
  canWhip: boolean;
}

// GET /api/country/[code]/parties/[id]/whippable-leadership — Return federal leadership elections and confidence votes where party NPPs can vote
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404
/**
 * GET /api/parties/[id]/whippable-leadership
 * Returns federal leadership elections where party NPPs can vote
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { code, id: partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const authData = auth.user;

    const db = await getDb();

    // Verify party exists
    const party = await findPartyBySequentialId(db, partyId, countryId);

    if (!party) {
      return NextResponse.json(notFound("Party not found").toJson(), { status: 404 });
    }

    const partyIdStr = String(party.sequentialId);

    // Check authorization - only Chair and Vice Chair
    const characterId = authData.character._id;
    const isChair = party.chairId?.equals(characterId);
    const isViceChair = party.viceChairId?.equals(characterId);
    const isAdmin = authData.isAdmin;

    if (!isChair && !isViceChair && !isAdmin) {
      return NextResponse.json(
        forbidden("Only the Chair or Vice Chair can view whippable elections").toJson(),
        { status: 403 }
      );
    }

    // Get country-specific chamber keys
    const config = getCountryConfig(countryId);
    const upperKey = config.upperElectionSystem
      ? (config.legislature.upperChamber?.key ?? null)
      : null;
    const lowerKey = config.legislature.lowerChamber.key;
    const confidenceChamberKey = getConfidenceWhipChamber(countryId);
    const cabinetChamberKey = getCabinetWhipChamber(countryId);
    const chamberKeys = upperKey ? [upperKey, lowerKey] : [lowerKey];

    // Resolve chamber keys to the office types seated members are stored under.
    // Identical for most countries; CN differs (key "npc" vs office "npcDelegate"),
    // so querying officials by the raw key would match zero delegates and suppress
    // every whippable item (PM/no-confidence/cabinet) for the chair.
    const lowerOfficeType = getOfficeTypeForChamber(countryId, lowerKey);
    const upperOfficeType = upperKey ? getOfficeTypeForChamber(countryId, upperKey) : null;
    const officeTypes = upperOfficeType ? [upperOfficeType, lowerOfficeType] : [lowerOfficeType];

    // Union of NPP and character officials — bills/leadership items should be shown
    // to chair when EITHER audience has members in the chamber.
    const allOfficials = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({
        party: partyIdStr,
        officeType: { $in: officeTypes },
      })
      .toArray();

    // "NPPs" in the variable name is retained for call sites below; it now covers
    // any party member (NPP or character) in the chamber — treat it as "eligible voters".
    const hasLowerNPPs = allOfficials.some((o) => o.officeType === lowerOfficeType);
    const hasUpperNPPs = upperOfficeType
      ? allOfficials.some((o) => o.officeType === upperOfficeType)
      : false;

    // Filter active leadership elections by the game clock so the window
    // boundary matches turn-based resolution (independent of real-time drift).
    const gameTimeForLeadership = await getGameTime();
    const now = gameTimeForLeadership.effectiveNow;
    const currentTurnForLeadership = gameTimeForLeadership.currentTurn;
    const result: Record<string, LeadershipElectionItem[]> = {};
    for (const key of chamberKeys) result[key] = [];

    // Speaker and congressional leadership elections are US-only collections.
    // Skip them entirely for non-US countries.
    const isUS = countryId === COUNTRY_CONFIGS.US.id;

    // Build per-chamber leadership contexts so each leadership election can be
    // filtered by its role's eligibility policy. A chair only sees a race in
    // their whippable list if their party's seated members are actually
    // eligible to vote in it under POLICY_BY_ROLE.
    let houseCtx: ChamberLeadershipContext | null = null;
    let senateCtx: ChamberLeadershipContext | null = null;
    if (isUS) {
      const usPartyMap = await getPartyMap(db, "US");
      const [house, senate] = await Promise.all([
        getHouseComposition(db, usPartyMap),
        getSenateComposition(db, usPartyMap),
      ]);
      houseCtx = buildChamberLeadershipContext({
        composition: house.composition,
        majorityParty: house.majorityParty,
        majorityBloc: house.majorityBloc,
      });
      senateCtx = buildChamberLeadershipContext({
        composition: senate.composition,
        majorityParty: senate.majorityParty,
        majorityBloc: senate.majorityBloc,
      });
    }

    // Get active Speaker election (US only)
    const speakerElection = isUS
      ? await db
          .collection<SpeakerElection>("speakerElections")
          .findOne({ _id: "current", status: "voting" })
      : null;

    // Get the open motion to vacate the chair (US only). Resolution is lazy, so
    // filter on the game clock as well as the status: a motion left in "voting"
    // past its deadline is over and must not appear as whippable.
    const vacateMotionDoc = isUS
      ? await db
          .collection<SpeakerVacateMotion>("speakerVacateMotions")
          .findOne({ _id: "current", status: "voting" })
      : null;
    const vacateMotion =
      vacateMotionDoc && !isLeadershipElectionClosed(vacateMotionDoc, currentTurnForLeadership, now)
        ? vacateMotionDoc
        : null;

    // Get Speaker nominations if election is active
    let speakerNominations: SpeakerNomination[] = [];
    if (
      speakerElection &&
      !isLeadershipElectionClosed(speakerElection, currentTurnForLeadership, now)
    ) {
      speakerNominations = await db
        .collection<SpeakerNomination>("speakerNominations")
        .find({ status: { $in: ["open", "voting"] } })
        .toArray();
    }

    // Get active House leadership elections (US only)
    const houseLeadershipElections = isUS
      ? await db
          .collection<HouseLeadershipElection>("houseLeadershipElections")
          .find({ status: "voting" })
          .toArray()
      : [];

    // Get House leadership nominations
    const activeHouseRoles = houseLeadershipElections
      .filter((e) => !isLeadershipElectionClosed(e, currentTurnForLeadership, now))
      .map((e) => e._id);
    let houseNominations: HouseLeadershipNomination[] = [];
    if (activeHouseRoles.length > 0) {
      houseNominations = await db
        .collection<HouseLeadershipNomination>("houseLeadershipNominations")
        .find({ role: { $in: activeHouseRoles }, status: { $in: ["open", "voting"] } })
        .toArray();
    }

    // Get active Senate leadership elections (US only)
    const senateLeadershipElections = isUS
      ? await db
          .collection<SenateLeadershipElection>("senateLeadershipElections")
          .find({ status: "voting" })
          .toArray()
      : [];

    // Get Senate leadership nominations
    const activeSenateRoles = senateLeadershipElections
      .filter((e) => !isLeadershipElectionClosed(e, currentTurnForLeadership, now))
      .map((e) => e._id);
    let senateNominations: SenateLeadershipNomination[] = [];
    if (activeSenateRoles.length > 0) {
      senateNominations = await db
        .collection<SenateLeadershipNomination>("senateLeadershipNominations")
        .find({ role: { $in: activeSenateRoles }, status: { $in: ["open", "voting"] } })
        .toArray();
    }

    // Get existing national whips for leadership elections
    const existingWhips = await db
      .collection<BillWhip>("billWhips")
      .find({
        targetType: {
          $in: [
            "speakerElection",
            "leadershipElection",
            "pmAppointmentVote",
            "noConfidenceVote",
            "cabinetNomination",
            "speakerVacateMotion",
            "impeachmentVote",
          ],
        },
        partyId: partyIdStr,
        issuedBy: "nationalParty",
      })
      .toArray();

    // Group whips by target, split by audience. Legacy rows without audience → "npp".
    const nppWhipsByTarget = new Map<string, BillWhip[]>();
    const charWhipsByTarget = new Map<string, BillWhip[]>();
    for (const w of existingWhips) {
      const key = `${w.targetType}_${w.targetId}_${w.chamber}`;
      const target = w.audience === "character" ? charWhipsByTarget : nppWhipsByTarget;
      if (!target.has(key)) target.set(key, []);
      target.get(key)!.push(w);
    }

    /**
     * Build the per-audience summaries for a leadership item from the whip maps.
     * NPP cap = 2; character cap = 1.
     */
    const buildSummaries = (key: string, since?: Date) => {
      // Leadership elections reuse a stable _id ("current" for Speaker, the role
      // name for chamber leaders), so whips keyed by targetType_targetId_chamber
      // survive across election instances. Scope to the current instance by
      // dropping whips issued before this election opened (ticket #959).
      const inWindow = (w: BillWhip) => !since || w.createdAt >= since;
      const npp = (nppWhipsByTarget.get(key) ?? []).filter(inWindow);
      const char = (charWhipsByTarget.get(key) ?? []).filter(inWindow);
      const nppSummary: WhipSummary = {
        existingWhips: npp.map((w) => ({
          candidacyId: w.candidacyId?.toString(),
          attemptNumber: w.attemptNumber,
        })),
        canWhip: npp.length < 2,
      };
      const playerSummary: PlayerWhipSummary = {
        existingWhips: summarizePlayerWhips(char, party),
        canWhip: char.length < 1,
      };
      return { nppSummary, playerSummary };
    };

    // Add Speaker election if active and the party is eligible under the
    // Speaker policy (any-seated → any chamber-member party).
    if (
      hasLowerNPPs &&
      speakerElection &&
      !isLeadershipElectionClosed(speakerElection, currentTurnForLeadership, now) &&
      houseCtx &&
      isPartyEligible(POLICY_BY_ROLE.speaker_of_the_house, partyIdStr, houseCtx)
    ) {
      const whipKey = `speakerElection_current_${lowerKey}`;
      const { nppSummary, playerSummary } = buildSummaries(whipKey, speakerElection.startedAt);
      result[lowerKey].push({
        id: "current",
        type: "speaker",
        chamber: lowerKey,
        endsAt: speakerElection.endsAt,
        candidacies: speakerNominations.map((n) => ({
          id: n._id.toString(),
          nomineeName: n.nomineeName,
          nomineeParty: n.nomineeParty,
          votesFor: n.votesFor,
        })),
        nppWhip: nppSummary,
        playerWhip: playerSummary,
        existingWhips: nppSummary.existingWhips,
        canWhip: nppSummary.canWhip,
      });
    }

    // Add the open motion to vacate the chair. Unlike a leadership election
    // this is not gated on a role policy: every party seated in the House votes
    // on it, and its absolute-majority-of-all-seats bar means a party's blocs
    // matter even when it holds no leadership office.
    if (hasLowerNPPs && vacateMotion) {
      const whipKey = `speakerVacateMotion_current_${lowerKey}`;
      const { nppSummary, playerSummary } = buildSummaries(whipKey, vacateMotion.startedAt);
      result[lowerKey].push({
        id: "current",
        type: "speakerVacateMotion",
        chamber: lowerKey,
        endsAt: vacateMotion.endsAt,
        candidacies: [
          {
            id: "current",
            nomineeName: `Motion to vacate ${vacateMotion.targetSpeakerName}`,
            votesFor: 0,
          },
        ],
        nppWhip: nppSummary,
        playerWhip: playerSummary,
        existingWhips: nppSummary.existingWhips,
        canWhip: nppSummary.canWhip,
      });
    }

    // Add open presidential impeachments, on whichever chamber is sitting at the
    // case's current stage. Governor cases are tried by a state legislature and
    // belong to the state party's panel, so they are excluded here.
    const openImpeachments = await db
      .collection<Impeachment>("impeachments")
      .find({ countryId, stage: { $in: ["house", "senate"] }, targetOffice: { $ne: "governor" } })
      .toArray();

    for (const impeachment of openImpeachments) {
      const stageChamber = impeachmentStageChamberKey(impeachment);
      if (!stageChamber || !result[stageChamber]) continue;

      const stageEndsOnTurn =
        impeachment.stage === "house"
          ? impeachment.houseVotingEndsOnTurn
          : impeachment.senateVotingEndsOnTurn;
      if (stageEndsOnTurn != null && currentTurnForLeadership > stageEndsOnTurn) continue;

      // Only offer it to a chair whose members actually sit in that chamber.
      const seated = stageChamber === lowerKey ? hasLowerNPPs : hasUpperNPPs;
      if (!seated) continue;

      const whipKey = `impeachmentVote_${impeachment._id}_${stageChamber}`;
      const { nppSummary, playerSummary } = buildSummaries(whipKey);
      result[stageChamber].push({
        id: impeachment._id.toString(),
        type: "impeachmentVote",
        chamber: stageChamber,
        endsAt: now,
        candidacies: [
          {
            id: impeachment._id.toString(),
            nomineeName:
              impeachment.stage === "house"
                ? `Impeachment of ${impeachment.targetName}`
                : `Trial of ${impeachment.targetName}`,
            votesFor: 0,
          },
        ],
        nppWhip: nppSummary,
        playerWhip: playerSummary,
        existingWhips: nppSummary.existingWhips,
        canWhip: nppSummary.canWhip,
      });
    }

    // Add lower chamber (House) leadership elections — filter each role by its
    // policy so e.g. a non-majority party doesn't see Majority Leader as
    // whippable when its members can't vote there.
    if (hasLowerNPPs && houseCtx) {
      for (const election of houseLeadershipElections) {
        if (isLeadershipElectionClosed(election, currentTurnForLeadership, now)) continue;

        const policy = POLICY_BY_ROLE[houseElectionRoleToLeader(election._id)];
        if (!isPartyEligible(policy, partyIdStr, houseCtx)) continue;

        const electionNominations = houseNominations.filter((n) => n.role === election._id);
        const whipKey = `leadershipElection_${election._id}_${lowerKey}`;
        const { nppSummary, playerSummary } = buildSummaries(whipKey, election.startedAt);

        result[lowerKey].push({
          id: election._id,
          type: election._id,
          chamber: lowerKey,
          endsAt: election.endsAt,
          candidacies: electionNominations.map((n) => ({
            id: n._id.toString(),
            nomineeName: n.nomineeName,
            nomineeParty: n.nomineeParty,
            votesFor: n.votesFor,
          })),
          nppWhip: nppSummary,
          playerWhip: playerSummary,
          existingWhips: nppSummary.existingWhips,
          canWhip: nppSummary.canWhip,
        });
      }
    }

    // Add upper chamber (Senate) leadership elections — same per-role policy
    // filter (Pro Tempore is any-seated; Majority L/W is largest-single-party;
    // Minority L/W is non-coalition).
    if (upperKey && hasUpperNPPs && senateCtx) {
      for (const election of senateLeadershipElections) {
        if (isLeadershipElectionClosed(election, currentTurnForLeadership, now)) continue;

        const policy = POLICY_BY_ROLE[senateElectionRoleToLeader(election._id)];
        if (!isPartyEligible(policy, partyIdStr, senateCtx)) continue;

        const electionNominations = senateNominations.filter((n) => n.role === election._id);
        const whipKey = `leadershipElection_${election._id}_${upperKey}`;
        const { nppSummary, playerSummary } = buildSummaries(whipKey, election.startedAt);

        result[upperKey].push({
          id: election._id,
          type: election._id,
          chamber: upperKey,
          endsAt: election.endsAt,
          candidacies: electionNominations.map((n) => ({
            id: n._id.toString(),
            nomineeName: n.nomineeName,
            nomineeParty: n.nomineeParty,
            votesFor: n.votesFor,
          })),
          nppWhip: nppSummary,
          playerWhip: playerSummary,
          existingWhips: nppSummary.existingWhips,
          canWhip: nppSummary.canWhip,
        });
      }
    }

    // Add active PM appointment and no-confidence votes — all parties can whip these
    if (hasLowerNPPs) {
      const [activePMVotes, activeNCVotes] = await Promise.all([
        getPMAppointmentVotesCollection(db).find({ status: "active", countryId }).toArray(),
        getNoConfidenceVotesCollection(db).find({ status: "active", countryId }).toArray(),
      ]);

      for (const pmv of activePMVotes) {
        if (isVoteClosed(pmv, currentTurnForLeadership, now)) continue;

        const whipKey = `pmAppointmentVote_${pmv._id}_${confidenceChamberKey}`;
        const { nppSummary, playerSummary } = buildSummaries(whipKey);

        result[confidenceChamberKey].push({
          id: pmv._id.toString(),
          type: "pmAppointmentVote",
          chamber: confidenceChamberKey,
          endsAt: pmv.closesAt,
          candidacies: [
            {
              id: pmv._id.toString(),
              nomineeName: pmv.nomineeName,
              nomineeParty: pmv.nomineePartyId,
              votesFor: pmv.votesFor,
            },
          ],
          nppWhip: nppSummary,
          playerWhip: playerSummary,
          existingWhips: nppSummary.existingWhips,
          canWhip: nppSummary.canWhip,
        });
      }

      for (const ncv of activeNCVotes) {
        if (isVoteClosed(ncv, currentTurnForLeadership, now)) continue;

        const whipKey = `noConfidenceVote_${ncv._id}_${confidenceChamberKey}`;
        const { nppSummary, playerSummary } = buildSummaries(whipKey);

        result[confidenceChamberKey].push({
          id: ncv._id.toString(),
          type: "noConfidenceVote",
          chamber: confidenceChamberKey,
          endsAt: ncv.closesAt,
          candidacies: [
            {
              id: ncv._id.toString(),
              nomineeName: `No confidence in ${ncv.targetPmName}`,
              votesFor: ncv.votesFor,
            },
          ],
          nppWhip: nppSummary,
          playerWhip: playerSummary,
          existingWhips: nppSummary.existingWhips,
          canWhip: nppSummary.canWhip,
        });
      }
    }

    // Add active cabinet nominations — senators vote on these
    if (hasUpperNPPs || hasLowerNPPs) {
      const activeNominations = await db
        .collection<CabinetNomination>("cabinetNominations")
        .find({ status: "active", countryId })
        .toArray();

      for (const nom of activeNominations) {
        if (
          isVotingDeadlinePassed(
            nom.votingEndsAt,
            now,
            nom.votingEndsOnTurn,
            currentTurnForLeadership
          )
        ) {
          continue;
        }

        const whipKey = `cabinetNomination_${nom._id}_${cabinetChamberKey}`;
        const { nppSummary, playerSummary } = buildSummaries(whipKey);

        result[cabinetChamberKey] = result[cabinetChamberKey] ?? [];
        result[cabinetChamberKey].push({
          id: nom._id.toString(),
          type: `Cabinet: ${nom.nomineeCharacterName}`,
          chamber: cabinetChamberKey,
          endsAt: nom.votingEndsAt ?? new Date(now.getTime() + 24 * 3_600_000),
          candidacies: [],
          nppWhip: nppSummary,
          playerWhip: playerSummary,
          existingWhips: nppSummary.existingWhips,
          canWhip: nppSummary.canWhip,
        });
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
