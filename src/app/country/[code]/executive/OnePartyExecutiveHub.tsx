import { getAuthUserWithCharacter } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import Link from "next/link";
import {
  getGovernmentFormationsCollection,
  getPMAppointmentVotesCollection,
  getNoConfidenceVotesCollection,
} from "@/lib/db/collections/governmentFormation";
import type {
  AppointmentVotePayload,
  NoConfidenceVotePayload,
} from "@/types/parliamentaryGovernment";
import { UKGovernmentLayout } from "@/components/uk/UKGovernmentLayout";
import { PartyChip } from "@/app/congress/components/CongressShared";
import { SectionLabel } from "@/components/ui";
import { OfficePlaques } from "./components/OfficePlaques";
import { getExecutiveIdentity } from "@/lib/constants/institutionIdentity";
import { Avatar } from "@/components/Avatar";
import type { Character, CongressLeader, ElectedOfficial, PoliticalParty } from "@/lib/db/types";
import {
  type CountryId,
  getCountryConfig,
  getHeadOfStateOfficeType,
} from "@/lib/constants/countries";
import { getOnePartyExecutiveSurface } from "@/lib/constants/onePartyExecutiveSurface";
import { getPartyRoleLabel } from "@/lib/parties/partyRoleLabels";
import { getCountryState } from "@/lib/countryState";
import { ParliamentaryGovernmentActions } from "./components/ParliamentaryGovernmentActions";
import { ExecutiveTabsClient } from "./ExecutiveTabsClient";
import { formationTurnToLarpDate } from "@/lib/government/formationDate";
import {
  checkAppointmentEligibility,
  processParliamentaryGovernmentVotes,
  resolveGoverningPartyIdsFromDocuments,
  resolveOppositionLeader,
} from "@/lib/parliament/queries";
import { computeParliamentaryGovernmentTally } from "@/lib/congress/governmentVoteBreakdown";
import { getGameTime } from "@/lib/time/gameTime";
import { getCountryLeaderStatesCollection } from "@/lib/db/collections/countryLeaderState";
import {
  getLowerChamberOfficeType,
  getJointSittingOfficeTypes,
} from "@/lib/legislature/chamberOfficeType";
import { classifyConfidenceBand, MAX_CONFIDENCE } from "@/lib/onePartyState/rulingPartyConfidence";
import {
  getConfidenceConsequenceLevel,
  CONFIDENCE_CONSEQUENCE_DESCRIPTIONS,
} from "@/lib/onePartyState/rulingPartyPriorities";

type PartyRowMeta = {
  seqKey: string;
  seats: number;
  doc: PoliticalParty | null;
};

/** Badge color per confidence band. Matches the project's semantic palette. */
function confidenceBandBadgeClasses(band: ReturnType<typeof classifyConfidenceBand>): string {
  switch (band) {
    case "secure":
      return "bg-success/15 text-success";
    case "stable":
      return "bg-primary/15 text-primary";
    case "watchful":
      return "bg-card-muted text-foreground";
    case "strained":
      return "bg-warning/15 text-warning";
    case "crisis":
      return "bg-error/15 text-error";
    case "critical":
      return "bg-error/30 text-error";
  }
}

/** Progress-bar fill color per confidence band. */
function confidenceBandBarClasses(band: ReturnType<typeof classifyConfidenceBand>): string {
  switch (band) {
    case "secure":
      return "bg-success";
    case "stable":
      return "bg-primary";
    case "watchful":
      return "bg-foreground/40";
    case "strained":
      return "bg-warning";
    case "crisis":
      return "bg-error";
    case "critical":
      return "bg-error";
  }
}

/**
 * Shared executive hub for one-party states (governmentType onePartyState):
 * head of government, ceremonial head of state, chamber composition,
 * ruling-party confidence, and cabinet entry. Per-country copy (titles,
 * glyphs, hero, chamber-leadership plaques) comes from
 * `getOnePartyExecutiveSurface`, so a new one-party country renders here
 * without a bespoke hub. Rendered at `/country/[code]/executive`.
 */
export async function OnePartyExecutiveHub({ countryId }: { countryId: CountryId }) {
  const surface = getOnePartyExecutiveSurface(countryId);
  const user = await getAuthUserWithCharacter();
  const db = await getDb();
  const config = getCountryConfig(countryId);
  const lowerChamberKey = getLowerChamberOfficeType(countryId);
  // Runtime governmentType so a post-Stage-4 conversion hides the OPS
  // Regime Health / Admin tabs immediately. Hard-coding `true` would
  // leak the diagnostic surfaces on a country that is no longer a
  // one-party state.
  const runtime = await getCountryState(db, countryId);
  const isOnePartyState = runtime.governmentType === "onePartyState";

  const executiveGameTime = await getGameTime();
  await processParliamentaryGovernmentVotes(db, countryId, executiveGameTime.effectiveNow);

  const govFormation = await getGovernmentFormationsCollection(db).findOne({ _id: countryId });

  const pmCharId = govFormation?.pmCharacterId ?? null;
  let premier: Character | null = null;
  if (pmCharId) {
    premier = await db.collection<Character>("characters").findOne({ _id: pmCharId });
  }

  // Ceremonial Head of State — resolved via the config's isHeadOfState office
  // (CN President of the PRC: auto-populated by partyChairHeadOfState; RU Chairman
  // of the Presidium: elected by the legislature, spec §2.3). Distinct from
  // the Premier (head of government) above. May be null when unseated.
  const hosOfficeType = getHeadOfStateOfficeType(config);
  const presidentOfficial = hosOfficeType
    ? await db
        .collection<ElectedOfficial>("electedOfficials")
        .findOne({ countryId, officeType: hosOfficeType })
    : null;
  let president: Character | null = null;
  if (presidentOfficial?.characterId) {
    president = await db
      .collection<Character>("characters")
      .findOne({ _id: presidentOfficial.characterId });
  }

  // Chamber-leadership offices (CN: NPCSC Chairman, CPPCC Chairman) — read-only
  // display here; the elections live on the legislature page. Resolved only
  // when the country's surface declares the congressLeaders role.
  async function resolveCongressLeader(role: string | undefined): Promise<Character | null> {
    if (!role) return null;
    // The surface stores the role as a plain string (constants stay decoupled
    // from db types); narrow it at the query boundary.
    const leader = await db
      .collection<CongressLeader>("congressLeaders")
      .findOne({ role: role as CongressLeader["role"] });
    if (!leader?.characterId) return null;
    return db.collection<Character>("characters").findOne({ _id: leader.characterId });
  }
  const legislatureChair = await resolveCongressLeader(
    surface.legislatureChairPlaque?.congressLeaderRole
  );
  const advisoryChair = await resolveCongressLeader(
    surface.advisoryChairPlaque?.congressLeaderRole
  );

  // Ruling-party confidence state for the seated Premier (one-party-state hub).
  // The data already ships on /api/country/cn/executive but nothing renders it
  // — this fetch is local to the hub to avoid the round-trip and keep the
  // panel server-rendered alongside the rest of the executive cards.
  let confidencePanel: {
    confidence: number;
    band: ReturnType<typeof classifyConfidenceBand>;
    consequenceLevel: ReturnType<typeof getConfidenceConsequenceLevel>;
    consequenceDescription: string;
    history: { delta: number; reason: string; turn: number; at: string }[];
  } | null = null;
  if (config.hasLeaderConfidenceModel && pmCharId) {
    const stateColl = getCountryLeaderStatesCollection(db);
    const stateId = `${countryId}_${pmCharId.toString()}`;
    const state = await stateColl.findOne({ _id: stateId });
    if (state) {
      const consequenceLevel = getConfidenceConsequenceLevel(state.partyConfidence);
      confidencePanel = {
        confidence: state.partyConfidence,
        band: classifyConfidenceBand(state.partyConfidence),
        consequenceLevel,
        consequenceDescription: CONFIDENCE_CONSEQUENCE_DESCRIPTIONS[consequenceLevel],
        history: state.confidenceHistory.slice(0, 5).map((h) => ({
          delta: h.delta,
          reason: h.reason,
          turn: h.turn,
          at: h.at.toISOString(),
        })),
      };
    }
  }

  let activeAppointmentVotes: AppointmentVotePayload[] = [];
  let activeNoConfidenceVote: NoConfidenceVotePayload | null = null;
  const viewerVotes: Record<string, "aye" | "nay"> = {};
  const viewerWhippedFrom: Record<string, string> = {};

  if (govFormation) {
    // PM votes only — head-of-state votes share the collection (office:
    // "headOfState") and render through their own joint-sitting block below.
    // Include formed-government confidence motions, not just pending formation.
    const apptVotes = await getPMAppointmentVotesCollection(db)
      .find({ countryId, status: "active", office: { $exists: false } })
      .toArray();

    activeAppointmentVotes = await Promise.all(
      apptVotes.map(async (vote) => {
        const tally = await computeParliamentaryGovernmentTally(
          db,
          countryId,
          lowerChamberKey,
          vote.votes
        );
        return {
          type: "pmAppointment" as const,
          _id: vote._id.toString(),
          nomineeName: vote.nomineeName,
          nomineePartyId: vote.nomineePartyId,
          formationType: vote.formationType,
          coalitionId: vote.coalitionId,
          votesFor: tally.votesFor,
          votesAgainst: tally.votesAgainst,
          voteByParty: tally.voteByParty,
          status: vote.status,
          closesAt: vote.closesAt.toISOString(),
          closesOnTurn: vote.closesOnTurn ?? null,
          isConfidenceMotion: vote.isConfidenceMotion === true,
        };
      })
    );

    if (user?.character) {
      for (const vote of apptVotes) {
        const key = user.character._id.toString();
        const charVote = vote.votes[key];
        if (charVote) viewerVotes[vote._id.toString()] = charVote;
        const whipped = vote.whippedFromVote?.[key];
        if (whipped) viewerWhippedFrom[vote._id.toString()] = whipped;
      }
    }
  }

  // Head-of-state appointment votes (RU Chairman of the Presidium) run
  // independently of formation status — a joint sitting of both chambers
  // votes, and casting reuses the shared pm/appoint vote route.
  const usesHosAppointment = config.headOfStateSelection === "legislatureAppointment";
  if (usesHosAppointment) {
    const hosVotes = await getPMAppointmentVotesCollection(db)
      .find({ countryId, status: "active", office: "headOfState" })
      .toArray();
    const jointOfficeTypes = getJointSittingOfficeTypes(countryId);
    const hosPayloads = await Promise.all(
      hosVotes.map(async (vote) => {
        const tally = await computeParliamentaryGovernmentTally(
          db,
          countryId,
          jointOfficeTypes,
          vote.votes
        );
        return {
          type: "pmAppointment" as const,
          office: "headOfState" as const,
          officeTitle: config.headOfStateTitle,
          _id: vote._id.toString(),
          nomineeName: vote.nomineeName,
          nomineePartyId: vote.nomineePartyId,
          formationType: vote.formationType,
          coalitionId: vote.coalitionId,
          votesFor: tally.votesFor,
          votesAgainst: tally.votesAgainst,
          voteByParty: tally.voteByParty,
          status: vote.status,
          closesAt: vote.closesAt.toISOString(),
          closesOnTurn: vote.closesOnTurn ?? null,
        };
      })
    );
    activeAppointmentVotes = [...activeAppointmentVotes, ...hosPayloads];
    if (user?.character) {
      for (const vote of hosVotes) {
        const key = user.character._id.toString();
        const charVote = vote.votes[key];
        if (charVote) viewerVotes[vote._id.toString()] = charVote;
        const whipped = vote.whippedFromVote?.[key];
        if (whipped) viewerWhippedFrom[vote._id.toString()] = whipped;
      }
    }
  }

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
      if (user?.character) {
        const key = user.character._id.toString();
        const charVote = noConfVote.votes[key];
        if (charVote) viewerVotes[noConfVote._id.toString()] = charVote;
        const whipped = noConfVote.whippedFromVote?.[key];
        if (whipped) viewerWhippedFrom[noConfVote._id.toString()] = whipped;
      }
    }
  }

  let viewerMayAppoint = false;
  if (user?.character && govFormation?.status === "pending") {
    const eligibility = await checkAppointmentEligibility(
      db,
      countryId,
      user.character._id,
      govFormation.majorityThreshold
    );
    viewerMayAppoint = eligibility.eligible;
  }

  let viewerIsNpcDelegate = false;
  let viewerIsJointDeputy = false;
  if (user?.character) {
    const seatRecord = await db.collection<ElectedOfficial>("electedOfficials").findOne({
      characterId: user.character._id,
      countryId,
      officeType: lowerChamberKey,
    });
    viewerIsNpcDelegate = seatRecord != null;
    // Joint-sitting eligibility (head-of-state votes): a seat in EITHER chamber.
    if (usesHosAppointment) {
      const jointSeat = await db.collection<ElectedOfficial>("electedOfficials").findOne({
        characterId: user.character._id,
        countryId,
        officeType: { $in: getJointSittingOfficeTypes(countryId) },
      });
      viewerIsJointDeputy = jointSeat != null;
    }
  }

  // Head-of-state nomination CTA: office vacant + viewer chair-eligible.
  let hosNomination: { title: string; viewerMayNominate: boolean; vacant: boolean } | undefined;
  if (usesHosAppointment && govFormation) {
    const hosVacant = govFormation.hosCharacterId == null && govFormation.hosNppId == null;
    let viewerMayNominateHos = false;
    if (user?.character && hosVacant) {
      const hosEligibility = await checkAppointmentEligibility(
        db,
        countryId,
        user.character._id,
        govFormation.majorityThreshold
      );
      viewerMayNominateHos = hosEligibility.eligible;
    }
    hosNomination = {
      title: config.headOfStateTitle ?? "Head of State",
      viewerMayNominate: viewerMayNominateHos,
      vacant: hosVacant,
    };
  }

  let viewerMayProposeNoConfidence = false;
  let noConfidenceCooldownTurns: number | null = null;
  if (
    viewerIsNpcDelegate &&
    govFormation?.status === "formed" &&
    govFormation.pmCharacterId &&
    !govFormation.activeVoteId
  ) {
    const NO_CONFIDENCE_COOLDOWN_TURNS = 48;
    const gameState = await db
      .collection<{ _id: string; currentTurn: number }>("gameState")
      .findOne({ _id: "current" });
    const currentTurn = gameState?.currentTurn ?? 0;

    const lastVote = await getNoConfidenceVotesCollection(db)
      .find({ countryId })
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

  const allLowerOfficials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({ officeType: lowerChamberKey, countryId })
    .toArray();

  const seatsByParty: Record<string, number> = {};
  for (const official of allLowerOfficials) {
    if (!official.party) continue;
    const seats = official.seatsHeld ?? 1;
    seatsByParty[official.party] = (seatsByParty[official.party] ?? 0) + seats;
  }

  const sortedParties = Object.entries(seatsByParty).sort((a, b) => b[1] - a[1]);
  const partySeqNums = [
    ...new Set(
      sortedParties.map(([key]) => Number.parseInt(key, 10)).filter((n) => !Number.isNaN(n))
    ),
  ];
  const partyDocs = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId, sequentialId: { $in: partySeqNums } })
    .toArray();
  const partyBySeq = new Map(partyDocs.map((party) => [String(party.sequentialId), party]));

  const partyRows: PartyRowMeta[] = sortedParties.map(([seqKey, seats]) => ({
    seqKey,
    seats,
    doc: partyBySeq.get(seqKey) ?? null,
  }));

  const govPartyId = govFormation?.governingPartyId ?? null;
  const governingPartyDoc =
    govPartyId && !Number.isNaN(Number.parseInt(govPartyId, 10))
      ? (partyBySeq.get(govPartyId) ??
        (await db.collection<PoliticalParty>("politicalParties").findOne({
          countryId,
          sequentialId: Number.parseInt(govPartyId, 10),
        })))
      : null;

  let premierPartyDoc: PoliticalParty | null = null;
  if (premier?.party) {
    const seq = Number.parseInt(premier.party, 10);
    if (!Number.isNaN(seq)) {
      premierPartyDoc =
        partyBySeq.get(premier.party) ??
        (await db.collection<PoliticalParty>("politicalParties").findOne({
          countryId,
          sequentialId: seq,
        }));
    }
  }

  let oppositionLeaderChar: Character | null = null;
  let oppositionPartyDoc: PoliticalParty | null = null;
  if (govPartyId) {
    const govPartyIds = await resolveGoverningPartyIdsFromDocuments(
      db,
      countryId,
      govFormation,
      null
    );
    const result = await resolveOppositionLeader(
      db,
      countryId,
      seatsByParty,
      govPartyIds,
      partyBySeq
    );
    if (result) {
      oppositionLeaderChar = await db.collection<Character>("characters").findOne({
        _id: result.chairId,
      });
      oppositionPartyDoc = result.partyDoc;
    }
  }

  const governmentStatus =
    govFormation && govFormation.status !== "collapsed"
      ? (govFormation.status as "pending" | "formed")
      : null;

  const governingSeats = govFormation?.totalSeatsSupporting || partyRows[0]?.seats || 0;
  const majorityThreshold = govFormation?.majorityThreshold ?? config.coalitionThreshold;
  const isPending = governmentStatus === "pending";
  const formationType = govFormation?.formationType ?? null;
  const lostMajority = govFormation?.lostMajority ?? false;

  let statusStripText: string;
  if (isPending) {
    statusStripText = "Awaiting Formation";
  } else if (lostMajority) {
    statusStripText = "Formed (Lost Majority)";
  } else if (formationType === "coalition") {
    statusStripText = "Formed via Coalition";
  } else if (formationType === "minority") {
    statusStripText = "Formed via Minority";
  } else if (formationType === "admin") {
    statusStripText = "Formed via Admin";
  } else if (governmentStatus === "formed") {
    statusStripText = "Formed";
  } else {
    statusStripText = govFormation?.status ?? (premier ? "formed" : "vacant");
  }

  const pluralityParty =
    formationType === "coalition"
      ? { partyName: "Plurality Coalition", partyColor: "#6b7280", partyId: "" }
      : governingPartyDoc && govPartyId
        ? {
            partyName: governingPartyDoc.name,
            partyColor: governingPartyDoc.color,
            partyId: govPartyId,
          }
        : null;

  const premierHref = premier
    ? `/character/${premier.sequentialId ?? premier._id.toString()}`
    : null;
  const oppositionHref = oppositionLeaderChar
    ? `/character/${oppositionLeaderChar.sequentialId ?? oppositionLeaderChar._id.toString()}`
    : null;
  const presidentHref = president
    ? `/character/${president.sequentialId ?? president._id.toString()}`
    : null;
  // President's party is always the ruling party (CCP) by definition of the
  // sync rule; reuse governingPartyDoc when it resolved to that, else look up
  // by sequentialId from the official row.
  let presidentPartyDoc: PoliticalParty | null = governingPartyDoc ?? null;
  if (!presidentPartyDoc && presidentOfficial?.party) {
    const seq = Number.parseInt(presidentOfficial.party, 10);
    if (!Number.isNaN(seq)) {
      presidentPartyDoc =
        partyBySeq.get(presidentOfficial.party) ??
        (await db.collection<PoliticalParty>("politicalParties").findOne({
          countryId,
          sequentialId: seq,
        }));
    }
  }

  const viewerIsLeader = !!user?.character && !!pmCharId && pmCharId.equals(user.character._id);
  const viewerIsAdmin = !!user?.isAdmin;

  // Head-of-state copy carries the resolved ruling-party chair role label
  // (CN: "General Secretary") via the {roleLabel} placeholder.
  const chairRoleLabel = getPartyRoleLabel(countryId, "chair");
  const fillRoleLabel = (text: string) => text.replace("{roleLabel}", chairRoleLabel);

  const overview = (
    <div className="space-y-8">
      <ParliamentaryGovernmentActions
        countryCode={countryId.toLowerCase()}
        governmentStatus={governmentStatus}
        activeAppointmentVotes={activeAppointmentVotes}
        activeNoConfidenceVote={activeNoConfidenceVote}
        viewerMayAppoint={viewerMayAppoint}
        viewerIsCommonsMp={viewerIsNpcDelegate}
        viewerMayProposeNoConfidence={viewerMayProposeNoConfidence}
        noConfidenceCooldownTurns={noConfidenceCooldownTurns}
        viewerVotes={viewerVotes}
        viewerWhippedFrom={viewerWhippedFrom}
        executiveTitle={surface.executiveTitle}
        memberLabel={surface.memberLabel}
        hosNomination={hosNomination}
        viewerIsJointDeputy={viewerIsJointDeputy}
      />

      <section className="mb-2">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted">
            Executive leadership
          </h2>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          {/* B office plaques (locked composite) — constitutional order with
              seal chips; vacancy treatment carries each office's selection rule. */}
          <OfficePlaques
            countryId={countryId}
            identity={getExecutiveIdentity(countryId)}
            gridClassName="grid gap-3.5 sm:grid-cols-2"
            plaques={[
              {
                title: surface.headOfStatePlaque.title,
                sealGlyph: surface.headOfStatePlaque.sealGlyph,
                holder: president
                  ? {
                      name: president.name,
                      href: presidentHref ?? undefined,
                      avatarUrl: president.avatarUrl,
                      partyId: presidentOfficial?.party,
                      partyName: presidentPartyDoc?.name,
                      partyColor: presidentPartyDoc?.color,
                    }
                  : null,
                vacancyNote: fillRoleLabel(surface.headOfStatePlaque.vacancyNote),
                tenureLine:
                  president && surface.headOfStatePlaque.tenureLine
                    ? fillRoleLabel(surface.headOfStatePlaque.tenureLine)
                    : undefined,
              },
              ...(surface.legislatureChairPlaque
                ? [
                    {
                      title: surface.legislatureChairPlaque.title,
                      sealGlyph: surface.legislatureChairPlaque.sealGlyph,
                      holder: legislatureChair
                        ? {
                            name: legislatureChair.name,
                            href: `/character/${legislatureChair.sequentialId ?? legislatureChair._id.toString()}`,
                            avatarUrl: legislatureChair.avatarUrl,
                          }
                        : null,
                      vacancyNote: surface.legislatureChairPlaque.vacancyNote,
                      tenureLine: legislatureChair
                        ? surface.legislatureChairPlaque.tenureLine
                        : undefined,
                    },
                  ]
                : []),
              ...(surface.advisoryChairPlaque
                ? [
                    {
                      title: surface.advisoryChairPlaque.title,
                      sealGlyph: surface.advisoryChairPlaque.sealGlyph,
                      holder: advisoryChair
                        ? {
                            name: advisoryChair.name,
                            href: `/character/${advisoryChair.sequentialId ?? advisoryChair._id.toString()}`,
                            avatarUrl: advisoryChair.avatarUrl,
                          }
                        : null,
                      vacancyNote: surface.advisoryChairPlaque.vacancyNote,
                      tenureLine: advisoryChair
                        ? surface.advisoryChairPlaque.tenureLine
                        : undefined,
                    },
                  ]
                : []),
              {
                title: surface.premierPlaque.title,
                sealGlyph: surface.premierPlaque.sealGlyph,
                holder: premier
                  ? {
                      name: premier.name,
                      href: premierHref ?? undefined,
                      avatarUrl: premier.avatarUrl,
                      partyId: premier.party,
                      partyName: premierPartyDoc?.name,
                      partyColor: premierPartyDoc?.color,
                    }
                  : null,
                vacancyNote: surface.premierPlaque.vacancyNote,
              },
            ]}
          />

          <div className="rounded-2xl border border-card-border bg-card p-6 shadow-card">
            <SectionLabel as="h3">Government record</SectionLabel>
            {premier ? (
              <div className="space-y-3 text-body-sm text-muted">
                {govFormation?.formedTurn && (
                  <p>
                    Formed{" "}
                    {formationTurnToLarpDate(govFormation.formedTurn, {
                      startingYear: executiveGameTime.startingYear,
                      preIterationTurns: executiveGameTime.preIterationTurns,
                    })}
                  </p>
                )}
                {govFormation?.status && (
                  <p className="capitalize">
                    Status:{" "}
                    <span className="font-medium text-foreground">
                      {govFormation.status.replace(/_/g, " ")}
                    </span>
                  </p>
                )}
              </div>
            ) : (
              <p className="text-body-sm text-muted">
                Formation and confidence votes appear above when applicable.
              </p>
            )}
          </div>

          {confidencePanel && (
            <div className="rounded-2xl border border-card-border bg-card p-6 shadow-card">
              <SectionLabel as="h3">{surface.confidencePanel.title}</SectionLabel>
              <p className="-mt-2 mb-4 text-body-sm text-muted">
                {surface.confidencePanel.description}
              </p>

              <div className="mb-4 flex items-end justify-between gap-3">
                <div>
                  <div className="text-3xl font-bold tabular-nums text-foreground">
                    {confidencePanel.confidence}
                    <span className="ml-1 text-body-sm font-normal text-muted">
                      / {MAX_CONFIDENCE}
                    </span>
                  </div>
                </div>
                <span
                  className={`inline-flex shrink-0 items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${confidenceBandBadgeClasses(confidencePanel.band)}`}
                >
                  {confidencePanel.band}
                </span>
              </div>

              <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-card-muted ring-1 ring-card-border">
                <div
                  className={`h-full transition-all ${confidenceBandBarClasses(confidencePanel.band)}`}
                  style={{
                    width: `${Math.max(0, Math.min(100, (confidencePanel.confidence / MAX_CONFIDENCE) * 100))}%`,
                  }}
                  aria-label={`Confidence ${confidencePanel.confidence} of ${MAX_CONFIDENCE}`}
                />
              </div>

              <p className="mb-4 text-body-sm text-muted leading-relaxed">
                {confidencePanel.consequenceDescription}
              </p>

              {confidencePanel.history.length > 0 && (
                <div className="border-t border-card-border pt-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                    Recent drift
                  </p>
                  <ul className="space-y-1.5 text-body-sm">
                    {confidencePanel.history.map((entry, idx) => (
                      <li
                        key={`${entry.turn}-${idx}`}
                        className="flex items-baseline justify-between gap-3"
                      >
                        <span className="min-w-0 flex-1 truncate text-muted">{entry.reason}</span>
                        <span
                          className={`shrink-0 tabular-nums font-semibold ${entry.delta >= 0 ? "text-success" : "text-error"}`}
                        >
                          {entry.delta >= 0 ? "+" : ""}
                          {entry.delta}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="overflow-hidden rounded-2xl border border-card-border bg-card shadow-card">
            <div className="p-6">
              <SectionLabel as="h3">Leader of the Opposition</SectionLabel>
              {oppositionLeaderChar ? (
                <div className="flex items-center gap-4">
                  <Link href={oppositionHref!} className="shrink-0">
                    <Avatar
                      url={oppositionLeaderChar.avatarUrl}
                      name={oppositionLeaderChar.name}
                      size="h-16 w-16"
                      className="rounded-xl text-2xl ring-2 ring-card-border"
                    />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={oppositionHref!}
                      className="text-body-lg font-semibold text-foreground transition-colors hover:text-primary"
                    >
                      {oppositionLeaderChar.name}
                    </Link>
                    <div className="mt-1">
                      {oppositionPartyDoc ? (
                        <PartyChip
                          partyName={oppositionPartyDoc.name}
                          partyColor={oppositionPartyDoc.color}
                          partyId={oppositionLeaderChar.party}
                          countryId={countryId}
                          logoUrl={oppositionPartyDoc.logoUrl}
                        />
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-card-elevated text-2xl text-muted ring-2 ring-dashed ring-card-border">
                    —
                  </div>
                  <div className="flex-1">
                    <p className="italic text-muted">Vacant</p>
                    <p className="mt-0.5 text-body-sm text-muted">{surface.oppositionNote}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-card-border bg-card p-6 shadow-card">
            <SectionLabel as="h3">{surface.seatsPanel.title}</SectionLabel>
            <p className="-mt-2 mb-4 text-body-sm text-muted">
              {Object.values(seatsByParty).reduce((sum, n) => sum + n, 0)} of{" "}
              {config.legislature.lowerChamber.seats} seats filled · sorted by size
            </p>
            {partyRows.length > 0 ? (
              <>
                <div className="mb-5 flex h-5 w-full overflow-hidden rounded-full bg-card-muted ring-1 ring-card-border">
                  {partyRows.map((row) => {
                    const color = row.doc?.color ?? "#6b7280";
                    return (
                      <div
                        key={row.seqKey}
                        className="h-full min-w-0 transition-opacity hover:opacity-90"
                        style={{ flex: row.seats, backgroundColor: color }}
                        title={`${row.doc?.name ?? row.seqKey}: ${row.seats}`}
                      />
                    );
                  })}
                </div>
                <ul className="space-y-2">
                  {partyRows.map((row) => (
                    <li
                      key={row.seqKey}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-card-elevated px-4 py-3"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <PartyChip
                          partyName={row.doc?.name ?? "Independent"}
                          partyColor={row.doc?.color ?? "#888888"}
                          partyId={row.seqKey}
                          countryId={countryId}
                          logoUrl={row.doc?.logoUrl}
                        />
                      </div>
                      <span className="shrink-0 text-body-lg font-bold tabular-nums text-foreground">
                        {row.seats}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex items-center justify-between border-t border-card-border pt-3 text-body-sm">
                  <span className="font-medium text-muted">Majority threshold</span>
                  <span className="font-bold tabular-nums text-foreground">
                    {majorityThreshold}
                  </span>
                </div>
              </>
            ) : (
              <p className="text-muted">{surface.seatsPanel.emptyText}</p>
            )}
          </div>
        </div>
      </div>

      {/* Cabinet narrative + full roster live on the cabinet page; the shared
          activity section below carries the roster column with its
          "All positions" link. */}
    </div>
  );

  return (
    <UKGovernmentLayout
      pmSummary={{
        name: premier?.name ?? null,
        profileHref: premierHref,
        partyName: premierPartyDoc?.name ?? null,
        partyColor: premierPartyDoc?.color ?? null,
        partyId: premier?.party ?? null,
      }}
      pluralityParty={pluralityParty}
      commonsLine={{
        seatsSupporting: isPending ? 0 : governingSeats,
        threshold: majorityThreshold,
        isMinority: !isPending && (formationType === "minority" || lostMajority),
        isPending,
        lostMajority,
        formationType: formationType ?? undefined,
      }}
      statusText={statusStripText}
      hero={surface.hero}
      quickLinksMode="hub"
      countryId={countryId}
    >
      <ExecutiveTabsClient
        countryId={countryId}
        viewerIsLeader={viewerIsLeader}
        viewerIsAdmin={viewerIsAdmin}
        overview={overview}
        isOnePartyState={isOnePartyState}
      />
    </UKGovernmentLayout>
  );
}
