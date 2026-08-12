import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type {
  StatePartyOrg,
  State,
  Character,
  User,
  NPP,
  Election,
  GameConfig,
  PoliticalParty,
} from "@/lib/db/types";
import { buildStateRivals } from "@/lib/states/buildStateRivals";
import { resolvePartyFamily, getDefaultPrimaryAllocation } from "@/lib/constants/primaryCalendar";
import {
  projectCharacterGeneration,
  projectNppGeneration,
  calculateTaxAmount,
} from "@/lib/utils/fundGeneration";
import { campaignAnchorToLocal, campaignLocalRate } from "@/lib/campaigns/campaignCurrency";
import { getPartyHex } from "@/lib/utils/politics";
import { getPartyBudgetCollection } from "@/lib/db/collections";
import {
  findPartyBySequentialId,
  getPartyIdString,
  getStatePartyOrgDocumentId,
} from "@/lib/db/partyLookup";
import { checkPartyPresence } from "@/lib/turn/partyOrg/presence";
import {
  effectiveStatePsCap,
  psInvestmentRate,
  PS_INVESTMENT_MAX_TIERS,
  STATE_PASSIVE_PS_PER_TURN,
} from "@/lib/turn/politicalStrength/strengthConstants";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { coerceStoredNumber } from "@/lib/utils/coerceStoredNumber";
import { getGameTime } from "@/lib/time/gameTime";
import { isUserActive } from "@/lib/players/playerActivity";
import { primaryOpenFilter } from "@/lib/elections/electionDeadlineFilters";
import { findPartyBudgetForScope, getEffectivePartyBudgetSpending } from "@/lib/partyBudgetGuards";
import { getTreasuryForecast, getTreasuryReserveSummary } from "@/lib/partyTreasuryPlan";

interface RouteParams {
  params: Promise<{ code: string; id: string; partyId: string }>;
}

interface LeaderInfo {
  id: string;
  name: string;
  sequentialId?: number;
  avatarUrl?: string;
}

interface MemberInfo {
  id: string;
  name: string;
  homeState: string;
  currentOffice: Character["currentOffice"];
  avatarUrl?: string;
  isNPP: boolean;
  sequentialId?: number;
}

// GET /api/country/[code]/region/[id]/party/[partyId] — Return state party detail data including members, leadership, and budget
// Auth: public
// Errors: 400, 404
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { code, id, partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const stateId = id;

    const db = await getDb();

    // NPPs only generate/are taxed when the economy is enabled (mirrors
    // processNppFundGeneration); otherwise they contribute $0 to revenue.
    const gameConfig = await db.collection<GameConfig>("gameConfig").findOne({ _id: "default" });
    const nppEconomyEnabled = gameConfig?.nppEconomyEnabled ?? false;

    // Verify state exists
    const state = await db.collection<State>("states").findOne({ _id: stateId, countryId });
    if (!state) {
      return NextResponse.json({ error: "State not found" }, { status: 404 });
    }

    const statePopulation = coerceStoredNumber(state.population, 0);

    // Verify party exists
    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }

    const partyKey = getPartyIdString(party);

    // Fetch state party org record (may not exist)
    const statePartyOrg = await db.collection<StatePartyOrg>("statePartyOrg").findOne({
      _id: getStatePartyOrgDocumentId(stateId, party),
    });

    // Get state lean for display
    const { getStateLean } = await import("@/lib/utils/demographics");
    const stateLean = getStateLean(state, stateId);

    // Resolve leadership characters
    const resolveLeader = async (
      leaderId: ObjectId | null | undefined
    ): Promise<LeaderInfo | null> => {
      if (!leaderId) return null;
      const character = await db.collection<Character>("characters").findOne({ _id: leaderId });
      if (!character) return null;

      // Check if user is banned
      const user = await db.collection<User>("users").findOne({ _id: character.userId });
      if (user?.isBanned) return null;

      return {
        id: character._id.toString(),
        name: character.name,
        sequentialId: character.sequentialId,
        avatarUrl: character.avatarUrl,
      };
    };

    const [chair, viceChair, treasurer, campaigner] = await Promise.all([
      resolveLeader(statePartyOrg?.chairId),
      resolveLeader(statePartyOrg?.viceChairId),
      resolveLeader(statePartyOrg?.treasurerId),
      resolveLeader(statePartyOrg?.campaignerId ?? null),
    ]);

    // Game clock — also drives the inactivity cutoff below so the displayed
    // roster + PS cap match what the turn engine enforces with the same `now`.
    const { currentTurn, effectiveNow } = await getGameTime();

    // Fetch members (characters in this state who belong to this party).
    // Filter out banned users AND players inactive for >96 turns — both the
    // roster display and the effective PS cap exclude inactive players, matching
    // partyActionGeneration's player-member check.
    const characters = await db
      .collection<Character>("characters")
      .find({ homeState: stateId, party: partyKey })
      .toArray();

    // Get user IDs and fetch ban + activity status
    const userIds = characters.map((c) => c.userId);
    const users = await db
      .collection<User>("users")
      .find({ _id: { $in: userIds } })
      .toArray();

    // Ban-only set — drives income projection below (unchanged behavior).
    const allowedUserIds = new Set(
      users.filter((u) => u.isBanned !== true).map((u) => u._id.toString())
    );
    // Active + not-banned set — drives the displayed roster and the effective
    // PS cap, so an all-inactive party reads as NPP-only and inactive players
    // drop off the membership list. Matches partyActionGeneration's rule.
    const activeMemberUserIds = new Set(
      users
        .filter(
          (u) => u.isBanned !== true && isUserActive(u.lastActivity, u.createdAt, effectiveNow)
        )
        .map((u) => u._id.toString())
    );

    // Fetch NPPs in this state party (for tax calculation and members list)
    const npps = await db
      .collection<NPP>("npps")
      .find({ homeState: stateId, party: partyKey, retiredAt: null })
      .toArray();

    const characterMembers: MemberInfo[] = characters
      .filter((c) => activeMemberUserIds.has(c.userId.toString()))
      .map((c) => ({
        id: c._id.toString(),
        name: c.name,
        homeState: c.homeState,
        currentOffice: c.currentOffice,
        avatarUrl: c.avatarUrl,
        isNPP: false,
        sequentialId: c.sequentialId,
      }));

    const nppMembers: MemberInfo[] = npps.map((n) => ({
      id: n._id.toString(),
      name: n.name,
      homeState: n.homeState,
      currentOffice: n.currentOffice,
      avatarUrl: n.avatarUrl,
      isNPP: true,
      sequentialId: n.sequentialId,
    }));

    const members: MemberInfo[] = [...characterMembers, ...nppMembers];

    // Get national party chair ID for authorization checks on frontend
    const nationalChairId = party.chairId?.toString() || null;
    const nationalViceChairId = party.viceChairId?.toString() || null;
    const nationalCampaignerIds = (party.campaignerIds ?? []).map((id) => id.toString());

    // Calculate expected hourly income from state taxes
    // Need to calculate individually since each member may have different donor base/office
    const stateTaxRate = coerceStoredNumber(statePartyOrg?.stateTaxRate, 0);
    let expectedHourlyIncome = 0;

    const stateGdp = state.gdp;

    // Campaign-fund estimate is LOCAL at the frozen base INITIAL_RATES scale
    // (mirrors the turn processors) — never live forex. This region is single-country.
    const campaignRate = campaignLocalRate(countryId);
    const toLocal = (anchor: number) => campaignAnchorToLocal(anchor, countryId);

    // 1. Calculate for players
    for (const character of characters) {
      // Skip banned users (already filtered from members)
      if (!allowedUserIds.has(character.userId.toString())) continue;

      // Calculate total fund generation (base + donor base + office bonus)
      const totalFundRate = projectCharacterGeneration({
        population: statePopulation,
        donorBaseLevel: character.donorBaseLevel,
        currentOffice: character.currentOffice,
        stateGdpMillions: stateGdp,
        countryId,
        politicalInfluence: character.politicalInfluence ?? 0,
      });
      expectedHourlyIncome += calculateTaxAmount(toLocal(totalFundRate), stateTaxRate);
    }

    // 2. Calculate for NPPs — feed the diminishing curve the anchor-equivalent
    //    balance (npp.funds is local), matching processNppFundGeneration, then
    //    denominate to local. No live forex.
    for (const npp of npps) {
      const grossAnchor = projectNppGeneration({
        population: statePopulation,
        donorBaseLevel: npp.donorBaseLevel ?? 0,
        currentFundsLocal: campaignRate > 0 ? (npp.funds ?? 0) / campaignRate : (npp.funds ?? 0),
        nppEconomyEnabled,
      });
      expectedHourlyIncome += calculateTaxAmount(toLocal(grossAnchor), stateTaxRate);
    }

    // Fetch GOTV budget data
    const budgetCollection = await getPartyBudgetCollection();
    const stateBudget = await findPartyBudgetForScope(budgetCollection, {
      countryId,
      partyId: partyKey,
      scope: "state",
      stateId,
    });
    const effectiveBudget = getEffectivePartyBudgetSpending(stateBudget, statePartyOrg?.treasury);
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
    // Legacy `orgBuildingPercent` field is inert under the PS-driven Build
    // Org system — surface as 0 so analytics / panels don't display a
    // phantom spend. Field stays in DB for backward-compat until cleanup.
    const orgBuildingPercent = 0;
    const orgBuildingEstimatedSpend = 0;
    const statePsInvestmentBudget = statePartyOrg?.psInvestmentBudget ?? 0;
    // Mirror of computePartyPsGain's spend stream: full-rate conversion bounded
    // by PS_INVESTMENT_MAX_TIERS and the headroom below the hard cap after passive
    // (soft-cap bands removed 2026-06-28), so the previewed debit matches what the
    // turn engine will actually charge.
    let estimatedStatePsInvestmentDebit = 0;
    const stateCap = effectiveStatePsCap(characterMembers.length > 0);
    const stateHeadroomAfterPassive = Math.max(
      0,
      stateCap - (statePartyOrg?.politicalStrength ?? 0) - STATE_PASSIVE_PS_PER_TURN
    );
    if (
      statePsInvestmentBudget > 0 &&
      (statePartyOrg?.treasury ?? 0) > 0 &&
      stateHeadroomAfterPassive > 0
    ) {
      const ratePerPs = psInvestmentRate(countryId, "state");
      const availableBudget = Math.min(statePsInvestmentBudget, statePartyOrg?.treasury ?? 0);
      const requestedPS = availableBudget / Math.max(1, ratePerPs);
      const investment = Math.min(requestedPS, PS_INVESTMENT_MAX_TIERS, stateHeadroomAfterPassive);
      estimatedStatePsInvestmentDebit = investment * ratePerPs;
    }
    const netHourlyTreasuryChange =
      expectedHourlyIncome -
      gotvEstimatedSpend -
      suppressionEstimatedSpend -
      estimatedStatePsInvestmentDebit;
    const reserveSummary = getTreasuryReserveSummary(statePartyOrg?.treasury, effectiveBudget);
    const treasuryForecast = getTreasuryForecast(
      statePartyOrg?.treasury,
      netHourlyTreasuryChange,
      effectiveBudget
    );

    // Primary allocation resolution — chair override, family default, lock state.
    const primaryAllocation = statePartyOrg?.primaryAllocation ?? null;
    const family = resolvePartyFamily(partyKey, {
      primaryCalendar: party.primaryCalendar ?? null,
      economicPosition: party.economicPosition,
    });
    const primaryAllocationEffective: "PR" | "WTA" =
      primaryAllocation ?? getDefaultPrimaryAllocation(stateId, family);
    const primaryAllocationIsExplicit = primaryAllocation !== null;
    const activePresPrimary = await db.collection<Election>("elections").findOne({
      countryId,
      electionType: "president",
      status: "active",
      ...primaryOpenFilter(currentTurn, effectiveNow),
    });
    const primaryAllocationLocked = activePresPrimary !== null;

    // Rival parties present in this state — read-only, powers the Contest panel
    // on the party sub-page. Sorted by Org desc (strongest first) via the shared
    // buildStateRivals mapper.
    const rivalRows = await db
      .collection<StatePartyOrg>("statePartyOrg")
      .find({ stateId })
      .toArray();
    const rivalSeqIds = rivalRows.map((r) => Number(r.partyId)).filter(Boolean);
    const rivalParties = rivalSeqIds.length
      ? await db
          .collection<PoliticalParty>("politicalParties")
          .find({ sequentialId: { $in: rivalSeqIds }, countryId })
          .toArray()
      : [];
    const rivals = buildStateRivals({
      rows: rivalRows.map((r) => ({
        partyId: r.partyId,
        organization: coerceStoredNumber(r.organization, 0),
      })),
      parties: rivalParties.map((p) => ({
        sequentialId: p.sequentialId,
        abbreviation: p.abbreviation,
        color: p.color,
      })),
      excludePartyKey: partyKey,
    });

    return NextResponse.json({
      stateParty: {
        _id: statePartyOrg?._id || getStatePartyOrgDocumentId(stateId, party),
        stateId,
        stateName: state.name,
        countryId,
        politicalLean: stateLean,
        statePopulation,
        partyId: partyKey,
        partyName: party.name,
        partyColor: getPartyHex(String(party.sequentialId), party.color),
        partyAbbreviation: party.abbreviation,
        partyLogoUrl: party.logoUrl ?? null,
        isDefault: party.isDefault,
        regimeStatus: party.regimeStatus ?? null,
        economicPosition: coerceStoredNumber(party.economicPosition, 0),
        socialPosition: coerceStoredNumber(party.socialPosition, 0),
        organization: coerceStoredNumber(statePartyOrg?.organization, 0),
        treasury: coerceStoredNumber(statePartyOrg?.treasury, 0),
        politicalStrength: coerceStoredNumber(statePartyOrg?.politicalStrength, 0),
        // Full state cap (30) only when an active, non-banned homed Player
        // Character member exists; NPP-only / empty / all-inactive rows cap at
        // 25% (7.5). Uses `characterMembers` (ban + inactivity filtered), matching
        // the turn engine's player-member rule.
        effectivePsCap: effectiveStatePsCap(characterMembers.length > 0),
        stateTaxRate,
        nationalTaxRate: coerceStoredNumber(party.nationalTaxRate, 0),
        expectedHourlyIncome: coerceStoredNumber(expectedHourlyIncome, 0),
        gotvBudgetPercent: coerceStoredNumber(gotvBudgetPercent, 0),
        gotvEstimatedSpend: coerceStoredNumber(gotvEstimatedSpend, 0),
        gotvTargetCategory,
        gotvTargetGroup,
        suppressionBudgetPercent: coerceStoredNumber(suppressionBudgetPercent, 0),
        suppressionEstimatedSpend: coerceStoredNumber(suppressionEstimatedSpend, 0),
        suppressionTargetCategory,
        suppressionTargetGroup,
        orgBuildingPercent: coerceStoredNumber(orgBuildingPercent, 0),
        orgBuildingEstimatedSpend: coerceStoredNumber(orgBuildingEstimatedSpend, 0),
        psInvestmentBudget: coerceStoredNumber(statePartyOrg?.psInvestmentBudget, 0),
        hasPresence: await checkPartyPresence(db, stateId, String(party.sequentialId)),
        campaigner,
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
        chair,
        viceChair,
        treasurer,
        memberCount: members.length, // players + NPPs
        members,
        rivals,
        nationalChairId,
        nationalViceChairId,
        nationalCampaignerIds,
        primaryAllocation,
        primaryAllocationEffective,
        primaryAllocationIsExplicit,
        primaryAllocationLocked,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
