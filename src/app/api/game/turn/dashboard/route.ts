import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { getGameState } from "@/lib/gameState";
import { getGameTime, type GameTimeContext } from "@/lib/time/gameTime";
import { isPrimaryEnded } from "@/lib/elections/phases";
import { calculateFullFundDistribution, type FundDistribution } from "@/lib/utils/fundGeneration";
import { getCampaignActionCost, getAdvertiseActionCost, getDonorActionCost } from "@/lib/actions";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { getTotalPersonalLiquidWealth } from "@/lib/currency/characterFunds";
import { FAVORABILITY_NATURAL_DECAY_THRESHOLD } from "@shared/constants/formulas";
import {
  projectFavorabilityDecay,
  projectInfamyDecay,
  projectInfluenceDecay,
} from "@/lib/utils/decayProjections";
import type {
  Character,
  Corporation,
  Election,
  ExchangeRate,
  GameConfig,
  PortfolioHistory,
  State,
  PoliticalParty,
  StatePartyOrg,
} from "@/lib/db/types";

const MIN_BASE_ACTIONS_PER_TURN = 4;

// GET /api/game/turn/dashboard — Returns aggregated character stats, action costs, fund projections, and nearest election for the status bar.
// Auth: requireBasicAuth
// Errors: 401, 404
/**
 * GET /api/game/turn/dashboard
 *
 * Returns all data the StatusBar / Turn Dashboard widget needs in a single call:
 * - Character stats (actions, funds, politicalInfluence, favorability, infamy)
 * - Action cost tiers for each action type at current stat levels
 * - Projected fund income per turn (base + donor + office - taxes)
 * - Decay projections for next turn
 * - Nearest upcoming/active election with countdown info
 * - Game state (turn, date, next turn timer)
 */
export async function GET() {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const authUser = auth.user;

    const db = await getDb();

    const [gameState, character, forexEnabled] = await Promise.all([
      getGameState(),
      db.collection<Character>("characters").findOne({ userId: new ObjectId(authUser.userId) }),
      isForexEnabled(),
    ]);
    const forexRates: Record<string, number> | undefined = forexEnabled
      ? Object.fromEntries(
          (await db.collection<ExchangeRate>("exchangeRates").find({}).toArray()).map((r) => [
            r.currencyCode,
            r.rate,
          ])
        )
      : undefined;

    if (!gameState) {
      return NextResponse.json({ error: "Game state not initialized" }, { status: 404 });
    }

    // Compute next cron fire (top of the next hour, UTC)
    const now = new Date();
    const nextCron = new Date(now);
    nextCron.setUTCMinutes(0, 0, 0);
    nextCron.setUTCHours(nextCron.getUTCHours() + 1);

    // If no character, return minimal game state
    if (!character) {
      return NextResponse.json({
        forexEnabled,
        gameState: {
          currentTurn: gameState.currentTurn,
          currentYear: gameState.currentYear,
          isActive: gameState.isActive,
          nextScheduledTurn: gameState.isActive ? nextCron.toISOString() : null,
          pausedAt: gameState.pausedAt ?? null,
        },
        character: null,
      });
    }

    // Fetch config, home state, party data, nearest election, corp, and portfolio in parallel
    const [config, homeState, party, statePartyOrg, nearestElection, corpDoc, portfolioSnapshots] =
      await Promise.all([
        db.collection<GameConfig>("gameConfig").findOne({ _id: "default" }),
        db
          .collection<State>("states")
          .findOne({ _id: character.homeState, countryId: character.countryId }),
        character.party && Number.isFinite(Number(character.party))
          ? db.collection<PoliticalParty>("politicalParties").findOne({
              sequentialId: Number(character.party),
              countryId: character.countryId,
            })
          : null,
        character.party
          ? db.collection<StatePartyOrg>("statePartyOrg").findOne({
              stateId: character.homeState,
              partyId: character.party,
            })
          : null,
        // Find the nearest election the player is a candidate in, or the nearest active election
        findNearestElection(db, character, await getGameTime()),
        // hasCorp: is this character the CEO of an active corporation?
        db
          .collection<Corporation>("corporations")
          .findOne({ ceoId: character._id, ceoVacant: { $ne: true } }, { projection: { _id: 1 } }),
        // Two most recent snapshots — used to compute portfolioChangePercent
        db
          .collection<PortfolioHistory>("portfolioHistory")
          .find({ characterId: character._id })
          .sort({ turn: -1 })
          .limit(2)
          .project({ totalValue: 1 })
          .toArray() as Promise<Pick<PortfolioHistory, "_id" | "totalValue">[]>,
      ]);

    // --- Action cost tiers ---
    const pi = character.politicalInfluence ?? 0;
    const fav = character.favorability ?? 50;
    const donor = character.donorBaseLevel ?? 0;
    const actionCosts = {
      campaign: getCampaignActionCost(pi),
      advertise: getAdvertiseActionCost(fav),
      fundraise: getDonorActionCost(donor, "fundraise"),
      buildDonorBase: getDonorActionCost(donor, "buildDonorBase"),
      poll: 2,
      pollLarge: 6,
      rest: 0,
    };

    // --- Fund income projection ---
    const statePopulation = homeState?.population ?? 1_000_000;
    const stateTaxRate = statePartyOrg?.stateTaxRate ?? 0;
    const nationalTaxRate = party?.nationalTaxRate ?? 0;

    const fundDistribution: FundDistribution = calculateFullFundDistribution(
      statePopulation,
      donor,
      character.currentOffice,
      stateTaxRate,
      nationalTaxRate,
      homeState?.gdp,
      character.countryId
    );

    // --- Decay projections (what happens next turn) ---
    const influenceProjection = projectInfluenceDecay(pi);
    const favorabilityProjection = projectFavorabilityDecay(fav);
    const infamy = character.infamy ?? 0;
    const infamyProjection = projectInfamyDecay(infamy);

    // --- Office action bonus ---
    const officeActionBonus =
      character.currentOffice && config?.officeActionBonus
        ? (config.officeActionBonus[character.currentOffice.type] ?? 0)
        : 0;
    /*
     * Chair bonus is independent of currentOffice: the role lives on
     * centralBanks.chairCharacterId and stacks with any elected seat.
     */
    const chairBankRow = await db
      .collection("centralBanks")
      .findOne({ chairCharacterId: character._id }, { projection: { _id: 1 } });
    const chairActionBonus = chairBankRow ? (config?.chairActionBonus ?? 3) : 0;
    const baseActionsPerTurn = Math.max(config?.baseActionsPerTurn ?? 0, MIN_BASE_ACTIONS_PER_TURN);

    return NextResponse.json({
      forexEnabled,
      gameState: {
        currentTurn: gameState.currentTurn,
        currentYear: gameState.currentYear,
        isActive: gameState.isActive,
        nextScheduledTurn: gameState.isActive ? nextCron.toISOString() : null,
        pausedAt: gameState.pausedAt ?? null,
      },
      character: {
        name: character.name,
        actions: character.actions,
        // LOCAL home-currency balance (canonical source of truth).
        funds: character.currencyBalances?.campaign ?? character.funds ?? 0,
        cashOnHand: getTotalPersonalLiquidWealth(character, forexEnabled, forexRates),
        politicalInfluence: pi,
        favorability: fav,
        infamy,
        donorBaseLevel: donor,
        currentOffice: character.currentOffice,
        party: character.party,
        nationalInfluence: character.nationalInfluence ?? 0,
        hasCorp: corpDoc !== null,
        portfolioValue: portfolioSnapshots[0]?.totalValue ?? 0,
        portfolioChangePercent:
          portfolioSnapshots.length >= 2 && (portfolioSnapshots[1].totalValue ?? 0) > 0
            ? Math.round(
                (((portfolioSnapshots[0].totalValue ?? 0) - portfolioSnapshots[1].totalValue) /
                  portfolioSnapshots[1].totalValue) *
                  10000
              ) / 100
            : null,
      },
      actionCosts,
      fundIncome: {
        baseGeneration: fundDistribution.baseGeneration,
        donorBaseBonus: fundDistribution.donorBaseBonus,
        officeBonus: fundDistribution.officeBonus,
        totalGeneration: fundDistribution.totalGeneration,
        stateTax: fundDistribution.stateTaxAmount,
        nationalTax: fundDistribution.nationalTaxAmount,
        netPerTurn: fundDistribution.characterReceives,
      },
      actionsPerTurn: {
        base: baseActionsPerTurn,
        officeBonus: officeActionBonus,
        chairBonus: chairActionBonus,
        total: baseActionsPerTurn + officeActionBonus + chairActionBonus,
      },
      decayProjections: {
        politicalInfluence: {
          ...influenceProjection,
        },
        favorability: {
          ...favorabilityProjection,
          threshold: FAVORABILITY_NATURAL_DECAY_THRESHOLD,
        },
        infamy: {
          ...infamyProjection,
        },
      },
      nearestElection,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * Find the nearest election relevant to this character.
 * Priority: elections the player is a candidate in, then any active/upcoming election.
 */
async function findNearestElection(
  db: Awaited<ReturnType<typeof getDb>>,
  character: Character,
  gameTime: GameTimeContext
): Promise<{
  id: string;
  electionType: string;
  state: string;
  status: string;
  endTime: string | null;
  primaryEndTime: string | null;
  inPrimary: boolean;
  isCandidate: boolean;
} | null> {
  // Check if the player is a candidate in any active election
  const candidacy = await db
    .collection("electionCandidates")
    .findOne({ characterId: character._id, status: "active" });

  if (candidacy) {
    const election = await db.collection<Election>("elections").findOne({
      _id: candidacy.electionId,
      status: { $in: ["upcoming", "active"] },
    });

    if (election) {
      const inPrimary =
        election.status === "active" && !isPrimaryEnded(election, gameTime.currentTurn, gameTime);

      return {
        id: election._id.toString(),
        electionType: election.electionType,
        state: election.state,
        status: election.status,
        endTime: election.endTime ? new Date(election.endTime).toISOString() : null,
        primaryEndTime: election.primaryEndTime
          ? new Date(election.primaryEndTime).toISOString()
          : null,
        inPrimary,
        isCandidate: true,
      };
    }
  }

  // Fallback: nearest active election in the player's home state or nationally
  const election = await db.collection<Election>("elections").findOne(
    {
      status: { $in: ["upcoming", "active"] },
      $or: [{ state: character.homeState }, { state: "National" }],
    },
    { sort: { endTime: 1 } }
  );

  if (!election) return null;

  const inPrimary =
    election.status === "active" && !isPrimaryEnded(election, gameTime.currentTurn, gameTime);

  return {
    id: election._id.toString(),
    electionType: election.electionType,
    state: election.state,
    status: election.status,
    endTime: election.endTime ? new Date(election.endTime).toISOString() : null,
    primaryEndTime: election.primaryEndTime
      ? new Date(election.primaryEndTime).toISOString()
      : null,
    inPrimary,
    isCandidate: false,
  };
}
