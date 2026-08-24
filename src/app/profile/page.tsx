import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ObjectId, type Filter } from "mongodb";
import { getDb } from "@/lib/mongodb";
import {
  CABINET_OFFICE_TYPES,
  cabinetOfficeTypeForCountry,
  resolveOfficeActionBonus,
} from "@/lib/actions/officeActionBonus";
import { getActionBreakdown } from "@/lib/actions/actionBreakdown";
import { fundraiseYieldLocal } from "@/lib/actions";
import { resolveStartingCountryId } from "@/lib/utils/profileDemographics";
import type { CountryId } from "@/lib/constants/countries";
import type {
  Character,
  State,
  PoliticalParty,
  StatePartyOrg,
  GameConfig,
  User,
  ImperialCharacter,
  GameState,
  Corporation,
} from "@/lib/db/types";
import { getAuthUser } from "@/lib/auth";
import { getOfficeLabel, getPartyHex } from "@/lib/utils/politics";
import { gameDateAnchorFromState } from "@/lib/utils/gameDate";
import {
  calculateFullFundDistribution,
  getPopulationTier,
  DONOR_BASE_BONUS_PER_LEVEL,
} from "@/lib/utils/fundGeneration";
import {
  calculateFavorabilityAboveThresholdPenalty,
  calculateNationalInfluenceGain,
  calculatePoliticalInfluenceDecay,
} from "@shared/constants/formulas";
import {
  DEFAULT_PARTY_INFLUENCE_MAX_BONUS,
  DEFAULT_PARTY_INFLUENCE_POOL_MULTIPLIER,
  computeClosenessScalar,
  computeLeadershipBonus,
  computeInfamyPenalty,
  computeTurnGain,
  computeBonusActions,
} from "@/lib/parties/influenceQueries";
import { PolicyDemographicsCard } from "./components/PolicyDemographicsCard";
import { CharacterStatsPanel } from "./components/CharacterStatsPanel";
import { isRpgStatsEnabled } from "@/lib/stats/featureFlag";
import type { CompassMarker } from "@/components/PoliticalCompass";
import { ProfileAchievements } from "@/components/ProfileAchievements";
import { checkPassiveProfileAchievements } from "@/lib/achievements/triggers";
import { DiscordBadge } from "./DiscordBadge";
import { getOnlineStatus } from "@/lib/utils/onlineStatus";
import { ProfileHeader } from "./components/ProfileHeader";
import { ProfileTabs } from "@/components/profile/ProfileTabs";
import { loadGeneralPosting, EMPTY_POSTING } from "@/lib/military/generalPosting";
import { getNationalDoctrine } from "@/lib/db/collections/nationalDoctrine";
import { getCharacterCommission } from "@/lib/db/collections/characterGenerals";
import { getMilitaryCommands } from "@/lib/db/collections/militaryCommands";
import { resolveGeneralEra } from "@/lib/military/currentGeneralEra";
import { CUR_ERA_YEAR } from "@/lib/military/generalsTree";
import { PoliticalStanding } from "./components/PoliticalStanding";
import { FinancialStrip } from "./components/FinancialStrip";
import { CareerHistory } from "./components/CareerHistory";
import {
  fetchPartyHistory,
  fetchPartyNameChanges,
  buildPartyTenures,
  type PartyTenure,
} from "@/lib/parties/historyQuery";
import { ConstituencySelector } from "./components/ConstituencySelector";
import { CeoCorporationCard } from "./components/CeoCorporationCard";
import { NewPlayerBanner } from "./components/OnboardingCard";
import { ReplayTutorialButton } from "@/components/tutorial/ReplayTutorialButton";
import { OnboardingChecklist } from "./components/OnboardingChecklist";
import { isOnboardingChecklistEnabled } from "@/lib/onboarding/featureFlag";
import { isOnboardingDismissed, loadOnboardingChecklist } from "@/lib/onboarding/checklist";
import { onboardingRewardAmount } from "@/lib/onboarding/reward";
import { StatAllocationBanner } from "./components/StatAllocationBanner";
import { SectionHeader } from "./components/ProfileMeters";
import { buildCharacterHref } from "@/lib/utils/profileUrls";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { getTotalPersonalLiquidWealth, getHomeCurrency } from "@/lib/currency/characterFunds";
import { getNationalNpiOrdinalRank } from "@/lib/character/nationalNpiOrdinalRank";
import { getFinancialData } from "@/lib/character/financialData";
import { unionContributionIncomePerTurn } from "@/lib/unions/unionContributionIncome";
import { ACTION_HOARDING_THRESHOLD } from "@/lib/actions/recommendationsConstants";

const MIN_BASE_ACTIONS_PER_TURN = 4;

async function getCharacterData() {
  const user = await getAuthUser();
  if (!user) return null;

  const db = await getDb();

  // Resolve character by activeCharacterId if set (admin multi-character), fallback to userId
  const userDoc = await db.collection<User>("users").findOne({ _id: new ObjectId(user.userId) });

  // Redirect to imperial profile when in imperial mode
  if (userDoc?.activeCharacterType === "imperial" && userDoc.activeImperialCharacterId) {
    const imperial = await db
      .collection<ImperialCharacter>("imperialCharacters")
      .findOne(
        { _id: userDoc.activeImperialCharacterId, userId: new ObjectId(user.userId) },
        { projection: { sequentialId: 1 } }
      );
    if (imperial) {
      redirect(`/imperial/${imperial.sequentialId}`);
    }
  }

  const characterQuery = userDoc?.activeCharacterId
    ? { _id: userDoc.activeCharacterId, userId: new ObjectId(user.userId) }
    : { userId: new ObjectId(user.userId) };
  const character = await db.collection<Character>("characters").findOne(characterQuery);
  if (!character) return null;

  const hasParty = Boolean(character.party && character.party !== "independent");
  const statePartyKey = `${character.homeState}_${character.party}`;

  const viewerUser = userDoc;
  const [
    homeState,
    gameConfig,
    party,
    statePartyOrg,
    ceoCorporation,
    forexEnabled,
    gameState,
    partyHistoryEvents,
  ] = await Promise.all([
    db
      .collection<State>("states")
      .findOne({ _id: character.homeState, countryId: character.countryId }),
    db.collection<GameConfig>("gameConfig").findOne({ _id: "default" }),
    hasParty
      ? (async () => {
          const partySeqId = parseInt(character.party as string, 10);
          if (isNaN(partySeqId)) return null;
          const charCountry = character.countryId ?? "US";
          return db
            .collection<PoliticalParty>("politicalParties")
            .findOne({ sequentialId: partySeqId, countryId: charCountry });
        })()
      : Promise.resolve(null),
    hasParty
      ? db.collection<StatePartyOrg>("statePartyOrg").findOne({ _id: statePartyKey })
      : Promise.resolve(null),
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
    isForexEnabled(),
    db.collection<GameState>("gameState").findOne({ _id: "current" }),
    fetchPartyHistory(db, character._id),
  ]);

  const viewerDisablesAutoplay = viewerUser?.disableAutoplayOnOtherProfiles ?? false;

  const rpgStatsEnabled = await isRpgStatsEnabled({
    rpgStatsEnabled: gameState?.rpgStatsEnabled,
  });

  // New-player onboarding checklist: derive step completion only while the
  // card is actually shown (flag on, not dismissed, reward not yet claimed).
  const onboardingChecklistEnabled = await isOnboardingChecklistEnabled({
    onboardingChecklistEnabled: gameState?.onboardingChecklistEnabled,
  });
  let onboardingChecklist: {
    steps: Array<{ id: string; title: string; body: string; link: string; done: boolean }>;
    completedCount: number;
    total: number;
    rewardAmount: number;
  } | null = null;
  if (
    onboardingChecklistEnabled &&
    !isOnboardingDismissed(character) &&
    character.onboarding?.rewardGrantedAt === undefined
  ) {
    const checklist = await loadOnboardingChecklist(db, character);
    onboardingChecklist = {
      steps: checklist.steps,
      completedCount: checklist.completedCount,
      total: checklist.total,
      rewardAmount: onboardingRewardAmount(gameConfig?.startingFunds),
    };
  }

  const statePopulation = homeState?.population ?? 0;
  const stateTaxRate = statePartyOrg?.stateTaxRate ?? 0;
  const nationalTaxRate = party?.nationalTaxRate ?? 0;
  const fundDistribution = calculateFullFundDistribution(
    statePopulation,
    character.donorBaseLevel,
    character.currentOffice,
    stateTaxRate,
    nationalTaxRate,
    homeState?.gdp,
    character.countryId,
    character.politicalInfluence ?? 0
  );

  // Determine character's country for country-specific NPI rankings
  const charCountryId = character.countryId;

  const npiCountryMatch: Filter<Character> = { countryId: charCountryId ?? "US" };

  const [topNPI, topDonor] = await Promise.all([
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
  ]);
  const maxNPI = Math.max(1, topNPI[0]?.nationalInfluence ?? 1);
  const maxDonorLevel = Math.max(1, topDonor[0]?.donorBaseLevel ?? 1);

  // Resolve party names for career history display using compound "countryId:seqId" keys
  // so the same sequentialId in different countries maps to the right name.
  const careerPartyIds = [
    ...new Set((character.careerHistory ?? []).map((e) => e.party).filter((p): p is string => !!p)),
  ];
  const partyNames: Record<string, string> = {};
  if (careerPartyIds.length > 0) {
    const numericIds = careerPartyIds.map(Number).filter((n) => !isNaN(n));
    if (numericIds.length > 0) {
      const parties = await db
        .collection<PoliticalParty>("politicalParties")
        .find({ sequentialId: { $in: numericIds } })
        .project({ sequentialId: 1, name: 1, countryId: 1 })
        .toArray();
      for (const p of parties) {
        partyNames[`${p.countryId}:${p.sequentialId}`] = p.name;
      }
    }
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

  const nationalNpiOrdinalRank = await getNationalNpiOrdinalRank(db, character);

  // Conflict-path reads are independent of one another — one round, with the
  // posting load still gated on the commission (an uncommissioned character
  // has no order of battle).
  const conflictExtras = gameState?.conflictsEnabled
    ? await (async () => {
        const [doctrine, commission, generalEra, commands] = await Promise.all([
          getNationalDoctrine(db, charCountryId ?? "US"),
          getCharacterCommission(db, character._id.toString()),
          resolveGeneralEra(db),
          getMilitaryCommands(db, charCountryId ?? "US"),
        ]);
        return {
          doctrineAdopted: doctrine.adopted,
          // A dismissed general's retained record is not surfaced as an active profile.
          general: commission.commissioned ? commission.general : null,
          generalPosting: commission.commissioned
            ? await loadGeneralPosting(db, character._id.toString(), charCountryId ?? "US")
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
        generalPosting: EMPTY_POSTING,
        generalEra: CUR_ERA_YEAR,
        isCommandingGeneral: false,
      };

  return {
    character,
    homeState,
    party,
    hasParty,
    user: { username: user.username, isAdmin: user.isAdmin, isModerator: user.isModerator },
    fundDistribution,
    stateTaxRate,
    nationalTaxRate,
    statePopulation,
    gameConfig,
    viewerDisablesAutoplay,
    maxNPI,
    maxDonorLevel,
    discordId: viewerUser?.discordId ?? null,
    discordUsername: viewerUser?.discordUsername ?? null,
    discordAvatar: viewerUser?.discordAvatar ?? null,
    lastActivity: viewerUser?.lastActivity ?? null,
    patreonHighlightColor: viewerUser?.patreonHighlightColor ?? null,
    patreonTier: viewerUser?.patreonTier ?? null,
    patreonExpiresAt: viewerUser?.patreonExpiresAt ?? null,
    patreonSince: viewerUser?.patreonSince ?? null,
    patreonProfileBorder: viewerUser?.patreonProfileBorder ?? null,
    countrySlug: charCountryId?.toLowerCase() ?? "us",
    partyNames,
    partyHistory,
    ceoCorporation,
    forexEnabled,
    rpgStatsEnabled,
    onboardingChecklistEnabled,
    onboardingChecklist,
    nationalNpiOrdinalRank,
    conflictsEnabled: !!gameState?.conflictsEnabled,
    ...conflictExtras,
    gameDateAnchor: gameState ? gameDateAnchorFromState(gameState) : undefined,
    iteration: gameState?.iteration ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

export default async function ProfilePage() {
  const [t, locale] = await Promise.all([getTranslations("profile"), getLocale()]);
  const data = await getCharacterData();
  if (!data) {
    // `getCharacterData` returns null for both "not authenticated" and
    // "authenticated but no character". Disambiguate so an authenticated
    // user (e.g. an admin who just ran a Game Reset) doesn't bounce back
    // to /login in a loop.
    const user = await getAuthUser();
    if (!user) redirect("/login");
    redirect("/create-character");
  }

  const db = await getDb();
  const [financialData, unionContribution] = await Promise.all([
    getFinancialData(data.character._id),
    unionContributionIncomePerTurn(db, data.character._id),
  ]);
  const { corporation, bondIncomePerTurn, dividendIncomePerTurn, portfolioValue, fxRatesRecord } =
    financialData;

  const {
    character,
    homeState,
    party,
    hasParty,
    user,
    fundDistribution,
    statePopulation,
    gameConfig,
    viewerDisablesAutoplay,
    maxNPI,
    maxDonorLevel,
    discordId,
    discordUsername,
    discordAvatar,
    lastActivity,
    patreonHighlightColor,
    patreonTier,
    patreonExpiresAt,
    patreonSince,
    patreonProfileBorder,
    countrySlug,
    partyNames,
    partyHistory,
    ceoCorporation,
    forexEnabled,
    rpgStatsEnabled,
    onboardingChecklistEnabled,
    onboardingChecklist,
    nationalNpiOrdinalRank,
    gameDateAnchor,
    conflictsEnabled,
    doctrineAdopted,
    general,
    generalEra,
    generalPosting,
    isCommandingGeneral,
    iteration,
  } = data;

  const econ = character.policies.economic ?? 0;
  const social = character.policies.social ?? 0;
  const partyHex = getPartyHex(character.party, party?.color ?? undefined);
  const profileAccentHex = patreonHighlightColor ?? partyHex;

  const compassMarkers: CompassMarker[] = [];
  if (hasParty && party?.economicPosition !== undefined && party?.socialPosition !== undefined) {
    compassMarkers.push({
      economic: party.economicPosition,
      social: party.socialPosition,
      label: t("positions.markerParty"),
      color: profileAccentHex,
    });
  }
  if (homeState?.cachedEconomicLean !== undefined && homeState?.cachedSocialLean !== undefined) {
    compassMarkers.push({
      economic: homeState.cachedEconomicLean,
      social: homeState.cachedSocialLean,
      label: t("positions.markerState"),
      color: "#38bdf8",
    });
  }

  const influence = character.politicalInfluence ?? 0;
  const nationalInfluence = character.nationalInfluence ?? 0;
  const influenceDecay = calculatePoliticalInfluenceDecay(influence).toFixed(2);
  const nationalGainPerTurn = calculateNationalInfluenceGain(influence).toFixed(2);
  const favorability = character.favorability ?? 50;
  const infamy = character.infamy ?? 0;
  const infamyPenalty = infamy > 20 ? ((infamy - 20) * 0.05).toFixed(2) : null;
  const favAboveThresholdPenalty = calculateFavorabilityAboveThresholdPenalty(favorability);
  const favDecayDisplay = favAboveThresholdPenalty > 0 ? favAboveThresholdPenalty.toFixed(1) : null;

  const baseActionsPerTurn = Math.max(
    gameConfig?.baseActionsPerTurn ?? 0,
    MIN_BASE_ACTIONS_PER_TURN
  );
  /*
   * Chair role lives on centralBanks.chairCharacterId and cabinet membership in
   * the unified cabinetMembers collection — neither on currentOffice. Both
   * bonuses stack on the elected seat; cabinet appointment overwrites
   * currentOffice with a cabinet key, so the seat is recovered from
   * electedOfficials. Mirrors actionRefresh so the displayed number matches.
   */
  const apDb = await getDb();
  const [chairBankRow, cabinetSeat] = await Promise.all([
    apDb
      .collection("centralBanks")
      .findOne({ chairCharacterId: character._id }, { projection: { _id: 1 } }),
    apDb
      .collection("cabinetMembers")
      .findOne({ characterId: character._id }, { projection: { countryId: 1, positionId: 1 } }),
  ]);
  const electedSeat =
    character.currentOffice && CABINET_OFFICE_TYPES.has(character.currentOffice.type)
      ? await apDb
          .collection<{ officeType: string }>("electedOfficials")
          .findOne({ characterId: character._id }, { projection: { officeType: 1 } })
      : null;
  const officeActionBonus = resolveOfficeActionBonus({
    currentOfficeType: character.currentOffice?.type,
    electedSeatOfficeType: electedSeat?.officeType,
    isCabinetMember: cabinetSeat != null,
    cabinetOfficeType: cabinetSeat
      ? cabinetOfficeTypeForCountry((cabinetSeat.countryId ?? character.countryId) as CountryId)
      : undefined,
    officeActionBonus: gameConfig?.officeActionBonus,
    countryId: (character.countryId ?? "US") as CountryId,
  });
  const chairActionBonus = chairBankRow ? (gameConfig?.chairActionBonus ?? 3) : 0;
  const totalActionsPerTurn = baseActionsPerTurn + officeActionBonus + chairActionBonus;
  const actionHoarding = character.actions > ACTION_HOARDING_THRESHOLD;

  void checkPassiveProfileAchievements(character.userId, character._id, {
    iteration,
    hasCeoCorp: ceoCorporation != null,
    hasCabinetSeat: cabinetSeat != null,
    hasCentralBankChair: chairBankRow != null,
    isPartyChair: hasParty && party?.chairId?.toString() === character._id.toString(),
    hasElectedOffice: character.currentOffice != null,
    bondIncomePerTurn: bondIncomePerTurn ?? 0,
    dividendIncomePerTurn: dividendIncomePerTurn ?? 0,
    characterCreatedAt: new Date(character.createdAt),
    statsAllocated: character.statsAllocated === true,
    onboardingComplete: character.onboarding?.rewardGrantedAt !== undefined,
    // The legacy leaderboard is a full historical aggregation, so do not add it to profile loads.
    hallOfFameTop10: false,
  }).catch(() => {});

  // Party influence per-turn stats
  const partyInfluenceMaxBonus = Math.max(
    gameConfig?.partyInfluenceMaxBonus ?? 0,
    DEFAULT_PARTY_INFLUENCE_MAX_BONUS
  );
  let partyInfluenceNetGain: number | undefined;
  let bonusActionsFromParty: number | undefined;
  let partyInfluenceShare: number | undefined;
  if (hasParty && party) {
    const closeness = computeClosenessScalar(
      character.policies.economic,
      character.policies.social,
      party.economicPosition,
      party.socialPosition
    );
    const lBonus = computeLeadershipBonus(character._id, party);
    const piMaxPenalty = gameConfig?.partyInfluenceMaxPenalty ?? 4;
    const piPenalty = computeInfamyPenalty(infamy, piMaxPenalty);
    const piBaseRate = gameConfig?.partyInfluenceBaseRate ?? 3;
    const tGain = computeTurnGain(closeness, lBonus, piPenalty, piBaseRate);
    const decayRate = gameConfig?.partyInfluenceDecayRate ?? 0.04;
    partyInfluenceNetGain = tGain - (character.partyInfluence ?? 0) * decayRate;

    const charCountry = character.countryId ?? "US";
    const piDb = await getDb();
    const poolAgg = await piDb
      .collection<Character>("characters")
      .aggregate<{ totalInfluence: number; memberCount: number }>([
        {
          $match: {
            party: character.party,
            countryId: charCountry,
            isBanned: { $ne: true },
          },
        },
        {
          $group: {
            _id: null,
            totalInfluence: { $sum: "$partyInfluence" },
            memberCount: { $sum: 1 },
          },
        },
      ])
      .toArray();
    const totalInfluence = poolAgg[0]?.totalInfluence ?? 0;
    const memberCount = poolAgg[0]?.memberCount ?? 1;
    const poolMultiplier = Math.max(
      gameConfig?.partyInfluencePoolMultiplier ?? 0,
      DEFAULT_PARTY_INFLUENCE_POOL_MULTIPLIER
    );
    bonusActionsFromParty = computeBonusActions(
      character.partyInfluence ?? 0,
      totalInfluence,
      poolMultiplier * memberCount,
      closeness,
      partyInfluenceMaxBonus
    );
    partyInfluenceShare =
      totalInfluence > 0
        ? Math.round(((character.partyInfluence ?? 0) / totalInfluence) * 1000) / 10
        : 0;
  }

  const actionBreakdown = getActionBreakdown({
    currentOfficeType: character.currentOffice?.type,
    electedSeatOfficeType: electedSeat?.officeType,
    isCabinetMember: cabinetSeat != null,
    cabinetPositionId: cabinetSeat?.positionId,
    countryId: (character.countryId ?? "US") as CountryId,
    officeActionBonus: gameConfig?.officeActionBonus,
    baseActionsPerTurn,
    chairActionBonus,
    bonusActionsFromParty: bonusActionsFromParty ?? 0,
  });

  const populationTier = getPopulationTier(statePopulation);

  const memberSince = new Date(character.createdAt).toLocaleDateString(locale, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const favColor =
    favorability >= 60 ? "var(--success)" : favorability >= 40 ? "var(--warning)" : "var(--error)";

  const stateLabel = homeState?.name ?? character.homeState;

  return (
    <div className="min-h-screen bg-background pb-16">
      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-8 space-y-8 overflow-x-hidden">
        {/* Hero Profile Header */}
        <ProfileHeader
          character={character}
          party={party}
          user={user}
          memberSince={memberSince}
          officeLabel={getOfficeLabel(character.currentOffice, character.countryId)}
          stateLabel={stateLabel}
          campaignSongUrl={character.campaignSongUrl}
          campaignSongAutoplay={character.campaignSongAutoplay}
          viewerDisablesAutoplay={viewerDisablesAutoplay}
          countrySlug={countrySlug}
          patreonHighlightColor={patreonHighlightColor}
          patreonTier={patreonTier}
          patreonExpiresAt={patreonExpiresAt}
          patreonSince={patreonSince}
          patreonProfileBorder={patreonProfileBorder}
          ownProfileHref={buildCharacterHref(character)}
        />

        <ConstituencySelector />

        {/* New player onboarding: checklist when the flag is on, legacy banner otherwise */}
        {onboardingChecklistEnabled
          ? onboardingChecklist && (
              <OnboardingChecklist
                steps={onboardingChecklist.steps}
                completedCount={onboardingChecklist.completedCount}
                total={onboardingChecklist.total}
                rewardAmount={onboardingChecklist.rewardAmount}
              />
            )
          : !character.onboardingDismissed && <NewPlayerBanner />}

        <div className="flex justify-end">
          <ReplayTutorialButton />
        </div>

        {/* Persistent reminder when the one-time stat allocation was set aside */}
        {rpgStatsEnabled && !character.statsAllocated && character.statAllocationDismissed && (
          <StatAllocationBanner />
        )}

        <ProfileTabs
          conflictsEnabled={conflictsEnabled}
          adopted={doctrineAdopted}
          general={general}
          editable={true}
          curEra={generalEra}
          posting={generalPosting}
          isCommandingGeneral={isCommandingGeneral}
          subject={{
            id: character._id.toString(),
            name: character.name,
            countryCode: (character.countryId ?? "US").toLowerCase(),
          }}
        >
          {/* Main Dashboard Grid */}
          <div className="grid gap-8 lg:grid-cols-3 max-w-full">
            {/* Left Column: Stats & Finances (2/3) */}
            <div className="lg:col-span-2 space-y-8 min-w-0">
              <PoliticalStanding
                isOwnProfile={true}
                nationalNpiLeaderRank={
                  nationalNpiOrdinalRank <= 3 ? (nationalNpiOrdinalRank as 1 | 2 | 3) : undefined
                }
                character={character}
                homeState={homeState}
                influence={influence}
                nationalInfluence={nationalInfluence}
                influenceDecay={influenceDecay}
                nationalGainPerTurn={nationalGainPerTurn}
                favorability={favorability}
                favColor={favColor}
                favDecayDisplay={favDecayDisplay}
                infamy={infamy}
                infamyPenalty={infamyPenalty}
                maxNPI={maxNPI}
                baseActionsPerTurn={baseActionsPerTurn}
                officeActionBonus={officeActionBonus}
                chairActionBonus={chairActionBonus}
                actionBreakdown={actionBreakdown}
                totalActionsPerTurn={totalActionsPerTurn}
                actionHoarding={actionHoarding}
                bonusActionsFromParty={bonusActionsFromParty}
                partyInfluenceMaxBonus={partyInfluenceMaxBonus}
                partyInfluenceNetGain={partyInfluenceNetGain}
                partyInfluenceShare={partyInfluenceShare}
              />

              {rpgStatsEnabled && character.stats && (
                <CharacterStatsPanel
                  stats={character.stats}
                  canReallocate={!!character.statsAllocated && !character.statsReallocationUsed}
                />
              )}
            </div>

            {/* Right Column: Policy & History (1/3) */}
            <div className="space-y-8 min-w-0">
              <PolicyDemographicsCard
                economic={econ}
                social={social}
                dotColor={profileAccentHex}
                markers={compassMarkers.length > 0 ? compassMarkers : undefined}
                demographics={character.demographics}
                startingCountryId={resolveStartingCountryId(character)}
                currentCountryId={character.countryId}
              />

              {ceoCorporation && (
                <CeoCorporationCard
                  corporationName={ceoCorporation.name}
                  corporationRouteId={String(
                    ceoCorporation.sequentialId ?? ceoCorporation._id.toString()
                  )}
                  logoUrl={ceoCorporation.logoUrl}
                  brandColor={ceoCorporation.brandColor}
                  isNationalEnterprise={
                    Boolean(ceoCorporation.countryOwnerId) || Boolean(ceoCorporation.isNationalized)
                  }
                />
              )}

              <section className="rounded-xl border border-card-border bg-card shadow-card overflow-hidden">
                <div className="px-6 pt-5 pb-0">
                  <SectionHeader>{t("finances.title")}</SectionHeader>
                  <p className="-mt-2 mb-4 text-xs text-muted">{t("finances.subtitle")}</p>
                </div>
                <FinancialStrip
                  donorLevel={character.donorBaseLevel}
                  maxDonorLevel={maxDonorLevel}
                  campaignFunds={character.currencyBalances?.campaign ?? character.funds ?? 0}
                  cashOnHand={getTotalPersonalLiquidWealth(character, forexEnabled, fxRatesRecord)}
                  currency={getHomeCurrency(character)}
                  donorIncome={{
                    passivePerHour: fundDistribution.donorBaseBonus,
                    perLevelRate: DONOR_BASE_BONUS_PER_LEVEL[populationTier],
                    fundraiseYield: fundraiseYieldLocal(character, forexEnabled),
                    populationTier,
                    influenceMultiplier: 1 + (character.politicalInfluence ?? 0) / 100,
                  }}
                  campaignIncome={{
                    populationTier,
                    baseGen: fundDistribution.baseGeneration,
                    donorBonus: fundDistribution.donorBaseBonus,
                    officeBonus: fundDistribution.officeBonus,
                    unionContribution,
                    totalTax: fundDistribution.stateTaxAmount + fundDistribution.nationalTaxAmount,
                    netIncome: fundDistribution.characterReceives + unionContribution,
                  }}
                  personalIncome={{
                    ceoSalaryPerHour: corporation ? corporation.ceoSalary / 24 : undefined,
                    ceoSalaryCurrencyCode: corporation?.liquidCurrencyCode ?? null,
                    bondIncomePerTurn,
                    dividendIncomePerTurn,
                    portfolioValue,
                    forexBalances: character.currencyBalances
                      ? {
                          personal: character.currencyBalances.personal,
                          savings: character.currencyBalances.savings,
                        }
                      : undefined,
                  }}
                  portfolioHref="/portfolio"
                />
              </section>

              {(discordId || lastActivity) && (
                <section className="rounded-xl border border-card-border bg-card p-5 shadow-card">
                  <SectionHeader>{t("social.title")}</SectionHeader>
                  <div className="flex flex-wrap items-center gap-3">
                    {discordId && (
                      <DiscordBadge
                        discordId={discordId}
                        discordUsername={discordUsername}
                        discordAvatar={discordAvatar}
                      />
                    )}
                    {lastActivity &&
                      (() => {
                        const online = getOnlineStatus(lastActivity);
                        return (
                          <span className="inline-flex items-center gap-2 text-xs text-muted">
                            <span
                              className={`h-2 w-2 rounded-full ${online.isOnline ? "bg-success" : "bg-muted"}`}
                              aria-hidden
                            />
                            {online.text}
                          </span>
                        );
                      })()}
                  </div>
                </section>
              )}

              <CareerHistory
                character={{
                  careerHistory: character.careerHistory,
                  currentOffice: character.currentOffice,
                  countryId: character.countryId,
                }}
                partyNames={partyNames}
                gameDateAnchor={gameDateAnchor}
                partyHistory={partyHistory}
              />
            </div>
          </div>

          {/* Achievements Full Width */}
          <div className="rounded-xl border border-card-border bg-card p-6 shadow-card">
            <SectionHeader>{t("achievements.title")}</SectionHeader>
            <ProfileAchievements
              characterId={character._id.toString()}
              characterHref={buildCharacterHref(character)}
              isOwnProfile={true}
            />
          </div>
        </ProfileTabs>
      </main>
    </div>
  );
}
