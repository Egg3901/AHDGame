import { getAuthUserWithCharacter } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import {
  getGovernmentFormationsCollection,
  getPMAppointmentVotesCollection,
  getNoConfidenceVotesCollection,
} from "@/lib/db/collections/governmentFormation";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import type {
  AppointmentVotePayload,
  NoConfidenceVotePayload,
} from "@/types/parliamentaryGovernment";
import { UKGovernmentLayout } from "@/components/uk/UKGovernmentLayout";
import { PartyChip } from "@/app/congress/components/CongressShared";
import { SectionLabel } from "@/components/ui";
import { OfficePlaques, type OfficePlaque } from "./components/OfficePlaques";
import { getExecutiveIdentity } from "@/lib/constants/institutionIdentity";
import type {
  Character,
  ElectedOfficial,
  ParliamentaryGovernment,
  PoliticalParty,
} from "@/lib/db/types";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { getParliamentaryExecutiveSurface } from "@/lib/constants/parliamentaryExecutiveSurface";
import { getLowerChamberOfficeType } from "@/lib/legislature/chamberOfficeType";
import { ParliamentaryGovernmentActions } from "./components/ParliamentaryGovernmentActions";
import { ReferendumConsentSection } from "@/components/uk/ReferendumConsentSection";
import { ExecutiveTabsClient } from "./ExecutiveTabsClient";
import { turnToLarpDate } from "@/lib/utils/formatters";
import { fetchImperialPossessive } from "@/lib/imperial";
import {
  checkAppointmentEligibility,
  processParliamentaryGovernmentVotes,
} from "@/lib/parliament/queries";
import { resolveOppositionLeaderFromState } from "@/lib/parliament/oppositionLeader";
import { computeParliamentaryGovernmentTally } from "@/lib/congress/governmentVoteBreakdown";
import { getGameTime } from "@/lib/time/gameTime";
import { getCabinetPositions } from "@/lib/constants/cabinetMechanics";
import { resolveCabinetRoster } from "@/lib/cabinet/rosterEra";
import { getLiveGameYear } from "@/lib/cabinet/liveGameYear";
import { getEligibleCabinetCharacters } from "@/lib/uk/cabinetEligibility";
import { ShadowCabinetSection } from "./components/ShadowCabinetSection";
import { ObjectId } from "mongodb";

type PartyRowMeta = {
  seqKey: string;
  seats: number;
  doc: PoliticalParty | null;
};

function characterHref(character: Character): string {
  return `/character/${character.sequentialId ?? character._id.toString()}`;
}

/**
 * Shared executive hub for every multiparty parliamentary country
 * (governmentType parliamentaryMonarchy / parliamentaryRepublic): head of
 * government, opposition, chamber confidence, seat composition, and cabinet
 * entry. All per-country copy (titles, glyphs, hero, optional deputy seat)
 * comes from `getParliamentaryExecutiveSurface`, so a new parliamentary
 * country renders here without a bespoke hub. The US (presidential) keeps the
 * White House surface; CN (onePartyState) keeps its dedicated hub.
 */
export async function ParliamentaryExecutiveHub({ countryId }: { countryId: CountryId }) {
  const surface = getParliamentaryExecutiveSurface(countryId);
  const config = getCountryConfig(countryId);
  const user = await getAuthUserWithCharacter();
  const db = await getDb();
  const lowerChamberKey = getLowerChamberOfficeType(countryId);

  // Inline-resolve any expired parliamentary votes before reading state, so the
  // page never shows a "Voting ended" panel alongside a PM that should already
  // have been removed. The resolver uses an atomic claim to stay race-safe
  // against the hourly turn processor. Pass game time so the resolver agrees
  // with closesAt anchors written at vote creation.
  const executiveGameTime = await getGameTime();
  await processParliamentaryGovernmentVotes(db, countryId, executiveGameTime.effectiveNow);

  const [parlGov, govFormation, imperialPossessive] = await Promise.all([
    // Legacy collection — only UK/JP ever wrote it; null elsewhere.
    db.collection<ParliamentaryGovernment>("parliamentaryGovernments").findOne({ _id: countryId }),
    getGovernmentFormationsCollection(db).findOne({ _id: countryId }),
    surface.heroTitleUsesImperialPossessive
      ? fetchImperialPossessive(db, countryId)
      : Promise.resolve(null),
  ]);

  // governmentFormations is canonical. Only fall back to legacy parliamentaryGovernments
  // when the canonical document is missing entirely — never when it exists with a null
  // PM (that state is meaningful: e.g. immediately after a no-confidence vote passes).
  const pmCharId = govFormation ? govFormation.pmCharacterId : (parlGov?.pmCharacterId ?? null);
  let pmCharacter: Character | null = null;
  if (pmCharId) {
    pmCharacter = await db.collection<Character>("characters").findOne({ _id: pmCharId });
  }

  // Optional deputy seat (IE Tánaiste) — seated through the cabinet as
  // `{ type: "parliamentaryCabinet", positionId }`, so the unified
  // `cabinetMembers` collection is the source of truth, same as the cabinet
  // page. (There is no `electedOfficials` row for it.)
  let deputyCharacter: Character | null = null;
  if (surface.deputyPlaque) {
    const deputyMember = await getCabinetMembersCollection(db).findOne({
      countryId,
      positionId: surface.deputyPlaque.cabinetPositionId,
    });
    if (deputyMember?.characterId) {
      deputyCharacter = await db
        .collection<Character>("characters")
        .findOne({ _id: deputyMember.characterId });
    }
  }

  // --- Government formation: active votes and viewer permissions ---

  let activeAppointmentVotes: AppointmentVotePayload[] = [];
  let activeNoConfidenceVote: NoConfidenceVotePayload | null = null;
  const viewerVotes: Record<string, "aye" | "nay"> = {};
  const viewerWhippedFrom: Record<string, string> = {};

  // Fetch all active appointment votes (multiple may exist concurrently)
  if (govFormation?.status === "pending") {
    const apptVotes = await getPMAppointmentVotesCollection(db)
      .find({ countryId, status: "active" })
      .toArray();
    activeAppointmentVotes = await Promise.all(
      apptVotes.map(async (v) => {
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
        };
      })
    );

    if (user?.character) {
      for (const v of apptVotes) {
        const key = user.character._id.toString();
        const charVote = v.votes[key];
        if (charVote) viewerVotes[v._id.toString()] = charVote;
        const wf = v.whippedFromVote?.[key];
        if (wf) viewerWhippedFrom[v._id.toString()] = wf;
      }
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
      if (user?.character) {
        const key = user.character._id.toString();
        const charVote = noConfVote.votes[key];
        if (charVote) viewerVotes[noConfVote._id.toString()] = charVote;
        const wf = noConfVote.whippedFromVote?.[key];
        if (wf) viewerWhippedFrom[noConfVote._id.toString()] = wf;
      }
    }
  }

  // Viewer appointment eligibility via shared function
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

  // Viewer is a lower-chamber member — only members may cast votes
  let viewerIsMember = false;
  if (user?.character) {
    const memberRecord = await db
      .collection<ElectedOfficial>("electedOfficials")
      .findOne({ characterId: user.character._id, countryId, officeType: lowerChamberKey });
    viewerIsMember = memberRecord != null;
  }

  // No-confidence eligibility and cooldown
  let viewerMayProposeNoConfidence = false;
  let noConfidenceCooldownTurns: number | null = null;
  if (
    viewerIsMember &&
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

  const governmentStatus =
    govFormation && govFormation.status !== "collapsed"
      ? (govFormation.status as "pending" | "formed")
      : null;

  // Seat composition from the lower chamber
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
  const totalSeatsFilled = Object.values(seatsByParty).reduce((sum, n) => sum + n, 0);

  const partySeqNums = [
    ...new Set(sortedParties.map(([k]) => Number.parseInt(k, 10)).filter((n) => !Number.isNaN(n))),
  ];
  const partyDocs = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId, sequentialId: { $in: partySeqNums } })
    .toArray();
  const partyBySeq = new Map(partyDocs.map((p) => [String(p.sequentialId), p]));

  const partyRows: PartyRowMeta[] = sortedParties.map(([seqKey, seats]) => ({
    seqKey,
    seats,
    doc: partyBySeq.get(seqKey) ?? null,
  }));

  const govPartyId = govFormation?.governingPartyId ?? parlGov?.governingPartyId;
  const governingPartySeq = govPartyId ? Number.parseInt(govPartyId, 10) : Number.NaN;
  const governingPartyDoc =
    govPartyId && !Number.isNaN(governingPartySeq)
      ? (partyBySeq.get(govPartyId) ??
        (await db.collection<PoliticalParty>("politicalParties").findOne({
          countryId,
          sequentialId: governingPartySeq,
        })))
      : null;

  async function resolveCharacterParty(
    character: Character | null
  ): Promise<PoliticalParty | null> {
    if (!character?.party) return null;
    const seq = Number.parseInt(character.party, 10);
    if (Number.isNaN(seq)) return null;
    return (
      partyBySeq.get(character.party) ??
      (await db.collection<PoliticalParty>("politicalParties").findOne({
        countryId,
        sequentialId: seq,
      }))
    );
  }
  const pmPartyDoc = await resolveCharacterParty(pmCharacter);
  const deputyPartyDoc = await resolveCharacterParty(deputyCharacter);

  // Find Opposition Leader: chair of the largest party or coalition NOT in
  // government. Shared with the shadow-cabinet route so appointment authority
  // matches this displayed signal exactly (see @/lib/parliament/oppositionLeader).
  let oppositionLeaderChar: Character | null = null;
  let oppositionPartyDoc: PoliticalParty | null = null;
  const oppositionResult = await resolveOppositionLeaderFromState(
    db,
    countryId,
    seatsByParty,
    partyBySeq,
    govFormation,
    parlGov
  );
  if (oppositionResult) {
    oppositionLeaderChar = await db
      .collection<Character>("characters")
      .findOne({ _id: oppositionResult.chairId });
    oppositionPartyDoc = oppositionResult.partyDoc;
  }

  // --- Shadow Cabinet (player suggestion #52): opposition-leader-appointed,
  // display / roleplay only. The shadow roster lives on the opposition party
  // document; the sitting Opposition Leader appoints/clears via the
  // shadow-cabinet route. Reuses the country's cabinet posts as the slots
  // (minus the head-of-government seat — the Opposition Leader is the shadow
  // head). Section renders only when a Leader of the Opposition is resolved.
  const shadowPositions = resolveCabinetRoster(
    getCabinetPositions(countryId),
    await getLiveGameYear(db)
  ).filter((position) => !position.isHeadOfGovernment);
  const viewerIsOppositionLeader =
    !!user?.character &&
    !!oppositionLeaderChar &&
    oppositionLeaderChar._id.equals(user.character._id);
  const shadowAppointees: Record<string, { characterId: string; characterName: string }> = {};
  for (const [positionId, appointment] of Object.entries(oppositionPartyDoc?.shadowCabinet ?? {})) {
    shadowAppointees[positionId] = {
      characterId: appointment.characterId.toString(),
      characterName: appointment.characterName,
    };
  }
  // Candidate pool is only needed by (and only shown to) the Opposition Leader.
  let shadowEligibleCharacters: { _id: string; name: string; partyName?: string }[] = [];
  if (viewerIsOppositionLeader && shadowPositions.length > 0) {
    const eligible = await getEligibleCabinetCharacters(db, countryId, pmCharId ?? new ObjectId());
    shadowEligibleCharacters = eligible.map((candidate) => ({
      _id: candidate._id,
      name: candidate.name,
      partyName: candidate.partyName,
    }));
  }

  const governingSeats =
    govFormation?.totalSeatsSupporting ||
    parlGov?.totalSeatsSupporting ||
    (partyRows[0]?.seats ?? 0);
  const majorityThreshold =
    govFormation?.majorityThreshold ?? parlGov?.majorityThreshold ?? config.coalitionThreshold;

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
    statusStripText =
      govFormation?.status ?? parlGov?.status ?? (pmCharacter ? "formed" : "vacant");
  }

  const pluralityDoc = governingPartyDoc ?? partyRows[0]?.doc ?? null;
  const pluralityId = govPartyId ?? partyRows[0]?.seqKey ?? null;
  const pluralityPartyChip =
    formationType === "coalition"
      ? { partyName: "Plurality Coalition", partyColor: "#6b7280", partyId: "" }
      : pluralityDoc && pluralityId
        ? {
            partyName: pluralityDoc.name,
            partyColor: pluralityDoc.color,
            partyId: pluralityId,
          }
        : null;

  // Tab gating: leader-or-admin sees the Address tab. `pmCharacterId` stores
  // the head of government's character id across all parliamentary countries.
  const viewerIsLeader = !!user?.character && !!pmCharId && pmCharId.equals(user.character._id);
  const viewerIsAdmin = !!user?.isAdmin;

  function plaqueFor(
    meta: { title: string; sealGlyph: string; vacancyNote: string },
    character: Character | null,
    partyDoc: PoliticalParty | null
  ): OfficePlaque {
    return {
      title: meta.title,
      sealGlyph: meta.sealGlyph,
      holder: character
        ? {
            name: character.name,
            href: characterHref(character),
            avatarUrl: character.avatarUrl,
            partyId: character.party,
            partyName: partyDoc?.name,
            partyColor: partyDoc?.color,
          }
        : null,
      vacancyNote: meta.vacancyNote,
    };
  }

  const leftPlaques: OfficePlaque[] = [
    plaqueFor(surface.headPlaque, pmCharacter, pmPartyDoc),
    ...(surface.deputyPlaque
      ? [plaqueFor(surface.deputyPlaque, deputyCharacter, deputyPartyDoc)]
      : []),
  ];

  const overview = (
    <div className="space-y-8">
      {/* Referendum consent prompt — the PM grants/declines from their office. */}
      <ReferendumConsentSection countryId={countryId} />

      <ParliamentaryGovernmentActions
        countryCode={countryId.toLowerCase()}
        governmentStatus={governmentStatus}
        activeAppointmentVotes={activeAppointmentVotes}
        activeNoConfidenceVote={activeNoConfidenceVote}
        viewerMayAppoint={viewerMayAppoint}
        viewerIsCommonsMp={viewerIsMember}
        viewerMayProposeNoConfidence={viewerMayProposeNoConfidence}
        noConfidenceCooldownTurns={noConfidenceCooldownTurns}
        viewerVotes={viewerVotes}
        viewerWhippedFrom={viewerWhippedFrom}
        executiveTitle={surface.executiveTitle}
        memberLabel={surface.memberLabel}
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
          {/* B office plaques (locked composite). */}
          <OfficePlaques
            countryId={countryId}
            identity={getExecutiveIdentity(countryId)}
            gridClassName={leftPlaques.length > 1 ? "grid gap-3.5 sm:grid-cols-2" : "grid"}
            plaques={leftPlaques}
          />

          <div className="rounded-2xl border border-card-border bg-card p-6 shadow-card">
            <SectionLabel as="h3">Government record</SectionLabel>
            {pmCharacter ? (
              <div className="space-y-3 text-body-sm text-muted">
                {(govFormation?.formedTurn ?? parlGov?.formedTurn) && (
                  <p>Formed {turnToLarpDate((govFormation?.formedTurn ?? parlGov!.formedTurn)!)}</p>
                )}
                {(govFormation?.status ?? parlGov?.status) && (
                  <p className="capitalize">
                    Status:{" "}
                    <span className="font-medium text-foreground">
                      {(govFormation?.status ?? parlGov!.status!).replace(/_/g, " ")}
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
        </div>

        <div className="space-y-6">
          <OfficePlaques
            countryId={countryId}
            identity={getExecutiveIdentity(countryId)}
            gridClassName="grid"
            plaques={[
              plaqueFor(surface.oppositionPlaque, oppositionLeaderChar, oppositionPartyDoc),
            ]}
          />

          <div className="rounded-2xl border border-card-border bg-card p-6 shadow-card">
            <SectionLabel as="h3">{surface.seatsPanel.title}</SectionLabel>
            <p className="-mt-2 mb-4 text-body-sm text-muted">
              {totalSeatsFilled} of {config.legislature.lowerChamber.seats} seats filled · sorted by
              size
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

      {/* Shadow Cabinet (player suggestion #52) — opposition-leader-appointed,
          display only. Rendered only when a Leader of the Opposition exists and
          the country has cabinet posts to shadow. */}
      {oppositionLeaderChar && shadowPositions.length > 0 && (
        <ShadowCabinetSection
          countryCode={countryId.toLowerCase()}
          positions={shadowPositions.map((position) => ({ id: position.id, name: position.name }))}
          appointees={shadowAppointees}
          oppositionLeaderName={oppositionLeaderChar.name}
          oppositionPartyName={oppositionPartyDoc?.name ?? null}
          viewerIsOppositionLeader={viewerIsOppositionLeader}
          eligibleCharacters={shadowEligibleCharacters}
        />
      )}

      {/* Cabinet narrative + full roster live on the cabinet page; the shared
          activity section below carries the roster column with its
          "All positions" link. */}
    </div>
  );

  return (
    <UKGovernmentLayout
      pmSummary={{
        name: pmCharacter?.name ?? null,
        profileHref: pmCharacter ? characterHref(pmCharacter) : null,
        partyName: pmPartyDoc?.name ?? null,
        partyColor: pmPartyDoc?.color ?? null,
        partyId: pmCharacter?.party ?? null,
      }}
      pluralityParty={pluralityPartyChip}
      commonsLine={{
        seatsSupporting: isPending ? 0 : governingSeats,
        threshold: majorityThreshold,
        isMinority: !isPending && (formationType === "minority" || lostMajority),
        isPending,
        lostMajority,
        formationType: formationType ?? undefined,
      }}
      statusText={statusStripText}
      hero={{
        image: surface.hero.image,
        alt: surface.hero.alt,
        title: surface.hero.title ?? `${imperialPossessive} Government`,
        tagline: surface.hero.tagline,
        breadcrumbLast: surface.hero.breadcrumbLast,
      }}
      quickLinksMode="hub"
      countryId={countryId}
    >
      <ExecutiveTabsClient
        countryId={countryId}
        viewerIsLeader={viewerIsLeader}
        viewerIsAdmin={viewerIsAdmin}
        overview={overview}
      />
    </UKGovernmentLayout>
  );
}
