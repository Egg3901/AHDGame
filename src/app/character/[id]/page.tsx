import { resolveCampaignPriceLevel } from "@/lib/campaigns/rules/priceLevel";
import {
  loadCampaignPriceLevel,
  loadCampaignCurrencyRates,
} from "@/lib/campaigns/campaignCurrency";
import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ObjectId } from "mongodb";
import Link from "next/link";
import { businessProfileView } from "@/lib/character/businessProfileView";
import { ProfileTabs } from "@/components/profile/ProfileTabs";
import { getDb } from "@/lib/mongodb";
import {
  CABINET_OFFICE_TYPES,
  cabinetOfficeTypeForCountry,
  resolveOfficeActionBonus,
} from "@/lib/actions/officeActionBonus";
import { getActionBreakdown } from "@/lib/actions/actionBreakdown";
import { resolvePositionNiBonus } from "@/lib/actions/positionNiBonus";
import { resolveProfilePositionLabels } from "@/lib/profilePositionLabels";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { fundraiseYieldLocal } from "@/lib/actions";
import { resolveStartingCountryId } from "@/lib/utils/profileDemographics";
import { formatElectionTypeLabel } from "@/lib/utils/electionLabels";
import { getSiteUrl } from "@/lib/siteMetadata";
import type {
  Character,
  CongressLeader,
  SupremeCourtSeat,
  ElectedOfficial,
} from "@/lib/db/types";
import { PolicyDemographicsCard } from "@/app/profile/components/PolicyDemographicsCard";
import type { CompassMarker } from "@/components/PoliticalCompass";
import { InteractCard } from "@/app/profile/components/InteractCard";
import { PlayerSafetyActions } from "@/components/profile/PlayerSafetyActions";
import { hasBlocked } from "@/lib/safety/playerSafety";
import { ProfileAchievements } from "@/components/ProfileAchievements";
import { ProfileHeader } from "@/app/profile/components/ProfileHeader";
import { PoliticalStanding } from "@/app/profile/components/PoliticalStanding";
import { FinancialStrip } from "@/app/profile/components/FinancialStrip";
import { CareerHistory } from "@/app/profile/components/CareerHistory";
import { ProfileSocial } from "@/app/profile/components/ProfileSocial";
import { getPartyRoleLabel } from "@/lib/parties/partyRoleLabels";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { getOfficeLabel } from "@/lib/utils/politics";
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
import { buildCharacterHref } from "@/lib/utils/profileUrls";
import { playerWikiSlug } from "@/lib/wiki/playerPages";
import type { CountryId } from "@/lib/constants/countries";
import { SectionHeader } from "@/app/profile/components/ProfileMeters";
import {
  PROFILE_ASIDE_COLUMN_CLASS,
  PROFILE_CONTAINER_CLASS,
  PROFILE_GRID_CLASS,
  PROFILE_LINK_CLASS,
  PROFILE_MAIN_COLUMN_CLASS,
} from "@/app/profile/components/profileStyles";
import {
  COMPASS_PARTY_MARKER,
  COMPASS_SELF_DOT,
  COMPASS_STATE_MARKER,
} from "@/app/profile/components/compassColors";
import { getTranslations } from "next-intl/server";
import { CeoCorporationCard } from "@/app/profile/components/CeoCorporationCard";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { isRpgStatsEnabled } from "@/lib/stats/featureFlag";
import { CharacterStatsPanel } from "@/app/profile/components/CharacterStatsPanel";
import { getTotalPersonalLiquidWealth, getHomeCurrency } from "@/lib/currency/characterFunds";
import { LocWalletStrip } from "@/components/forex/LocWalletStrip";
import { getFinancialData } from "@/lib/character/financialData";
import { unionContributionIncomePerTurn } from "@/lib/unions/unionContributionIncome";
import {
  calculateFullFundDistribution,
  getPopulationTier,
  DONOR_BASE_BONUS_PER_LEVEL,
} from "@/lib/utils/fundGeneration";
import { ACTION_HOARDING_THRESHOLD } from "@/lib/actions/recommendationsConstants";
import { countryElectionsUrl, countryUrl, politiciansUrl, regionUrl } from "@/lib/urls";
import { truncate, loadCharacterByUrlId } from "./characterLoaders";
import { buildPublicSummary, getCharacterById, type OverviewStatItem } from "./characterData";

const MIN_BASE_ACTIONS_PER_TURN = 4;

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const character = await loadCharacterByUrlId(id);
  if (!character) return {};

  const officeLabel = getOfficeLabel(character.currentOffice, character.countryId);
  const locality = `${character.homeState}, ${character.countryId}`;
  const title = `${character.name} | A House Divided`;
  const description =
    truncate(character.bio) ||
    `${officeLabel} · ${character.party} · ${locality}. Career history, policies, and achievements.`;
  const url = `${getSiteUrl()}${buildCharacterHref(character)}`;
  const image = character.avatarUrl || CDN_LOGO_URL;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      type: "profile",
      url,
      images: [{ url: image, width: 512, height: 512, alt: character.name }],
    },
    twitter: { card: "summary", title, description, images: [image] },
  };
}

export default async function CharacterPage({ params }: PageProps) {
  const { id } = await params;
  const [userData, forexEnabled, rpgStatsEnabled, data] = await Promise.all([
    getAuthUserWithCharacter(),
    isForexEnabled(),
    isRpgStatsEnabled(),
    getCharacterById(id),
  ]);

  if (!data) redirect("/map");

  const [financialData, unionContribution] = await Promise.all([
    getFinancialData(data.character._id),
    (async () => {
      const db = await getDb();
      return unionContributionIncomePerTurn(db, data.character._id);
    })(),
  ]);

  const {
    character,
    homeState,
    party,
    candidateElections,
    username,
    isAdmin,
    isModerator,
    isBanned,
    lastActivity,
    discordId,
    discordUsername,
    discordAvatar,
    patreonTier,
    patreonExpiresAt,
    patreonSince,
    patreonProfileBorder,
    patreonHighlightColor,
    supporterProvider,
    gameConfig,
    maxNPI,
    maxDonorLevel,
    partyNames,
    partyHistory,
    ceoCorporation,
    statePartyOrg,
    nationalNpiOrdinalRank,
    conflictsEnabled,
    doctrineAdopted,
    general,
    militaryService,
    generalEra,
    generalPosting,
    isCommandingGeneral,
    gameDateAnchor,
    gameYear,
    enabledCabinetSeats,
    gamePreset,
  } = data;

  const campaignRates = await loadCampaignCurrencyRates(await getDb());
  const campaignPriceLevel = await loadCampaignPriceLevel(await getDb());
  const { corporation, bondIncomePerTurn, dividendIncomePerTurn, fxRatesRecord } = financialData;

  const isOwnProfile = userData?.character?._id?.toString() === character._id.toString();
  // A viewer who blocked this player sees no bio or campaign song from them.
  const viewerHasBlocked =
    !!userData?.userId && !isOwnProfile && character.userId
      ? await hasBlocked(await getDb(), new ObjectId(userData.userId), character.userId)
      : false;
  const canInfluence = userData?.hasCharacter && !isOwnProfile && !isBanned;

  const t = await getTranslations("profile");
  const officeLabel = getOfficeLabel(character.currentOffice, character.countryId);
  const publicPartyName =
    party?.name ?? (character.party === "independent" ? "Independent" : character.party);
  const favorability = character.favorability ?? 50;
  const influence = character.politicalInfluence ?? 0;
  const nationalInfluence = character.nationalInfluence ?? 0;
  const infamy = character.infamy ?? 0;
  const influenceDecay = calculatePoliticalInfluenceDecay(influence).toFixed(2);
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
  // The party-influence pool aggregation (below) is independent of the chair /
  // cabinet lookups and of everything computed between here and its use, so it
  // joins this batch instead of adding a trailing round trip (O2). Gated by the
  // same condition its consumer uses; an empty result when not needed is inert.
  const needsPartyPool = !!(character.party && character.party !== "independent" && party);
  const [chairBankRow, cabinetSeats, congressLeadershipRows, justiceSeat, poolAgg] =
    await Promise.all([
      apDb
        .collection("centralBanks")
        .findOne({ chairCharacterId: character._id }, { projection: { _id: 1 } }),
      getCabinetMembersCollection(apDb)
        .find(
          { characterId: character._id },
          { projection: { countryId: 1, positionId: 1, acting: 1 } }
        )
        .toArray(),
      apDb
        .collection<CongressLeader>("congressLeaders")
        .find({ characterId: character._id }, { projection: { role: 1 } })
        .toArray(),
      apDb
        .collection<SupremeCourtSeat>("supremeCourtSeats")
        .findOne({ justiceCharacterId: character._id }, { projection: { _id: 1 } }),
      needsPartyPool
        ? apDb
            .collection<Character>("characters")
            .aggregate<{ totalInfluence: number; memberCount: number }>([
              {
                $match: {
                  party: character.party,
                  countryId: character.countryId ?? "US",
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
            .toArray()
        : Promise.resolve([] as { totalInfluence: number; memberCount: number }[]),
    ]);
  const cabinetSeat = cabinetSeats[0] ?? null;
  const electedSeat =
    character.currentOffice && CABINET_OFFICE_TYPES.has(character.currentOffice.type)
      ? await apDb.collection<ElectedOfficial>("electedOfficials").findOne(
          { characterId: character._id },
          {
            projection: {
              officeType: 1,
              state: 1,
              seatsHeld: 1,
              senateClass: 1,
              constituency: 1,
              constituencyId: 1,
            },
          }
        )
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
  const positionNiBonus = resolvePositionNiBonus({
    currentOfficeType: character.currentOffice?.type,
    countryId: (character.countryId ?? "US") as CountryId,
    congressLeadershipRoles: congressLeadershipRows.map((row) => row.role),
    isPartyChair: party?.chairId?.toString() === character._id.toString(),
    isPartySubChair:
      party?.viceChairId?.toString() === character._id.toString() ||
      party?.treasurerId?.toString() === character._id.toString(),
    isSeatedJustice: justiceSeat != null,
    cabinetCountryId: cabinetSeat
      ? ((cabinetSeat.countryId ?? character.countryId ?? "US") as CountryId)
      : undefined,
  });
  const nationalGainPerTurn = (calculateNationalInfluenceGain(influence) + positionNiBonus).toFixed(
    2
  );
  const profileBaseOffice =
    character.currentOffice && CABINET_OFFICE_TYPES.has(character.currentOffice.type)
      ? electedSeat
        ? {
            type: electedSeat.officeType,
            state: electedSeat.state ?? character.homeState,
            seatsHeld: electedSeat.seatsHeld,
            senateClass: electedSeat.senateClass,
            constituency: electedSeat.constituency,
            constituencyId: electedSeat.constituencyId,
          }
        : null
      : character.currentOffice;
  const profileOfficeLabels = resolveProfilePositionLabels({
    baseOfficeLabel: getOfficeLabel(profileBaseOffice, character.countryId),
    hasBaseOffice: profileBaseOffice != null,
    congressLeadershipRoles: congressLeadershipRows.map((row) => row.role),
    cabinetPositions: cabinetSeats.map((seat) => ({
      countryId: seat.countryId,
      positionId: seat.positionId,
      acting: seat.acting === true,
    })),
    gameYear,
    enabledCabinetSeats,
  });
  const totalActionsPerTurn = baseActionsPerTurn + officeActionBonus + chairActionBonus;
  const actionHoarding = character.actions > ACTION_HOARDING_THRESHOLD;

  // Party influence per-turn stats (requires party data)
  const partyInfluenceMaxBonus = Math.max(
    gameConfig?.partyInfluenceMaxBonus ?? 0,
    DEFAULT_PARTY_INFLUENCE_MAX_BONUS
  );
  let partyInfluenceNetGain: number | undefined;
  let bonusActionsFromParty: number | undefined;
  let partyInfluenceShare: number | undefined;
  if (character.party && character.party !== "independent" && party) {
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

    // poolAgg was fetched in parallel with the chair/cabinet batch above (O2).
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

  const statePopulation = homeState?.population ?? 0;
  const stateTaxRate = statePartyOrg?.stateTaxRate ?? 0;
  const nationalTaxRate = party?.nationalTaxRate ?? 0;
  // GDP-baseline era for income math: the world's reset preset, so
  // historical worlds project in their own denomination (issue #798).
  const fundDistribution = calculateFullFundDistribution(
    statePopulation,
    character.donorBaseLevel,
    character.currentOffice,
    stateTaxRate,
    nationalTaxRate,
    homeState?.gdp,
    character.countryId,
    character.politicalInfluence ?? 0,
    gamePreset,
    resolveCampaignPriceLevel(gameConfig?.campaignEraPriceLevelEnabled, gamePreset)
  );
  const populationTier = getPopulationTier(statePopulation);

  const memberSince = data.membership.date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const countryIdResolved = character.countryId as CountryId;
  const countrySlug = countryIdResolved.toLowerCase();
  const stateName = homeState?.name ?? character.homeState;
  const careerHistory = character.careerHistory ?? [];
  const electionWins = careerHistory.filter((entry) => entry.type === "elected").length;
  const appointments = careerHistory.filter((entry) => entry.type === "appointed").length;
  const officesHeld = new Set(
    careerHistory
      .filter((entry) => entry.type === "elected" || entry.type === "appointed")
      .map((entry) => entry.officeLabel)
      .filter(Boolean)
  );
  if (character.currentOffice) {
    officesHeld.add(officeLabel);
  }
  const electionLosses = careerHistory.filter((entry) => entry.type === "lost_election").length;
  const publicSummary = buildPublicSummary({
    character,
    partyName: publicPartyName,
    stateName,
    officeLabel,
    electionWins,
    electionLosses,
    primaryLosses: 0,
    officesHeldCount: officesHeld.size,
    activeRaceCount: candidateElections.length,
  });
  const publicOverview = (!viewerHasBlocked && character.bio?.trim()) || publicSummary;
  const nationalPartyRole =
    party && character.party !== "independent"
      ? party.chairId?.equals(character._id)
        ? getPartyRoleLabel(party.countryId, "chair")
        : party.viceChairId?.equals(character._id)
          ? getPartyRoleLabel(party.countryId, "viceChair")
          : party.treasurerId?.equals(character._id)
            ? getPartyRoleLabel(party.countryId, "treasurer")
            : null
      : null;
  const statePartyRole =
    statePartyOrg && character.party !== "independent"
      ? statePartyOrg.chairId?.equals(character._id)
        ? `${stateName} Chair`
        : statePartyOrg.viceChairId?.equals(character._id)
          ? `${stateName} Vice Chair`
          : statePartyOrg.treasurerId?.equals(character._id)
            ? `${stateName} Treasurer`
            : null
      : null;
  const currentRaceLabel =
    candidateElections.length === 1
      ? `${formatElectionTypeLabel(candidateElections[0].election.electionType, character.countryId)} in ${candidateElections[0].election.state}`
      : candidateElections.length > 1
        ? `${candidateElections.length} active races`
        : null;
  // One fact list for the public overview: office, current race, roles,
  // affiliation, home state and record.
  const overviewStats: OverviewStatItem[] = [
    {
      label: character.currentOffice ? "Current office" : "Office",
      value: officeLabel,
    },
  ];
  if (currentRaceLabel) {
    overviewStats.push({ label: "Running", value: currentRaceLabel });
  }
  if (nationalPartyRole || statePartyRole) {
    overviewStats.push({ label: "Party role", value: nationalPartyRole ?? statePartyRole! });
  }
  if (chairBankRow) {
    overviewStats.push({ label: "Role", value: "Central Bank Chair" });
  }
  if (ceoCorporation) {
    overviewStats.push({ label: "Leading", value: ceoCorporation.name });
  }
  overviewStats.push(
    { label: "Affiliation", value: publicPartyName },
    { label: "State", value: stateName },
    { label: "Election wins", value: electionWins }
  );
  if (appointments > 0) {
    overviewStats.push({ label: "Appointments", value: appointments });
  }
  if (candidateElections.length > 0) {
    overviewStats.push({ label: "Active races", value: candidateElections.length });
  }
  const relatedLinks = [
    {
      href: politiciansUrl(countryIdResolved),
      label: "All politicians",
      description: "Browse the broader public roster in this country.",
    },
    {
      href: countryUrl(countryIdResolved),
      label: "Country overview",
      description: "See the country’s political and economic front page.",
    },
    {
      href: countryElectionsUrl(countryIdResolved),
      label: "Elections",
      description: "Follow current and upcoming races tied to this country.",
    },
  ];
  if (character.homeState) {
    relatedLinks.unshift({
      href: regionUrl(countryIdResolved, character.homeState),
      label: `${stateName} overview`,
      description: "Explore the local political and economic context.",
    });
  }
  if (party && character.party !== "independent") {
    relatedLinks.splice(1, 0, {
      href: `/wiki/party/${character.party}`,
      label: `${party.name}`,
      description: "Review party background, leadership, and ideology.",
    });
  }
  if (typeof character.sequentialId === "number") {
    relatedLinks.unshift({
      href: `/wiki/${playerWikiSlug(character.sequentialId)}`,
      label: "Wiki article",
      description: "Open the player’s wiki article and curated public record.",
    });
  }

  // Compass markers: party position and home-state lean, matching the own profile.
  const compassMarkers: CompassMarker[] = [];
  if (party?.economicPosition !== undefined && party?.socialPosition !== undefined) {
    compassMarkers.push({
      economic: party.economicPosition,
      social: party.socialPosition,
      label: "Party",
      color: COMPASS_PARTY_MARKER,
    });
  }
  if (homeState?.cachedEconomicLean !== undefined && homeState?.cachedSocialLean !== undefined) {
    compassMarkers.push({
      economic: homeState.cachedEconomicLean,
      social: homeState.cachedSocialLean,
      label: "State",
      color: COMPASS_STATE_MARKER,
    });
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-background pb-16">
      <ProfileTabs
        conflictsEnabled={conflictsEnabled}
        adopted={doctrineAdopted}
        general={general}
        militaryService={militaryService}
        business={businessProfileView(financialData, isOwnProfile)}
        editable={isOwnProfile}
        curEra={generalEra}
        posting={generalPosting}
        isCommandingGeneral={isCommandingGeneral}
        subject={{
          id: character._id.toString(),
          name: character.name,
          countryCode: character.countryId.toLowerCase(),
        }}
        header={
          <>
            <nav className="mb-5 flex items-center gap-2 text-body-sm text-muted">
              <span>Public profile</span>
              <span aria-hidden>/</span>
              <span className="text-foreground">{character.name}</span>
            </nav>
            <ProfileHeader
              character={character}
              party={party}
              user={{ username, isAdmin, isModerator }}
              memberSince={memberSince}
              memberSinceIsApproximate={data.membership.isApproximate}
              officeLabels={profileOfficeLabels}
              stateLabel={stateName}
              campaignSongUrl={viewerHasBlocked ? null : character.campaignSongUrl}
              countrySlug={countrySlug}
              patreonHighlightColor={patreonHighlightColor}
              patreonTier={patreonTier}
              patreonExpiresAt={patreonExpiresAt}
              patreonSince={patreonSince}
              patreonProfileBorder={patreonProfileBorder}
              supporterProvider={supporterProvider}
              wikiProfileHref={
                typeof character.sequentialId === "number"
                  ? `/wiki/${playerWikiSlug(character.sequentialId)}`
                  : undefined
              }
              bioHidden={viewerHasBlocked}
            />
          </>
        }
        notices={
          isBanned ? (
            <div className="rounded-md border border-error/40 px-4 py-3">
              <h2 className="text-body font-semibold text-error">Account banned</h2>
              <p className="mt-1 text-body-sm text-muted">
                This user has been banned for violating the rules.
              </p>
            </div>
          ) : undefined
        }
      >
        <div className={PROFILE_GRID_CLASS}>
          {/* Main: standing, finances, stats, achievements and overview (2/3) */}
          <div className={PROFILE_MAIN_COLUMN_CLASS}>
            <PoliticalStanding
              character={character}
              nationalRank={nationalNpiOrdinalRank}
              homeState={homeState}
              influence={influence}
              nationalInfluence={nationalInfluence}
              influenceDecay={influenceDecay}
              nationalGainPerTurn={nationalGainPerTurn}
              favorability={favorability}
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
              partyInfluenceMaxBonus={partyInfluenceMaxBonus}
              partyInfluenceNetGain={partyInfluenceNetGain}
              bonusActionsFromParty={bonusActionsFromParty}
              partyInfluenceShare={partyInfluenceShare}
              isOwnProfile={isOwnProfile}
            />

            <section>
              <SectionHeader>{t("finances.title")}</SectionHeader>
              <p className="-mt-2 mb-4 text-body-sm text-muted">{t("finances.subtitle")}</p>
              <FinancialStrip
                donorLevel={character.donorBaseLevel}
                maxDonorLevel={maxDonorLevel}
                campaignFunds={character.currencyBalances?.campaign ?? character.funds ?? 0}
                cashOnHand={getTotalPersonalLiquidWealth(character, forexEnabled, fxRatesRecord)}
                currency={getHomeCurrency(character, gamePreset)}
                donorIncome={{
                  passivePerHour: fundDistribution.donorBaseBonus,
                  perLevelRate: DONOR_BASE_BONUS_PER_LEVEL[populationTier],
                  fundraiseYield: fundraiseYieldLocal(
                    character,
                    forexEnabled,
                    campaignRates,
                    campaignPriceLevel,
                    gamePreset
                  ),
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
                  forexBalances: character.currencyBalances
                    ? {
                        personal: character.currencyBalances.personal,
                        savings: character.currencyBalances.savings,
                      }
                    : undefined,
                }}
                portfolioHref={isOwnProfile ? "/portfolio" : undefined}
              />
            </section>

            {rpgStatsEnabled && character.stats && <CharacterStatsPanel stats={character.stats} />}
            {isOwnProfile && forexEnabled ? <LocWalletStrip countryId={countryIdResolved} /> : null}

            <ProfileAchievements
              characterId={character._id.toString()}
              characterHref={buildCharacterHref(character)}
              isOwnProfile={isOwnProfile}
            />

            <section>
              <SectionHeader>Public overview</SectionHeader>
              <p className="max-w-[65ch] text-body-lg leading-relaxed text-foreground/90">
                {publicOverview}
              </p>
              {!viewerHasBlocked &&
                character.bio?.trim() &&
                character.bio.trim() !== publicSummary && (
                  <p className="mt-3 max-w-[65ch] text-body leading-relaxed text-muted">
                    {publicSummary}
                  </p>
                )}
              <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-3">
                {overviewStats.map((stat) => (
                  <div key={stat.label}>
                    <dt className="text-body-sm text-muted">{stat.label}</dt>
                    <dd className="text-body font-medium tabular-nums text-foreground">
                      {stat.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>

          {/* Aside: positions, roles, history and interactions (1/3) */}
          <div className={PROFILE_ASIDE_COLUMN_CLASS}>
            <PolicyDemographicsCard
              economic={character.policies.economic}
              social={character.policies.social}
              dotColor={patreonHighlightColor ?? COMPASS_SELF_DOT}
              markers={compassMarkers.length > 0 ? compassMarkers : undefined}
              demographics={character.demographics}
              startingCountryId={resolveStartingCountryId(character)}
              currentCountryId={character.countryId}
            />

            {!isOwnProfile && ceoCorporation && (
              <CeoCorporationCard
                corporationName={ceoCorporation.name}
                corporationRouteId={String(
                  ceoCorporation.sequentialId ?? ceoCorporation._id.toString()
                )}
                logoUrl={ceoCorporation.logoUrl}
                isNationalEnterprise={
                  Boolean(ceoCorporation.countryOwnerId) || Boolean(ceoCorporation.isNationalized)
                }
              />
            )}

            <ProfileSocial
              discordId={discordId}
              discordUsername={discordUsername}
              discordAvatar={discordAvatar}
              lastActivity={lastActivity}
            />

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

            {candidateElections.length > 0 && (
              <section>
                <SectionHeader level="aside">Current elections</SectionHeader>
                <ul className="divide-y divide-card-border/60">
                  {candidateElections.map(({ election, candidacy }) => (
                    <li key={candidacy._id.toString()} className="py-2">
                      <Link
                        href={`/elections/${election._id.toString()}`}
                        className={`text-body-sm ${PROFILE_LINK_CLASS}`}
                      >
                        {formatElectionTypeLabel(election.electionType, character.countryId)}
                        {election.electionType === "senate" && election.senateClass
                          ? ` (Class ${election.senateClass})`
                          : ""}
                      </Link>
                      <p className="mt-0.5 text-body-sm text-muted">
                        {election.state} · {election.cycle} · {election.status}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {!isOwnProfile && !isBanned && userData?.hasCharacter && (
              <InteractCard
                targetId={character._id.toString()}
                targetName={character.name}
                targetInfluence={character.politicalInfluence || 0}
                myFunds={
                  userData?.character
                    ? // LOCAL home-currency balance (canonical source of truth).
                      ((userData.character as Character).currencyBalances?.campaign ??
                      (userData.character as Character).funds ??
                      0)
                    : 0
                }
                myCash={
                  userData?.character
                    ? getTotalPersonalLiquidWealth(userData.character as Character, forexEnabled)
                    : 0
                }
                canInfluence={!!canInfluence}
              />
            )}

            {userData && !isOwnProfile && (
              <div>
                {viewerHasBlocked && (
                  <p className="mb-3 text-body-sm text-muted">
                    You blocked this player. Their bio, campaign song and mail are hidden from you.
                  </p>
                )}
                <PlayerSafetyActions
                  characterId={character._id.toString()}
                  characterName={character.name}
                  initiallyBlocked={viewerHasBlocked}
                />
              </div>
            )}

            <section>
              <SectionHeader level="aside">Related pages</SectionHeader>
              <ul className="divide-y divide-card-border/60">
                {relatedLinks.map((link) => (
                  <li key={link.href} className="py-2">
                    <Link href={link.href} className={`text-body-sm ${PROFILE_LINK_CLASS}`}>
                      {link.label}
                    </Link>
                    <p className="mt-0.5 text-body-sm leading-relaxed text-muted">
                      {link.description}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      </ProfileTabs>

      <div className={`${PROFILE_CONTAINER_CLASS} pt-12`}>
        <Link
          href="/map"
          className="text-body-sm text-muted transition-colors hover:text-foreground"
        >
          ← Back to map
        </Link>
      </div>
    </div>
  );
}
