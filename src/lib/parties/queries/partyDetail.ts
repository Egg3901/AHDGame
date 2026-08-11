import { ObjectId, type Db } from "mongodb";
import { getPartyBudgetCollection } from "@/lib/db/collections";
import type { Character, GameConfig, NPP, PoliticalParty, State, User } from "@/lib/db/types";
import type { PartyData, PartyLeader, PartyMember } from "@/lib/parties/dto/partyView";
import { resolvePartyPsCap, resolvePartyTier } from "@/lib/parties/partyTier";
import { nppActionPointCap, nppActionPointRegen } from "@/lib/npp/actionPoints";
import { findPartyBudgetForScope, getEffectivePartyBudgetSpending } from "@/lib/partyBudgetGuards";
import { getTreasuryForecast, getTreasuryReserveSummary } from "@/lib/partyTreasuryPlan";
import {
  computeBonusActions,
  computeClosenessScalar,
  DEFAULT_PARTY_INFLUENCE_MAX_BONUS,
  DEFAULT_PARTY_INFLUENCE_POOL_MULTIPLIER,
} from "@/lib/turn/partyInfluenceTurn";
import {
  psInvestmentRate,
  PS_INVESTMENT_MAX_TIERS,
  NATIONAL_PASSIVE_PS_PER_TURN,
  nationalCapForCountry,
} from "@/lib/turn/politicalStrength/strengthConstants";
import { getPartyHex } from "@/lib/utils/politics";
import {
  calculateTaxAmount,
  projectCharacterGeneration,
  projectNppGeneration,
} from "@/lib/utils/fundGeneration";
import { campaignAnchorToLocal, campaignLocalRate } from "@/lib/campaigns/campaignCurrency";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { isUserActive } from "@/lib/players/playerActivity";

async function resolveLeader(
  db: Db,
  leaderId: ObjectId | null | undefined
): Promise<PartyLeader | null> {
  if (!leaderId) return null;

  const character = await db.collection<Character>("characters").findOne({ _id: leaderId });
  if (!character) return null;

  const user = await db
    .collection<User>("users")
    .findOne({ _id: character.userId }, { projection: { _id: 1, isBanned: 1 } });
  if (user?.isBanned) return null;

  return {
    id: character._id.toString(),
    sequentialId: character.sequentialId,
    name: character.name,
    avatarUrl: character.avatarUrl,
  };
}

export async function getPartyDetail(db: Db, party: PoliticalParty): Promise<PartyData> {
  const [chair, viceChair, treasurer, currentTurn] = await Promise.all([
    resolveLeader(db, party.chairId),
    resolveLeader(db, party.viceChairId),
    resolveLeader(db, party.treasurerId),
    getCurrentTurn(db),
  ]);
  const campaigners = (
    await Promise.all((party.campaignerIds ?? []).map((id) => resolveLeader(db, id)))
  ).filter((c): c is NonNullable<typeof c> => c !== null);

  const partyCountry = party.countryId ?? "US";
  const allMembers = await db
    .collection<Character>("characters")
    .find({ party: String(party.sequentialId), countryId: partyCountry })
    .sort({ name: 1 })
    .toArray();

  const memberUsers =
    allMembers.length > 0
      ? await db
          .collection<User>("users")
          .find({ _id: { $in: allMembers.map((member) => member.userId) } })
          .project<{ _id: ObjectId; isBanned?: boolean; lastActivity?: Date; createdAt?: Date }>({
            _id: 1,
            isBanned: 1,
            lastActivity: 1,
            createdAt: 1,
          })
          .toArray()
      : [];
  const allowedMemberUserIds = new Set(
    memberUsers.filter((user) => user.isBanned !== true).map((user) => user._id.toString())
  );
  // `members` (not-banned) still feeds the party-influence pool math below;
  // only the displayed roster additionally drops players inactive for >96 turns
  // (display-only — inactivity does not change national influence math).
  const members = allMembers.filter((member) => allowedMemberUserIds.has(member.userId.toString()));

  const now = new Date();
  const activeMemberUserIds = new Set(
    memberUsers
      .filter(
        (user) => user.isBanned !== true && isUserActive(user.lastActivity, user.createdAt, now)
      )
      .map((user) => user._id.toString())
  );
  const displayMembers = members.filter((member) =>
    activeMemberUserIds.has(member.userId.toString())
  );

  const characterMembers: PartyMember[] = displayMembers.map((member) => ({
    id: member._id.toString(),
    sequentialId: member.sequentialId,
    name: member.name,
    homeState: member.homeState,
    currentOffice: member.currentOffice,
    partyInfluence: member.partyInfluence ?? 0,
  }));

  const npps = await db
    .collection<NPP>("npps")
    .find({ party: String(party.sequentialId), retiredAt: null, countryId: partyCountry })
    .sort({ name: 1 })
    .toArray();
  const nppMembers: PartyMember[] = npps.map((npp) => ({
    id: npp._id.toString(),
    sequentialId: npp.sequentialId,
    name: npp.name,
    homeState: npp.homeState,
    currentOffice: npp.currentOffice,
    isNPP: true,
  }));

  const memberList: PartyMember[] = [...characterMembers, ...nppMembers];

  const uniqueStates = [
    ...new Set([...members.map((member) => member.homeState), ...npps.map((npp) => npp.homeState)]),
  ];
  const states =
    uniqueStates.length > 0
      ? await db
          .collection<State>("states")
          .find({ _id: { $in: uniqueStates } })
          .toArray()
      : [];
  const statePopMap = new Map(states.map((state) => [state._id, state.population]));
  // Pass raw state.gdp (undefined when absent → country-average scalar 1.0,
  // matching the turn processor; do NOT coalesce to 0, which clamps to 0.9).
  const stateGdpMap = new Map(states.map((state) => [state._id, state.gdp]));

  const gameConfig = await db.collection<GameConfig>("gameConfig").findOne({ _id: "default" });
  // NPPs only generate/are taxed when the economy is enabled (mirrors
  // processNppFundGeneration); otherwise they contribute $0 to revenue.
  const nppEconomyEnabled = gameConfig?.nppEconomyEnabled !== false;

  // Campaign-fund estimate is LOCAL at the frozen base INITIAL_RATES scale
  // (mirrors the turn processors) — never live forex. A party is country-scoped,
  // so one rate applies to every member/NPP.
  const campaignRate = campaignLocalRate(partyCountry);
  const toLocal = (anchor: number) => campaignAnchorToLocal(anchor, partyCountry);

  const nationalTaxRate = party.nationalTaxRate ?? 0;
  let expectedHourlyIncome = 0;
  for (const member of members) {
    const statePop = statePopMap.get(member.homeState) ?? 0;
    const totalFundRate = projectCharacterGeneration({
      population: statePop,
      donorBaseLevel: member.donorBaseLevel,
      currentOffice: member.currentOffice,
      stateGdpMillions: stateGdpMap.get(member.homeState),
      countryId: member.countryId,
      politicalInfluence: member.politicalInfluence ?? 0,
    });
    expectedHourlyIncome += calculateTaxAmount(toLocal(totalFundRate), nationalTaxRate);
  }
  for (const npp of npps) {
    const statePop = statePopMap.get(npp.homeState) ?? 0;
    // Feed the diminishing curve the anchor-equivalent balance (npp.funds is
    // local), matching processNppFundGeneration, then denominate to local.
    const grossAnchor = projectNppGeneration({
      population: statePop,
      donorBaseLevel: npp.donorBaseLevel ?? 0,
      currentFundsLocal: campaignRate > 0 ? (npp.funds ?? 0) / campaignRate : (npp.funds ?? 0),
      nppEconomyEnabled,
    });
    expectedHourlyIncome += calculateTaxAmount(toLocal(grossAnchor), nationalTaxRate);
  }

  const poolMultiplier = Math.max(
    gameConfig?.partyInfluencePoolMultiplier ?? 0,
    DEFAULT_PARTY_INFLUENCE_POOL_MULTIPLIER
  );
  const maxBonus = Math.max(
    gameConfig?.partyInfluenceMaxBonus ?? 0,
    DEFAULT_PARTY_INFLUENCE_MAX_BONUS
  );
  const totalInfluence = members.reduce((sum, member) => sum + (member.partyInfluence ?? 0), 0);
  const totalPool = poolMultiplier * members.length;
  let totalBonusActions = 0;
  if (totalInfluence > 0) {
    for (const member of members) {
      const closeness = computeClosenessScalar(
        member.policies.economic,
        member.policies.social,
        party.economicPosition,
        party.socialPosition
      );
      totalBonusActions += computeBonusActions(
        member.partyInfluence ?? 0,
        totalInfluence,
        totalPool,
        closeness,
        maxBonus
      );
    }
  }

  const budgetCollection = await getPartyBudgetCollection();
  const nationalBudget = await findPartyBudgetForScope(budgetCollection, {
    countryId: party.countryId,
    partyId: String(party.sequentialId),
    scope: "national",
  });
  const effectiveBudget = getEffectivePartyBudgetSpending(nationalBudget, party.treasury);
  const gotvBudgetPercent = effectiveBudget.gotvBudgetPercent;
  const gotvEstimatedSpend =
    gotvBudgetPercent > 0
      ? Math.floor(expectedHourlyIncome * (gotvBudgetPercent / 100))
      : effectiveBudget.gotvBudgetPerTurn;
  const gotvTargetCategory = effectiveBudget.gotvTargetCategory;
  const gotvTargetGroup = effectiveBudget.gotvTargetGroup;
  const suppressionBudgetPercent = effectiveBudget.suppressionBudgetPercent;
  const suppressionEstimatedSpend = Math.floor(
    expectedHourlyIncome * (suppressionBudgetPercent / 100)
  );
  const suppressionTargetCategory = effectiveBudget.suppressionTargetCategory;
  const suppressionTargetGroup = effectiveBudget.suppressionTargetGroup;
  // Voter-registration drive (player suggestion #81) — same percent-of-revenue
  // estimate shape as GOTV; a real per-turn treasury debit, so it nets out below.
  const registrationBudgetPercent = effectiveBudget.registrationBudgetPercent;
  const registrationEstimatedSpend = Math.floor(
    expectedHourlyIncome * (registrationBudgetPercent / 100)
  );
  // psInvestmentBudget is debited from treasury each turn in partyActionGeneration
  // but was previously excluded from the net income estimate shown in the UI.
  const psInvestmentBudgetNational = party.psInvestmentBudget ?? 0;
  // Tier-resolved effective PS cap — Major → full national cap; Minor →
  // 100 + 10×earned-regions (clamped). An explicit `politicalStrengthCap`
  // override wins. Mirrors the cap the turn engine actually enforces, so the
  // header denominator matches a Minor party's real ceiling (not the Major cap).
  const tier = resolvePartyTier(party);
  const effectivePsCap =
    party.politicalStrengthCap ??
    resolvePartyPsCap(
      tier,
      party.psCapEarnedRegions?.length ?? 0,
      nationalCapForCountry(party.countryId)
    );
  // Mirror of computePartyPsGain's spend stream: full-rate conversion bounded by
  // PS_INVESTMENT_MAX_TIERS and by the headroom below the hard cap after passive
  // (soft-cap bands removed 2026-06-28), so the previewed debit matches what the
  // turn engine will actually charge.
  let estimatedPsInvestmentDebit = 0;
  const headroomAfterPassive = Math.max(
    0,
    effectivePsCap - (party.politicalStrength ?? 0) - NATIONAL_PASSIVE_PS_PER_TURN
  );
  if (psInvestmentBudgetNational > 0 && (party.treasury ?? 0) > 0 && headroomAfterPassive > 0) {
    const ratePerPs = psInvestmentRate(partyCountry, "national");
    const availableBudget = Math.min(psInvestmentBudgetNational, party.treasury ?? 0);
    const requestedPS = availableBudget / Math.max(1, ratePerPs);
    const investment = Math.min(requestedPS, PS_INVESTMENT_MAX_TIERS, headroomAfterPassive);
    estimatedPsInvestmentDebit = investment * ratePerPs;
  }
  const netHourlyTreasuryChange =
    expectedHourlyIncome -
    gotvEstimatedSpend -
    suppressionEstimatedSpend -
    registrationEstimatedSpend -
    estimatedPsInvestmentDebit;
  const reserveSummary = getTreasuryReserveSummary(party.treasury, effectiveBudget);
  const treasuryForecast = getTreasuryForecast(
    party.treasury,
    netHourlyTreasuryChange,
    effectiveBudget
  );

  return {
    id: String(party.sequentialId),
    name: party.name,
    abbreviation: party.abbreviation,
    color: getPartyHex(String(party.sequentialId), party.color),
    discordInviteUrl: party.discordInviteUrl ?? null,
    economicPosition: party.economicPosition,
    socialPosition: party.socialPosition,
    chair,
    viceChair,
    treasurer,
    campaigners,
    committeeIds: (party.committeeIds || []).map((id) => id.toString()),
    treasury: party.treasury ?? 0,
    nationalTaxRate,
    expectedHourlyIncome,
    gotvBudgetPercent,
    gotvEstimatedSpend,
    gotvTargetCategory,
    gotvTargetGroup,
    suppressionBudgetPercent,
    suppressionEstimatedSpend,
    suppressionTargetCategory,
    suppressionTargetGroup,
    registrationBudgetPercent,
    registrationEstimatedSpend,
    transferReserveAmount: reserveSummary.transferReserveAmount,
    memberSupportReserveAmount: reserveSummary.memberSupportReserveAmount,
    nppRecruitmentReserveAmount: reserveSummary.nppRecruitmentReserveAmount,
    treasuryPreset: effectiveBudget.treasuryPreset,
    totalReserveTarget: reserveSummary.totalReserveTarget,
    discretionaryTreasury: reserveSummary.discretionaryTreasury,
    netHourlyTreasuryChange: treasuryForecast.netHourlyTreasuryChange,
    turnsUntilZero: treasuryForecast.turnsUntilZero,
    turnsUntilReserveFloor: treasuryForecast.turnsUntilReserveFloor,
    turnsToReachReserveFloor: treasuryForecast.turnsToReachReserveFloor,
    politicalStrength: party.politicalStrength ?? 0,
    politicalStrengthCap: party.politicalStrengthCap ?? null,
    effectivePsCap,
    nppActionPoints: party.nppActionPoints ?? nppActionPointCap("national", tier),
    nppActionPointCap: nppActionPointCap("national", tier),
    nppActionPointRegen: nppActionPointRegen("national", tier),
    psInvestmentBudget: party.psInvestmentBudget ?? 0,
    totalBonusActions,
    memberCount: memberList.length,
    isDefault: party.isDefault,
    tier,
    majorDemotionWarning: party.majorDemotionWarning ?? null,
    regimeStatus: party.regimeStatus ?? null,
    countryId: party.countryId ?? "US",
    createdAt: party.createdAt.toISOString(),
    members: memberList,
    logoUrl: party.logoUrl,
    lastPurgeAtTurn: party.lastPurgeAtTurn,
    currentTurn,
    membershipMode: party.membershipMode ?? "open",
    pendingJoinRequests: (party.pendingJoinRequests ?? []).map((r) => ({
      characterId: r.characterId.toString(),
      characterName: r.characterName,
      requestedAt: r.requestedAt.toISOString(),
    })),
  };
}
