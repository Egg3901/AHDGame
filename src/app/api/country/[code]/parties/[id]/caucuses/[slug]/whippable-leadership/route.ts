import { NextResponse } from "next/server";
import { handleRouteError, forbidden, notFound } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { findCaucusBySlug, listCaucusMemberships } from "@/lib/db/caucusLookup";
import { getCountryConfig, COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type {
  BillWhip,
  CabinetNomination,
  ElectedOfficial,
  SpeakerVacateMotion,
} from "@/lib/db/types";
import { isLeadershipElectionClosed } from "@/lib/congress/leadershipElections";
import { impeachmentStageChamberKey } from "@/lib/impeachment/impeachmentTally";
import type { Impeachment } from "@/lib/db/types/impeachment";
import {
  getPMAppointmentVotesCollection,
  getNoConfidenceVotesCollection,
} from "@/lib/db/collections/governmentFormation";
import { getCabinetWhipChamber, getConfidenceWhipChamber } from "@/lib/partyWhips/constraints";
import { officialsCountryScope } from "@/lib/db/electedOfficialScope";
import { getOfficeTypeForChamber } from "@/lib/legislature/chamberOfficeType";
import { isVotingDeadlinePassed } from "@/lib/legislature/billVotingWindow";
import { isVoteClosed } from "@/lib/turn/parliamentaryGovernment";
import { getGameTime } from "@/lib/time/gameTime";
import {
  summarizePlayerWhips,
  type PlayerWhipSummaryEntry,
} from "@/lib/partyWhips/playerWhipSummary";

interface RouteParams {
  params: Promise<{ code: string; id: string; slug: string }>;
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
  existingWhips: Array<{ candidacyId?: string; attemptNumber: number }>;
  canWhip: boolean;
}

// GET /api/country/[code]/parties/[id]/caucuses/[slug]/whippable-leadership — Return confidence and cabinet votes where caucus NPPs can be whipped
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { code, id: partyId, slug } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const authData = auth.user;

    const db = await getDb();
    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      return NextResponse.json(notFound("Party not found").toJson(), { status: 404 });
    }

    const partyIdStr = String(party.sequentialId);
    const resolved = await findCaucusBySlug(db, countryId, partyIdStr, slug);
    if (!resolved) {
      return NextResponse.json(notFound("Caucus not found").toJson(), { status: 404 });
    }

    const { caucus } = resolved;
    const isChair = caucus.chairId?.equals(authData.character._id);
    if (!isChair && !authData.isAdmin) {
      return NextResponse.json(
        forbidden("Only the Caucus Chair can view caucus whip targets").toJson(),
        { status: 403 }
      );
    }

    const memberships = await listCaucusMemberships(db, caucus._id);
    const caucusCharacterIds = memberships
      .filter((membership) => membership.memberType === "character")
      .map((membership) => membership.memberId);
    const caucusNppIds = memberships
      .filter((membership) => membership.memberType === "npp")
      .map((membership) => membership.memberId);

    const config = getCountryConfig(countryId);
    const upperKey = config.upperElectionSystem
      ? (config.legislature.upperChamber?.key ?? null)
      : null;
    const lowerKey = config.legislature.lowerChamber.key;
    const confidenceChamberKey = getConfidenceWhipChamber(countryId);
    const cabinetChamberKey = getCabinetWhipChamber(countryId);
    const chamberKeys = upperKey ? [upperKey, lowerKey] : [lowerKey];

    if (caucusCharacterIds.length === 0 && caucusNppIds.length === 0) {
      const empty: Record<string, LeadershipElectionItem[]> = {};
      for (const chamberKey of chamberKeys) empty[chamberKey] = [];
      return NextResponse.json(empty);
    }

    // Resolve chamber keys to office types (CN: "npc" → "npcDelegate"); keeps
    // result grouping keyed by chamber while matching seated members correctly.
    const lowerOfficeType = getOfficeTypeForChamber(countryId, lowerKey);
    const upperOfficeType = upperKey ? getOfficeTypeForChamber(countryId, upperKey) : null;
    const officeTypes = upperOfficeType ? [upperOfficeType, lowerOfficeType] : [lowerOfficeType];

    const allOfficials = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({
        party: partyIdStr,
        officeType: { $in: officeTypes },
        // Two independent disjunctions: the country scope (bug #0699) and the
        // caucus membership match. They cannot both be a top-level $or, so
        // they are joined under $and.
        $and: [
          officialsCountryScope(countryId),
          {
            $or: [
              ...(caucusCharacterIds.length > 0
                ? [{ characterId: { $in: caucusCharacterIds } }]
                : []),
              ...(caucusNppIds.length > 0 ? [{ nppId: { $in: caucusNppIds } }] : []),
            ],
          },
        ],
      })
      .toArray();

    const hasLowerMembers = allOfficials.some(
      (official) => official.officeType === lowerOfficeType
    );
    const hasUpperMembers = upperOfficeType
      ? allOfficials.some((official) => official.officeType === upperOfficeType)
      : false;

    // Filter active leadership/PM/no-confidence votes by the game clock so the
    // window boundaries match turn-based resolution under drift.
    const gameTimeForLeadership = await getGameTime();
    const now = gameTimeForLeadership.effectiveNow;
    const currentTurnForLeadership = gameTimeForLeadership.currentTurn;
    const result: Record<string, LeadershipElectionItem[]> = {};
    for (const chamberKey of chamberKeys) result[chamberKey] = [];

    const existingWhips = await db
      .collection<BillWhip>("billWhips")
      .find({
        targetType: {
          $in: [
            "pmAppointmentVote",
            "noConfidenceVote",
            "cabinetNomination",
            "speakerVacateMotion",
            "impeachmentVote",
          ],
        },
        partyId: partyIdStr,
        issuedBy: "caucus",
        caucusId: caucus._id,
      })
      .toArray();

    const nppWhipsByTarget = new Map<string, BillWhip[]>();
    const charWhipsByTarget = new Map<string, BillWhip[]>();
    for (const whip of existingWhips) {
      const key = `${whip.targetType}_${whip.targetId}_${whip.chamber}`;
      const target = whip.audience === "character" ? charWhipsByTarget : nppWhipsByTarget;
      if (!target.has(key)) target.set(key, []);
      target.get(key)!.push(whip);
    }

    // `since` scopes a singleton target (the motion to vacate reuses the id
    // "current") to the instance currently open, so whips from a previous
    // motion do not freeze this one's attempt counter (ticket #959).
    const buildSummaries = (key: string, since?: Date) => {
      const inWindow = (whip: BillWhip) => !since || whip.createdAt >= since;
      const npp = (nppWhipsByTarget.get(key) ?? []).filter(inWindow);
      const character = (charWhipsByTarget.get(key) ?? []).filter(inWindow);
      const nppSummary: WhipSummary = {
        existingWhips: npp.map((whip) => ({
          candidacyId: whip.candidacyId?.toString(),
          attemptNumber: whip.attemptNumber,
        })),
        canWhip: npp.length < 2,
      };
      const playerSummary: PlayerWhipSummary = {
        existingWhips: summarizePlayerWhips(character, {
          chairId: caucus.chairId,
          viceChairId: caucus.viceChairId,
        }),
        canWhip: character.length < 2,
      };
      return { nppSummary, playerSummary };
    };

    // The motion to vacate the chair is a US House singleton. Resolution is
    // lazy, so gate on the game clock as well as the status.
    if (hasLowerMembers && countryId === COUNTRY_CONFIGS.US.id) {
      const motion = await db
        .collection<SpeakerVacateMotion>("speakerVacateMotions")
        .findOne({ _id: "current", status: "voting" });
      if (motion && !isLeadershipElectionClosed(motion, currentTurnForLeadership, now)) {
        const whipKey = `speakerVacateMotion_current_${lowerKey}`;
        const { nppSummary, playerSummary } = buildSummaries(whipKey, motion.startedAt);
        result[lowerKey].push({
          id: "current",
          type: "speakerVacateMotion",
          chamber: lowerKey,
          endsAt: motion.endsAt,
          candidacies: [
            {
              id: "current",
              nomineeName: `Motion to vacate ${motion.targetSpeakerName}`,
              votesFor: 0,
            },
          ],
          nppWhip: nppSummary,
          playerWhip: playerSummary,
          existingWhips: nppSummary.existingWhips,
          canWhip: nppSummary.canWhip,
        });
      }
    }

    // Open presidential impeachments, on whichever chamber sits at the case's
    // current stage. Governor cases belong to the state party's panel.
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

      const seated = stageChamber === lowerKey ? hasLowerMembers : hasUpperMembers;
      if (!seated) continue;

      const whipKey = `impeachmentVote_${impeachment._id}_${stageChamber}`;
      const { nppSummary, playerSummary } = buildSummaries(whipKey);
      result[stageChamber].push({
        id: impeachment._id.toString(),
        type: "impeachmentVote",
        chamber: stageChamber,
        // The case stores only a closing TURN, and turns are hourly, so project
        // it forward from the game clock rather than reporting "now".
        endsAt:
          stageEndsOnTurn != null
            ? new Date(now.getTime() + (stageEndsOnTurn - currentTurnForLeadership) * 3_600_000)
            : now,
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

    if (hasLowerMembers) {
      const [activePMVotes, activeNCVotes] = await Promise.all([
        getPMAppointmentVotesCollection(db).find({ status: "active", countryId }).toArray(),
        getNoConfidenceVotesCollection(db).find({ status: "active", countryId }).toArray(),
      ]);

      for (const pmVote of activePMVotes) {
        if (isVoteClosed(pmVote, currentTurnForLeadership, now)) continue;
        const whipKey = `pmAppointmentVote_${pmVote._id}_${confidenceChamberKey}`;
        const { nppSummary, playerSummary } = buildSummaries(whipKey);
        result[confidenceChamberKey].push({
          id: pmVote._id.toString(),
          type: "pmAppointmentVote",
          chamber: confidenceChamberKey,
          endsAt: pmVote.closesAt,
          candidacies: [
            {
              id: pmVote._id.toString(),
              nomineeName: pmVote.nomineeName,
              nomineeParty: pmVote.nomineePartyId,
              votesFor: pmVote.votesFor,
            },
          ],
          nppWhip: nppSummary,
          playerWhip: playerSummary,
          existingWhips: nppSummary.existingWhips,
          canWhip: nppSummary.canWhip,
        });
      }

      for (const ncVote of activeNCVotes) {
        if (isVoteClosed(ncVote, currentTurnForLeadership, now)) continue;
        const whipKey = `noConfidenceVote_${ncVote._id}_${confidenceChamberKey}`;
        const { nppSummary, playerSummary } = buildSummaries(whipKey);
        result[confidenceChamberKey].push({
          id: ncVote._id.toString(),
          type: "noConfidenceVote",
          chamber: confidenceChamberKey,
          endsAt: ncVote.closesAt,
          candidacies: [
            {
              id: ncVote._id.toString(),
              nomineeName: `No confidence in ${ncVote.targetPmName}`,
              votesFor: ncVote.votesFor,
            },
          ],
          nppWhip: nppSummary,
          playerWhip: playerSummary,
          existingWhips: nppSummary.existingWhips,
          canWhip: nppSummary.canWhip,
        });
      }
    }

    if (hasUpperMembers || hasLowerMembers) {
      const activeNominations = await db
        .collection<CabinetNomination>("cabinetNominations")
        .find({ status: "active", countryId })
        .toArray();

      for (const nomination of activeNominations) {
        if (
          isVotingDeadlinePassed(
            nomination.votingEndsAt,
            now,
            nomination.votingEndsOnTurn,
            currentTurnForLeadership
          )
        ) {
          continue;
        }
        const whipKey = `cabinetNomination_${nomination._id}_${cabinetChamberKey}`;
        const { nppSummary, playerSummary } = buildSummaries(whipKey);
        result[cabinetChamberKey] = result[cabinetChamberKey] ?? [];
        result[cabinetChamberKey].push({
          id: nomination._id.toString(),
          type: `Cabinet: ${nomination.nomineeCharacterName}`,
          chamber: cabinetChamberKey,
          endsAt: nomination.votingEndsAt ?? new Date(now.getTime() + 24 * 3_600_000),
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
