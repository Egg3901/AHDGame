/**
 * GET /api/country/[code]/executive — Executive data by country.
 * US: proxies to whitehouse logic (President, VP).
 * Parliamentary (UK, JP, DE, IE, CN): PM/Chancellor/Premier from
 *   parliamentaryGovernment + governmentFormations data, including snap-election
 *   and confidence-vote state. Countries with hasLeaderConfidenceModel also
 *   surface a rulingPartyConfidence payload sourced from countryLeaderStates.
 * Other (CA, BR, NG, …): placeholder until the country is fully wired.
 */
import { NextResponse } from "next/server";
import { notFound } from "next/navigation";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth"; // Optional auth — intentionally uses getAuthUser()
import { handleRouteError } from "@/lib/api/errors";
import {
  COUNTRY_CONFIGS,
  isParliamentarySystem,
  supportsSnapElections,
  getHeadOfStateOfficeType,
  type CountryId,
} from "@/lib/constants/countries";
import type { ElectedOfficial, Character, PoliticalParty } from "@/lib/db/types";
import { resolveExecutiveHolder } from "@/lib/elections/resolveExecutiveHolder";
import type {
  AppointmentVotePayload,
  NoConfidenceVotePayload,
} from "@/types/parliamentaryGovernment";
import {
  getGovernmentFormationsCollection,
  getPMAppointmentVotesCollection,
  getNoConfidenceVotesCollection,
} from "@/lib/db/collections/governmentFormation";
import { getCountryLeaderStatesCollection } from "@/lib/db/collections/countryLeaderState";
import { NO_CONFIDENCE_COOLDOWN_TURNS } from "@/lib/constants/governmentFormation";
import {
  checkAppointmentEligibility,
  processParliamentaryGovernmentVotes,
} from "@/lib/turn/parliamentaryGovernment";
import { getGameTime } from "@/lib/time/gameTime";
import { computeParliamentaryGovernmentTally } from "@/lib/congress/governmentVoteBreakdown";
import { getLowerChamberOfficeType } from "@/lib/legislature/chamberOfficeType";
import { SNAP_ELECTION_LIMIT, SNAP_ELECTION_COOLDOWN_TURNS } from "@/lib/turn/snapElection";
import { getConfidenceConsequenceLevel } from "@/lib/turn/rulingPartyPriorities";

/**
 * Coerce a character id that is typed `ObjectId` but may have been persisted as
 * a string by some writer. Returns null for anything that is not a usable id,
 * so a shape drift degrades to "no PM" instead of 500ing the whole page on
 * `pmCharacterId.equals is not a function`.
 */
function toObjectIdOrNull(value: ObjectId | string | null | undefined): ObjectId | null {
  if (!value) return null;
  if (value instanceof ObjectId) return value;
  return ObjectId.isValid(value) ? new ObjectId(value) : null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) notFound();

    const config = COUNTRY_CONFIGS[countryId];

    if (countryId === COUNTRY_CONFIGS.US.id) {
      return await handleUS();
    }
    if (isParliamentarySystem(config)) {
      return await handleParliamentary(countryId);
    }
    return await handlePresidential(countryId);
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * Presidency view for non-US presidential systems (e.g. NG, BR). Mirrors
 * handleUS's response shape but is country-scoped and resolves office-holders
 * that may be NPP-backed (characterId null, nppId set) via resolveExecutiveHolder.
 * handleUS is intentionally left untouched.
 */
async function handlePresidential(countryId: CountryId) {
  const db = await getDb();
  const authUser = await getAuthUser().catch(() => null);
  const [presidentOfficial, vicePresidentOfficial] = await Promise.all([
    db
      .collection<ElectedOfficial>("electedOfficials")
      .findOne({ countryId, officeType: "president" }),
    db
      .collection<ElectedOfficial>("electedOfficials")
      .findOne({ countryId, officeType: "vicePresident" }),
  ]);
  const [president, vicePresident] = await Promise.all([
    resolveExecutiveHolder(db, presidentOfficial),
    resolveExecutiveHolder(db, vicePresidentOfficial),
  ]);

  const myCharacter = authUser
    ? await db
        .collection<Character>("characters")
        .findOne({ userId: new ObjectId(authUser.userId) })
    : null;
  const isPresident =
    !!presidentOfficial?.characterId &&
    !!myCharacter &&
    presidentOfficial.characterId.equals(myCharacter._id);
  const isVicePresident =
    !!vicePresidentOfficial?.characterId &&
    !!myCharacter &&
    vicePresidentOfficial.characterId.equals(myCharacter._id);

  return NextResponse.json({
    countryId,
    president,
    vicePresident,
    presidentOfficialId: presidentOfficial?._id?.toString() ?? null,
    vicePresidentOfficialId: vicePresidentOfficial?._id?.toString() ?? null,
    isAdmin: authUser?.isAdmin ?? false,
    isPresident,
    isVicePresident,
  });
}

async function handleUS() {
  const db = await getDb();
  const authUser = await getAuthUser().catch(() => null);

  const [presidentOfficial, vicePresidentOfficial] = await Promise.all([
    db
      .collection<ElectedOfficial>("electedOfficials")
      .findOne({ countryId: "US", officeType: "president" }),
    db
      .collection<ElectedOfficial>("electedOfficials")
      .findOne({ countryId: "US", officeType: "vicePresident" }),
  ]);

  const presCharId = presidentOfficial?.characterId;
  const vpCharId = vicePresidentOfficial?.characterId;

  type ExecutiveInfo = {
    id: string;
    characterId: string;
    characterName: string;
    party?: string;
    partyName?: string;
    partyColor?: string;
    countryId?: CountryId;
    avatarUrl?: string;
    administrationStartDate?: string | null;
  } | null;
  let president: ExecutiveInfo = null;
  let vicePresident: ExecutiveInfo = null;

  if (presCharId) {
    const char = await db.collection<Character>("characters").findOne({ _id: presCharId });
    if (char) {
      const charCountry: CountryId = char.countryId ?? ("US" as CountryId);
      const party = char.party
        ? await db
            .collection<PoliticalParty>("politicalParties")
            .findOne({ sequentialId: Number(char.party), countryId: charCountry })
        : null;
      president = {
        id: presidentOfficial!._id.toString(),
        characterId: char._id.toString(),
        characterName: char.name,
        party: char.party,
        partyName: party?.name ?? char.party,
        partyColor: party?.color,
        countryId: charCountry,
        avatarUrl: char.avatarUrl,
        administrationStartDate: presidentOfficial!.electedAt?.toISOString() ?? null,
      };
    }
  }

  if (vpCharId) {
    const char = await db.collection<Character>("characters").findOne({ _id: vpCharId });
    if (char) {
      const charCountry: CountryId = char.countryId ?? ("US" as CountryId);
      const party = char.party
        ? await db
            .collection<PoliticalParty>("politicalParties")
            .findOne({ sequentialId: Number(char.party), countryId: charCountry })
        : null;
      vicePresident = {
        id: vicePresidentOfficial!._id.toString(),
        characterId: char._id.toString(),
        characterName: char.name,
        party: char.party,
        partyName: party?.name ?? char.party,
        partyColor: party?.color,
        countryId: charCountry,
        avatarUrl: char.avatarUrl,
        administrationStartDate: vicePresidentOfficial!.electedAt?.toISOString() ?? null,
      };
    }
  }

  const myCharacter = authUser
    ? await db
        .collection<Character>("characters")
        .findOne({ userId: new ObjectId(authUser.userId) })
    : null;
  const isPresident =
    !!presidentOfficial?.characterId &&
    !!myCharacter &&
    presidentOfficial.characterId.equals(myCharacter._id);

  return NextResponse.json({
    countryId: "US",
    president,
    vicePresident,
    presidentOfficialId: presidentOfficial?._id?.toString() ?? null,
    vicePresidentOfficialId: vicePresidentOfficial?._id?.toString() ?? null,
    isAdmin: authUser?.isAdmin ?? false,
    isPresident,
  });
}

async function handleParliamentary(countryId: CountryId) {
  const db = await getDb();
  const authUser = await getAuthUser().catch(() => null);
  const config = COUNTRY_CONFIGS[countryId];
  // Office type seated lower-chamber members are stored under. Differs from the
  // chamber key for CN (key "npc" vs office type "npcDelegate"); using the raw
  // key would match zero CN delegates, collapsing seat weights to an unweighted
  // count and breaking viewer-is-delegate detection. Mirrors the executive hub.
  const lowerChamberKey = getLowerChamberOfficeType(countryId);

  // Inline-resolve any expired parliamentary votes before reading state, so
  // clients polling this endpoint see the post-resolution PM/vote state rather
  // than waiting up to one turn for the scheduler. Atomic claim inside the
  // resolver keeps this race-safe against the turn processor. Use the game
  // clock so the resolver agrees with the cron path and with the closesAt
  // anchor written at vote creation.
  const executiveGameTime = await getGameTime();
  await processParliamentaryGovernmentVotes(db, countryId, executiveGameTime.effectiveNow);

  const [lowerChamberOfficials, govFormation] = await Promise.all([
    db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ officeType: lowerChamberKey, countryId })
      .toArray(),
    getGovernmentFormationsCollection(db).findOne({ _id: countryId }),
  ]);

  // Live seat tally from the officials just fetched, rather than trusting
  // `govFormation.seatsByParty` — a write-triggered cache refreshed only on
  // specific turn events (NC-vote resolution, cycle rollover, PM appointment)
  // that can drift arbitrarily far from the real chamber between them
  // (measured in the field: BR/NG summed to 0 against real totals of 513/360,
  // DE showed 630 against a real 487). This is a display surface, but a wrong
  // seat count here is exactly the misreading that led an operator astray
  // elsewhere in the admin tooling.
  const liveSeatsByParty: Record<string, number> = {};
  for (const official of lowerChamberOfficials) {
    if (!official.party) continue;
    liveSeatsByParty[official.party] =
      (liveSeatsByParty[official.party] ?? 0) + (official.seatsHeld ?? 1);
  }

  type ExecutiveInfo = {
    id: string;
    characterId: string;
    sequentialId?: number | null;
    characterName: string;
    party?: string;
    partyName?: string;
    partyColor?: string;
    countryId?: CountryId;
    avatarUrl?: string;
    administrationStartDate?: string | null;
  } | null;

  let primeMinister: ExecutiveInfo = null;

  // `pmCharacterId` is typed ObjectId, but the whole executive page 500s if a
  // writer ever leaves a string there ("pmCharacterId.equals is not a
  // function"). Normalise once, and compare/query off the normalised value.
  const pmCharacterId = toObjectIdOrNull(govFormation?.pmCharacterId);

  if (pmCharacterId) {
    const char = await db.collection<Character>("characters").findOne({ _id: pmCharacterId });
    if (char) {
      const charCountry: CountryId = char.countryId ?? countryId;
      const party = char.party
        ? await db
            .collection<PoliticalParty>("politicalParties")
            .findOne({ sequentialId: Number(char.party), countryId: charCountry })
        : null;
      primeMinister = {
        id: pmCharacterId.toString(),
        characterId: char._id.toString(),
        sequentialId: char.sequentialId ?? null,
        characterName: govFormation?.pmName ?? char.name,
        party: char.party,
        partyName: party?.name ?? char.party,
        partyColor: party?.color,
        countryId: charCountry,
        avatarUrl: char.avatarUrl,
        administrationStartDate: govFormation?.formedAt?.toISOString() ?? null,
      };
    }
  }

  // Ceremonial head of state for non-monarchy systems (e.g. CN President of the
  // PRC = CCP chair). Resolved from the office marked `isHeadOfState`. Null for
  // monarchies (no such office — they render via the imperial-character system)
  // and for countries with no seated head of state.
  let headOfState: ExecutiveInfo = null;
  const headOfStateOfficeType = getHeadOfStateOfficeType(config);
  if (headOfStateOfficeType) {
    const hosOfficial = await db
      .collection<ElectedOfficial>("electedOfficials")
      .findOne({ officeType: headOfStateOfficeType, countryId });
    if (hosOfficial?.characterId) {
      const hosChar = await db
        .collection<Character>("characters")
        .findOne({ _id: hosOfficial.characterId });
      if (hosChar) {
        const hosCountry: CountryId = hosChar.countryId ?? countryId;
        const hosParty = hosChar.party
          ? await db
              .collection<PoliticalParty>("politicalParties")
              .findOne({ sequentialId: Number(hosChar.party), countryId: hosCountry })
          : null;
        headOfState = {
          id: hosOfficial._id.toString(),
          characterId: hosChar._id.toString(),
          sequentialId: hosChar.sequentialId ?? null,
          characterName: hosChar.name,
          party: hosChar.party,
          partyName: hosParty?.name ?? hosChar.party,
          partyColor: hosParty?.color,
          countryId: hosCountry,
          avatarUrl: hosChar.avatarUrl,
          administrationStartDate: hosOfficial.electedAt?.toISOString() ?? null,
        };
      }
    }
  }

  const myCharacter = authUser
    ? await db
        .collection<Character>("characters")
        .findOne({ userId: new ObjectId(authUser.userId) })
    : null;
  const isPrimeMinister = !!pmCharacterId && !!myCharacter && pmCharacterId.equals(myCharacter._id);

  const userLowerOfficial = myCharacter
    ? await db.collection<ElectedOfficial>("electedOfficials").findOne({
        characterId: myCharacter._id,
        officeType: lowerChamberKey,
        countryId: countryId,
      })
    : null;

  // --- Government formation data ---

  // Build government field from governmentFormations collection
  type GovernmentPayload = {
    status: "pending" | "formed";
    formationType: "majority" | "coalition" | "minority" | "admin" | null;
    lostMajority: boolean;
    pmName: string | null;
    pmCharacterId: string | null;
    governingPartyId: string | null;
    coalitionId: number | null;
    coalitionPartyIds: string[] | null;
    totalSeatsSupporting: number;
    majorityThreshold: number;
    seatsByParty: Record<string, number>;
    totalSeats: number;
    formedAt: Date | null;
    /** Legislature-appointed ceremonial head of state (RU Chairman of the
     *  Presidium) — null when vacant; absent for partyChairSync countries. */
    hosName?: string | null;
  } | null;

  let governmentPayload: GovernmentPayload = null;
  if (govFormation && govFormation.status !== "collapsed") {
    governmentPayload = {
      status: govFormation.status as "pending" | "formed",
      formationType: govFormation.formationType,
      lostMajority: govFormation.lostMajority,
      pmName: govFormation.pmName,
      pmCharacterId: govFormation.pmCharacterId?.toString() ?? null,
      governingPartyId: govFormation.governingPartyId,
      coalitionId: govFormation.coalitionId,
      coalitionPartyIds: govFormation.coalitionPartyIds,
      totalSeatsSupporting: govFormation.totalSeatsSupporting,
      majorityThreshold: govFormation.majorityThreshold,
      seatsByParty: liveSeatsByParty,
      totalSeats: govFormation.totalSeats,
      formedAt: govFormation.formedAt,
      ...(COUNTRY_CONFIGS[countryId].headOfStateSelection === "legislatureAppointment"
        ? { hosName: govFormation.hosName ?? null }
        : {}),
    };
  }

  // Resolve active appointment votes (multiple may exist concurrently)
  let activeAppointmentVotes: AppointmentVotePayload[] = [];
  let activeNoConfidenceVote: NoConfidenceVotePayload | null = null;
  const viewerVotes: Record<string, "aye" | "nay"> = {};
  const viewerWhippedFrom: Record<string, string> = {};

  // Fetch all active appointment votes. Confidence motions stay on a formed
  // government; VONC-parallel nominations may also be active while formed.
  const apptVotes = await getPMAppointmentVotesCollection(db)
    .find({ countryId, status: "active" })
    .toArray();

  activeAppointmentVotes = await Promise.all(
    apptVotes.map(async (v) => {
      // Headline tally and per-party breakdown both come from one
      // seat-weighted recompute of the votes map against current seats — the
      // single source of truth, so the header and breakdown can never
      // diverge and de-seated / cross-country voters are excluded.
      const tally = await computeParliamentaryGovernmentTally(
        db,
        countryId,
        lowerChamberKey,
        v.votes
      );
      return {
        type: "pmAppointment" as const,
        _id: v._id.toString(),
        nomineeName: v.nomineeName,
        nomineePartyId: v.nomineePartyId,
        formationType: v.formationType,
        coalitionId: v.coalitionId,
        votesFor: tally.votesFor,
        votesAgainst: tally.votesAgainst,
        voteByParty: tally.voteByParty,
        status: v.status,
        closesAt: v.closesAt.toISOString(),
        closesOnTurn: v.closesOnTurn ?? null,
        isConfidenceMotion: v.isConfidenceMotion === true,
      };
    })
  );

  if (myCharacter) {
    for (const v of apptVotes) {
      const key = myCharacter._id.toString();
      const charVote = v.votes[key];
      if (charVote) viewerVotes[v._id.toString()] = charVote;
      const wf = v.whippedFromVote?.[key];
      if (wf) viewerWhippedFrom[v._id.toString()] = wf;
    }
  }

  // Fetch active no-confidence vote (one at a time, only when formed)
  if (govFormation?.status === "formed" && govFormation.activeVoteId) {
    const noConfVote = await getNoConfidenceVotesCollection(db).findOne({
      _id: govFormation.activeVoteId,
      status: "active",
    });
    if (noConfVote) {
      const noConfTally = await computeParliamentaryGovernmentTally(
        db,
        countryId,
        lowerChamberKey,
        noConfVote.votes
      );
      activeNoConfidenceVote = {
        type: "noConfidence",
        _id: noConfVote._id.toString(),
        proposedByName: noConfVote.proposedByName,
        targetPmName: noConfVote.targetPmName,
        votesFor: noConfTally.votesFor,
        votesAgainst: noConfTally.votesAgainst,
        voteByParty: noConfTally.voteByParty,
        status: noConfVote.status,
        closesAt: noConfVote.closesAt.toISOString(),
        closesOnTurn: noConfVote.closesOnTurn ?? null,
      };
      if (myCharacter) {
        const key = myCharacter._id.toString();
        const charVote = noConfVote.votes[key];
        if (charVote) viewerVotes[noConfVote._id.toString()] = charVote;
        const wf = noConfVote.whippedFromVote?.[key];
        if (wf) viewerWhippedFrom[noConfVote._id.toString()] = wf;
      }
    } else {
      // Self-heal: activeVoteId points to closed/missing vote
      await getGovernmentFormationsCollection(db).updateOne(
        { _id: countryId, activeVoteId: govFormation.activeVoteId },
        { $set: { activeVoteId: null, updatedAt: new Date() } }
      );
    }
  }

  // Determine viewerMayAppoint via shared eligibility function
  let viewerMayAppoint = false;
  if (myCharacter && govFormation?.status === "pending") {
    const eligibility = await checkAppointmentEligibility(
      db,
      countryId,
      myCharacter._id,
      govFormation.majorityThreshold
    );
    viewerMayAppoint = eligibility.eligible;
  }

  // Determine viewerMayProposeNoConfidence — Commons MP when government is formed and no active vote
  let viewerMayProposeNoConfidence = false;
  let noConfidenceCooldownTurns: number | null = null;

  if (
    myCharacter &&
    govFormation?.status === "formed" &&
    govFormation.pmCharacterId &&
    userLowerOfficial
  ) {
    if (!govFormation.activeVoteId) {
      // Check 48-turn cooldown on no-confidence votes
      const gameState = await db
        .collection<{ _id: string; currentTurn: number }>("gameState")
        .findOne({ _id: "current" });
      const currentTurn = gameState?.currentTurn ?? 0;

      const lastVote = await getNoConfidenceVotesCollection(db)
        .find({ countryId: countryId })
        .sort({ turnProposed: -1 })
        .limit(1)
        .toArray();

      if (lastVote.length > 0) {
        const turnsElapsed = currentTurn - lastVote[0].turnProposed;
        if (turnsElapsed < NO_CONFIDENCE_COOLDOWN_TURNS) {
          noConfidenceCooldownTurns = NO_CONFIDENCE_COOLDOWN_TURNS - turnsElapsed;
        }
      }

      viewerMayProposeNoConfidence = noConfidenceCooldownTurns === null;
    }
  }

  // --- Snap election state (exposed for PMSnapElectionButton) ---
  const snapElectionsUsed = govFormation?.snapElectionsUsed ?? 0;
  const snapElectionsRemaining = Math.max(0, SNAP_ELECTION_LIMIT - snapElectionsUsed);
  let snapCooldownTurnsRemaining = 0;
  const lastSnapTurn = govFormation?.lastSnapElectionTurn ?? 0;
  if (lastSnapTurn > 0) {
    const gameState = await db
      .collection<{ _id: string; currentTurn: number }>("gameState")
      .findOne({ _id: "current" });
    const currentTurn = gameState?.currentTurn ?? 0;
    snapCooldownTurnsRemaining = Math.max(
      0,
      SNAP_ELECTION_COOLDOWN_TURNS - (currentTurn - lastSnapTurn)
    );
  }
  const snapElectionsAllowed = supportsSnapElections(config) && isPrimeMinister;

  // --- Leader-confidence payload (countries with hasLeaderConfidenceModel) ---
  let rulingPartyConfidence: {
    confidence: number;
    band: string;
    history: { delta: number; reason: string; at: string }[];
  } | null = null;
  if (config.hasLeaderConfidenceModel && govFormation?.pmCharacterId) {
    const stateColl = getCountryLeaderStatesCollection(db);
    const stateId = `${countryId}_${govFormation.pmCharacterId.toString()}`;
    const state = await stateColl.findOne({ _id: stateId });
    if (state) {
      rulingPartyConfidence = {
        confidence: state.partyConfidence,
        band: getConfidenceConsequenceLevel(state.partyConfidence),
        history: state.confidenceHistory.slice(-5).map((h) => ({
          delta: h.delta,
          reason: h.reason,
          at: h.at.toISOString(),
        })),
      };
    }
  }

  return NextResponse.json({
    countryId: countryId,
    primeMinister,
    headOfState,
    governingPartyId: govFormation?.governingPartyId ?? null,
    formationType: govFormation?.formationType ?? null,
    isMinority: govFormation?.formationType === "minority",
    totalSeatsSupporting: govFormation?.totalSeatsSupporting ?? 0,
    majorityThreshold: govFormation?.majorityThreshold ?? config.coalitionThreshold,
    isAdmin: authUser?.isAdmin ?? false,
    isPrimeMinister,
    viewerIsCommonsMp: !!userLowerOfficial,
    government: governmentPayload,
    activeAppointmentVotes,
    activeNoConfidenceVote,
    viewerMayAppoint,
    viewerMayProposeNoConfidence,
    noConfidenceCooldownTurns,
    viewerVotes,
    viewerWhippedFrom,
    snapElectionsAllowed,
    snapElectionsUsed,
    snapElectionsRemaining,
    snapCooldownTurnsRemaining,
    rulingPartyConfidence,
  });
}
