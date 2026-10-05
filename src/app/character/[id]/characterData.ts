import { redirect } from "next/navigation";
import { ObjectId } from "mongodb";
import { loadGeneralPosting, EMPTY_POSTING } from "@/lib/military/generalPosting";
import { getNationalDoctrine } from "@/lib/db/collections/nationalDoctrine";
import { getCharacterCommission } from "@/lib/db/collections/characterGenerals";
import { getMilitaryCommands } from "@/lib/db/collections/militaryCommands";
import { resolveGeneralEra } from "@/lib/military/currentGeneralEra";
import { CUR_ERA_YEAR } from "@/lib/military/generalsTree";
import { getDb } from "@/lib/mongodb";
import { resolveGameYear } from "@/lib/era/era";
import type { Filter } from "mongodb";
import type {
  Character,
  Election,
  ElectionCandidate,
  GameConfig,
  GameState,
  NPP,
  State,
  User,
  PoliticalParty,
  StatePartyOrg,
} from "@/lib/db/types";
import type { Corporation } from "@/lib/db/types/corporation";
import { isPatreonActive } from "@/lib/db/types";
import {
  fetchPartyHistory,
  fetchPartyNameChanges,
  buildPartyTenures,
  type PartyTenure,
} from "@/lib/parties/historyQuery";
import { gameDateAnchorFromState } from "@/lib/utils/gameDate";
import { parseCharacterId } from "@/lib/utils/profileUrls";
import type { CountryId } from "@/lib/constants/countries";
import { getNationalNpiOrdinalRank } from "@/lib/character/nationalNpiOrdinalRank";
import { resolveMemberSince } from "@/lib/character/memberSince";
import { loadCharacterByUrlId } from "./characterLoaders";

interface CandidateElection {
  election: Election;
  candidacy: ElectionCandidate;
}

export interface OverviewStatItem {
  label: string;
  value: string | number;
}

function withIndefiniteArticle(label: string): string {
  return /^[aeiou]/i.test(label) ? `an ${label}` : `a ${label}`;
}

function describeEconomicPosition(value: number): string {
  if (value <= -35) return "economically left";
  if (value <= -10) return "economically center-left";
  if (value < 10) return "economically centrist";
  if (value < 35) return "economically center-right";
  return "economically right";
}

function describeSocialPosition(value: number): string {
  if (value <= -35) return "socially progressive";
  if (value <= -10) return "socially center-progressive";
  if (value < 10) return "socially centrist";
  if (value < 35) return "socially center-conservative";
  return "socially conservative";
}

export function buildPublicSummary(args: {
  character: Character;
  partyName: string;
  stateName?: string;
  officeLabel: string;
  electionWins: number;
  electionLosses: number;
  primaryLosses: number;
  officesHeldCount: number;
  activeRaceCount: number;
}) {
  const {
    character,
    partyName,
    stateName,
    officeLabel,
    electionWins,
    electionLosses,
    primaryLosses,
    officesHeldCount,
    activeRaceCount,
  } = args;

  const locationText = stateName ? `from ${stateName}` : "in the simulation";
  const currentRole = character.currentOffice
    ? `${character.name} is ${withIndefiniteArticle(partyName)} politician ${locationText} currently serving as ${officeLabel}.`
    : `${character.name} is ${withIndefiniteArticle(partyName)} politician ${locationText} who is not currently holding elected office.`;

  const details: string[] = [];
  if (electionWins > 0) {
    const officeText =
      officesHeldCount > 0 ? ` across ${officesHeldCount} distinct office roles` : "";
    details.push(
      `They have won ${electionWins} election${electionWins === 1 ? "" : "s"}${officeText}.`
    );
  }
  if (electionLosses > 0 || primaryLosses > 0) {
    const totalLosses = electionLosses + primaryLosses;
    details.push(
      `They have also lost ${totalLosses} race${totalLosses === 1 ? "" : "s"}, including ${primaryLosses} primary ${primaryLosses === 1 ? "contest" : "contests"}.`
    );
  }
  if (activeRaceCount > 0) {
    details.push(
      `They are currently running in ${activeRaceCount} ${activeRaceCount === 1 ? "election" : "elections"}.`
    );
  }

  const econ = character.policies?.economic ?? 0;
  const social = character.policies?.social ?? 0;
  if (econ !== 0 || social !== 0) {
    details.push(
      `Their platform reads as ${describeEconomicPosition(econ)} and ${describeSocialPosition(social)}.`
    );
  }

  return [currentRole, ...details].join(" ");
}

export async function getCharacterById(characterId: string) {
  try {
    const parsed = parseCharacterId(characterId);
    if (!parsed) return null;

    const character = await loadCharacterByUrlId(characterId);

    // ObjectId lookup that resolved — redirect to canonical sequential URL
    if (parsed.type === "objectId" && character?.sequentialId) {
      redirect(`/character/${character.sequentialId}`);
    }

    if (!character) {
      // Check if it's an NPP (only for ObjectId lookups)
      if (parsed.type === "objectId" && ObjectId.isValid(parsed.value)) {
        const db = await getDb();
        const npp = await db.collection<NPP>("npps").findOne({ _id: new ObjectId(parsed.value) });
        if (npp?.sequentialId) redirect(`/politicians/npp/${npp.sequentialId}`);
        if (npp) redirect(`/politicians/npp/${parsed.value}`);
      }
      return null;
    }

    const db = await getDb();
    const user = await db.collection<User>("users").findOne({ _id: character.userId });

    const charCountryId: CountryId = character.countryId ?? "US";

    // Parallel fetch: homeState, gameConfig, NPI/donor rankings, party, candidacies, career parties
    const npiCountryMatch: Filter<Character> = { countryId: charCountryId };

    const partySeqId = parseInt(character.party, 10);
    const partyQuery =
      character.party && character.party !== "independent" && !isNaN(partySeqId)
        ? db
            .collection<PoliticalParty>("politicalParties")
            .findOne({ sequentialId: partySeqId, countryId: charCountryId })
        : Promise.resolve(null);

    const hasParty = character.party && character.party !== "independent";
    const statePartyKey = hasParty ? `${character.homeState}_${character.party}` : null;

    const activeOrUpcomingCandidaciesPromise = db
      .collection<ElectionCandidate>("electionCandidates")
      .find({
        characterId: character._id,
        status: "active",
      })
      .toArray();

    // Resolve party names for career history display (party field stores sequentialId)
    const careerPartyIds = [
      ...new Set(
        (character.careerHistory ?? []).map((e) => e.party).filter((p): p is string => !!p)
      ),
    ];
    const careerPartyIdsNumeric = careerPartyIds.map(Number).filter((n) => !isNaN(n));

    const [
      homeState,
      gameConfig,
      topNPI,
      topDonor,
      party,
      activeOrUpcomingCandidacies,
      careerParties,
      ceoCorporation,
      statePartyOrg,
      gameState,
      partyHistoryEvents,
    ] = await Promise.all([
      db
        .collection<State>("states")
        .findOne({ _id: character.homeState, countryId: character.countryId }),
      db.collection<GameConfig>("gameConfig").findOne({ _id: "default" }),
      db
        .collection<Character>("characters")
        .find({ isBanned: { $ne: true }, ...npiCountryMatch })
        .sort({ nationalInfluence: -1 })
        .limit(1)
        .project({ nationalInfluence: 1 })
        .toArray(),
      db
        .collection<Character>("characters")
        .find({ isBanned: { $ne: true } })
        .sort({ donorBaseLevel: -1 })
        .limit(1)
        .project({ donorBaseLevel: 1 })
        .toArray(),
      partyQuery,
      activeOrUpcomingCandidaciesPromise,
      careerPartyIdsNumeric.length > 0
        ? db
            .collection<PoliticalParty>("politicalParties")
            .find({ sequentialId: { $in: careerPartyIdsNumeric } })
            .project({ sequentialId: 1, name: 1, countryId: 1 })
            .toArray()
        : Promise.resolve([]),
      db.collection<Corporation>("corporations").findOne(
        {
          ceoId: character._id,
          ceoVacant: { $ne: true },
        },
        {
          projection: {
            name: 1,
            sequentialId: 1,
            logoUrl: 1,
            brandColor: 1,
            countryOwnerId: 1,
            isNationalized: 1,
          },
        }
      ),
      statePartyKey
        ? db.collection<StatePartyOrg>("statePartyOrg").findOne({ _id: statePartyKey })
        : Promise.resolve(null),
      db.collection<GameState>("gameState").findOne({ _id: "current" }),
      fetchPartyHistory(db, character._id),
    ]);

    const maxNPI = Math.max(1, topNPI[0]?.nationalInfluence ?? 1);
    const maxDonorLevel = Math.max(1, topDonor[0]?.donorBaseLevel ?? 1);

    const electionIds = activeOrUpcomingCandidacies.map((c) => c.electionId);
    const elections = electionIds.length
      ? await db
          .collection<Election>("elections")
          .find({
            _id: { $in: electionIds },
            status: { $in: ["active", "upcoming"] },
          })
          .sort({ status: 1, endTime: 1, electionType: 1 })
          .toArray()
      : [];

    const electionMap = new Map(elections.map((e) => [e._id.toString(), e]));
    const candidateElections: CandidateElection[] = activeOrUpcomingCandidacies
      .map((c) => ({ candidacy: c, election: electionMap.get(c.electionId.toString()) }))
      .filter((entry): entry is CandidateElection => Boolean(entry.election));

    const partyNames: Record<string, string> = {};
    for (const p of careerParties) {
      partyNames[`${p.countryId}:${p.sequentialId}`] = p.name;
    }

    // Extend partyNames with any old/new party ids referenced by membership
    // events but not seen in careerHistory.
    for (const ev of partyHistoryEvents) {
      if (ev.oldPartyId && ev.oldPartyCountryId && ev.oldPartyName) {
        partyNames[`${ev.oldPartyCountryId}:${ev.oldPartyId}`] = ev.oldPartyName;
      }
      if (ev.newPartyId && ev.newPartyCountryId && ev.newPartyName) {
        partyNames[`${ev.newPartyCountryId}:${ev.newPartyId}`] = ev.newPartyName;
      }
    }
    const partyNameChanges = await fetchPartyNameChanges(db, partyHistoryEvents);
    const partyHistory: PartyTenure[] = buildPartyTenures(
      partyHistoryEvents,
      {
        partyId: character.party ?? "independent",
        partyCountryId: character.countryId,
        partyName: party?.name ?? null,
        joinedAt: character.partyJoinedAt ?? null,
        fallbackDate: new Date(),
      },
      partyNameChanges
    );

    const patreonTier = user?.patreonTier ?? null;
    const patreonExpiresAt = user?.patreonExpiresAt ?? null;
    const patreonActive = isPatreonActive(patreonTier, patreonExpiresAt);

    const nationalNpiOrdinalRank = await getNationalNpiOrdinalRank(db, character);

    return {
      character,
      homeState,
      party,
      candidateElections,
      username: user?.username ?? "",
      isAdmin: user?.isAdmin || false,
      isModerator: user?.isAdmin || false || user?.role === "moderator" || user?.role === "admin",
      isBanned: user?.isBanned || false,
      lastActivity: user?.lastActivity || null,
      membership: resolveMemberSince({
        accountCreatedAt: user?.createdAt,
        profileCreatedAt: character.createdAt,
        historyStartedAt: gameState?.singleplayerConfig ? null : gameState?.createdAt,
      }),
      discordId: user?.discordId ?? null,
      discordUsername: user?.discordUsername ?? null,
      discordAvatar: user?.discordAvatar ?? null,
      patreonTier: patreonActive ? patreonTier : null,
      patreonExpiresAt: patreonActive ? patreonExpiresAt : null,
      patreonSince: patreonActive ? (user?.patreonSince ?? null) : null,
      patreonProfileBorder: patreonActive ? (user?.patreonProfileBorder ?? null) : null,
      patreonHighlightColor: patreonActive ? (user?.patreonHighlightColor ?? null) : null,
      supporterProvider: patreonActive ? (user?.supporterProvider ?? null) : null,
      gameConfig,
      maxNPI,
      maxDonorLevel,
      partyNames,
      partyHistory,
      ceoCorporation,
      statePartyOrg,
      nationalNpiOrdinalRank,
      conflictsEnabled: !!gameState?.conflictsEnabled,
      // Conflict-path reads batched into one round; the posting load stays
      // gated on the commission (only a commissioned general has an order of
      // battle).
      ...(gameState?.conflictsEnabled
        ? await (async () => {
            const [doctrine, commission, generalEra, commands] = await Promise.all([
              getNationalDoctrine(db, character.countryId),
              getCharacterCommission(db, character._id.toString()),
              resolveGeneralEra(db),
              getMilitaryCommands(db, character.countryId),
            ]);
            return {
              doctrineAdopted: doctrine.adopted,
              general: commission.general,
              militaryService: {
                commissioned: commission.commissioned,
                commissionedTurn: commission.commissionedTurn,
                dismissedTurn: commission.dismissedTurn,
              },
              generalPosting: commission.commissioned
                ? await loadGeneralPosting(db, character._id.toString(), character.countryId)
                : EMPTY_POSTING,
              generalEra,
              isCommandingGeneral: commands.some(
                (c) => c.commandingGeneralId === character._id.toString()
              ),
            };
          })()
        : {
            doctrineAdopted: {},
            general: null,
            militaryService: {
              commissioned: false,
              commissionedTurn: undefined,
              dismissedTurn: undefined,
            },
            generalPosting: EMPTY_POSTING,
            generalEra: CUR_ERA_YEAR,
            isCommandingGeneral: false,
          }),
      gameDateAnchor: gameState ? gameDateAnchorFromState(gameState) : undefined,
      gameYear: gameState ? resolveGameYear(gameState) : null,
      enabledCabinetSeats: gameState?.manuallyEnabledSeats,
      gamePreset: gameState?.preset,
    };
  } catch (error) {
    // redirect() throws NEXT_REDIRECT internally — it must propagate, never be caught
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
    console.error("Error fetching character:", error);
    return null;
  }
}
