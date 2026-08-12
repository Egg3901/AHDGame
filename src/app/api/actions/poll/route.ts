import { NextResponse } from "next/server";
import { loadDemographicCategories } from "@/lib/demographics/categoryCatalog";
import { NextRequest } from "next/server";
import { ObjectId } from "mongodb";
import { eraForPreset } from "@/lib/seeds/presetSelector";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBasicAuth, requireHumanSession } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { pollCommissionSchema } from "@/lib/api/schemas/poll";
import { ACTIONS, canPerformAction } from "@/lib/actions";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { localCampaignBalance } from "@/lib/currency/campaignBalance";
import { campaignLocalRate } from "@/lib/campaigns/campaignCurrency";
import { getGameState } from "@/lib/gameState";
import { isGranularPollEnabled } from "@/lib/demographics/granularPollFlag";
import { buildGranularPollPayloadForState } from "@/lib/actions/granularPollPayload";
import { getCountryLayer1Model } from "@/lib/seeds/international";
import { eraYearContextFromGameState } from "@/lib/era/context";
import type {
  Character,
  State,
  DemographicCategory,
  StateDemographics,
  StatePartyOrg,
  StateDemographicTurnout,
  ActionLog,
  User,
} from "@/lib/db/types";
import { computeStateDemographicTurnout } from "@/lib/seeds/stateDemographics";
import { computePollData, type OpponentForShare } from "@/lib/actions/pollCalculations";
import {
  shiftDemographicsForPrimary,
  applyPrimaryTurnoutRetention,
} from "@/lib/campaigns/shiftPrimaryElectorate";
import type { PoliticalParty } from "@/lib/db/types";
import { getElectionOpponents } from "@/lib/actions/electionOpponents";
import { buildLiveTurnouts } from "@/lib/electionEngine/resolvedTurnout";
import { getAllVoterArchetypeIds } from "@/lib/demographics/countryDemographics";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

const SMALL_POLL_COST = 25000;
const LARGE_POLL_COST = 75000;
const SMALL_POLL_ACTIONS = 2;
const LARGE_POLL_ACTIONS = 6;

// GET /api/actions/poll — Returns poll eligibility, stored poll results, and demographic context for the authenticated character's home state
// Auth: requireBasicAuth
// Errors: 400, 401, 404
export async function GET(request: NextRequest) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const pollType = request.nextUrl.searchParams.get("type") === "large" ? "large" : "small";

    const db = await getDb();

    // Resolve active character (admin accounts may have multiple characters)
    const userDoc = await db.collection<User>("users").findOne({ _id: new ObjectId(user.userId) });
    const characterQuery = userDoc?.activeCharacterId
      ? { _id: userDoc.activeCharacterId, userId: new ObjectId(user.userId) }
      : { userId: new ObjectId(user.userId) };
    const character = await db.collection<Character>("characters").findOne(characterQuery);
    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    const [state, demographics, categories, statePartyOrgs, turnoutDoc, forexEnabled] =
      await Promise.all([
        db
          .collection<State>("states")
          .findOne({ _id: character.homeState, countryId: character.countryId }),
        db
          .collection<StateDemographics>("stateDemographics")
          .findOne({ _id: character.homeState, countryId: character.countryId }),
        loadDemographicCategories(db),
        db
          .collection<StatePartyOrg>("statePartyOrg")
          .find({ countryId: character.countryId, stateId: character.homeState })
          .toArray(),
        db
          .collection<StateDemographicTurnout>("stateDemographicTurnout")
          .findOne({ _id: character.homeState, countryId: character.countryId }),
        isForexEnabled(),
      ]);

    if (!demographics || !state) {
      return NextResponse.json({ error: "State or demographics not found" }, { status: 404 });
    }

    const userEP = character.policies.economic;
    const userSP = character.policies.social;
    const favorability = character.favorability;
    const politicalInfluence = character.politicalInfluence ?? 0;

    // Look up party organization for the character's party in their home state
    const partyOrgRecord = statePartyOrgs.find((po) => po.partyId === character.party);
    const partyOrgValue = partyOrgRecord?.organization;

    const fundCost = pollType === "large" ? LARGE_POLL_COST : SMALL_POLL_COST;
    const actionCost = pollType === "large" ? LARGE_POLL_ACTIONS : SMALL_POLL_ACTIONS;

    // Retrieve the stored poll (if any) so the UI can display it without re-commissioning
    const storedPollKey = pollType === "large" ? "lastPollLarge" : "lastPoll";
    let storedPoll = (character as Record<string, unknown>)[storedPollKey] as
      | {
          takenAt: Date;
          overallAppeal: number;
          totalEstimatedVoters: number;
          totalPotentialVoters: number;
          topGroups: unknown[];
          bottomGroups: unknown[];
          categories?: Array<{ id: string; name: string; groups?: unknown[] }>;
        }
      | undefined;

    // Invalidate stored poll if schema mismatch (e.g. old 6 categories vs new 12 voter
    // groups). The valid-id set spans every country's current voter archetypes (US 12
    // + the six seeded countries) so a player's own valid groups are never flagged stale.
    const VALID_VOTER_GROUP_IDS = getAllVoterArchetypeIds();
    const currentCategoryIds = new Set(categories.map((c) => c._id as string));
    const voterGroupsSchema = currentCategoryIds.has("voterGroups");
    const oldSchema = ["race", "gender", "education", "wealth", "age", "ideology"].some((id) =>
      currentCategoryIds.has(id)
    );

    const hasLegacyGroups = (groups: unknown[] | undefined) => {
      if (!groups?.length) return false;
      return groups.some((g) => {
        const id = (g as { id?: string })?.id;
        return id && !VALID_VOTER_GROUP_IDS.has(id);
      });
    };

    let shouldInvalidate = false;

    // Full Poll: invalidate when categories schema mismatch or group IDs are stale
    if (storedPoll?.categories?.length) {
      const storedCategories = storedPoll.categories as Array<{
        id: string;
        groups?: Array<{ id?: string }>;
      }>;
      const storedIds = new Set(storedCategories.map((c) => c.id));
      const storedHasVoterGroups = storedIds.has("voterGroups");
      const storedHasOld = ["race", "gender", "education", "wealth", "age", "ideology"].some((id) =>
        storedIds.has(id)
      );
      if ((voterGroupsSchema && storedHasOld) || (oldSchema && storedHasVoterGroups)) {
        shouldInvalidate = true;
      }
      // Also invalidate if any stored group ID is no longer valid (e.g. UK archetype rename)
      if (!shouldInvalidate) {
        const hasStaleGroups = storedCategories.some((cat) =>
          (cat.groups ?? []).some((g) => g.id && !VALID_VOTER_GROUP_IDS.has(g.id))
        );
        if (hasStaleGroups) shouldInvalidate = true;
      }
    }

    // Quick Poll (no categories): invalidate when topGroups/bottomGroups have legacy group IDs
    if (storedPoll && !storedPoll.categories?.length) {
      if (hasLegacyGroups(storedPoll.topGroups) || hasLegacyGroups(storedPoll.bottomGroups)) {
        shouldInvalidate = true;
      }
    }

    if (shouldInvalidate) {
      await db
        .collection<Character>("characters")
        .updateOne({ _id: character._id }, { $unset: { [storedPollKey]: 1 } });
      storedPoll = undefined;
    }

    const electionContext = await getElectionOpponents(character);
    const demographicTurnout = computeStateDemographicTurnout(
      character.homeState,
      // Age-aware electorate (P1b-1c): turnout is computed over the voting-age
      // population, matching the real tally; falls back to total on unseeded worlds.
      state.votingEligiblePopulation ?? state.population,
      "2019",
      turnoutDoc?.modifiers
    );

    // Campaign funds are decoupled from live forex — poll costs (anchor
    // constants) convert to local at the frozen base INITIAL_RATES scale.
    const campaignRate = forexEnabled ? campaignLocalRate(character.countryId ?? "US") : 1;

    const base = {
      pollType,
      homeState: character.homeState,
      stateName: state.name,
      statePopulation: state.population,
      character: {
        economicPosition: userEP,
        socialPosition: userSP,
        favorability,
        politicalInfluence,
        ...(partyOrgValue != null && { partyOrg: partyOrgValue }),
      },
      fundCost,
      actionCost,
      // SMALL/LARGE_POLL_COST are ANCHOR constants; the character balance is
      // LOCAL. Convert at the boundary for comparison.
      canAffordSmall:
        localCampaignBalance(character, forexEnabled) >=
        (forexEnabled ? SMALL_POLL_COST * campaignRate : SMALL_POLL_COST),
      canAffordLarge:
        localCampaignBalance(character, forexEnabled) >=
        (forexEnabled ? LARGE_POLL_COST * campaignRate : LARGE_POLL_COST),
      hasActionsSmall: character.actions >= SMALL_POLL_ACTIONS,
      hasActionsLarge: character.actions >= LARGE_POLL_ACTIONS,
      // Stored results from the last commissioned poll
      storedPoll: storedPoll
        ? {
            ...storedPoll,
            takenAt:
              storedPoll.takenAt instanceof Date
                ? storedPoll.takenAt.toISOString()
                : storedPoll.takenAt,
          }
        : null,
      electionContext,
      demographicTurnout,
    };

    return NextResponse.json(base);
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/actions/poll — Commissions a quick or full demographic poll, deducts funds and actions, and persists the results
// Auth: requireHumanSession (bot tokens rejected)
// Errors: 400, 401, 403, 404, 429
export async function POST(request: NextRequest) {
  try {
    const auth = await requireHumanSession(request);
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const rateLimit = checkRateLimit(user.userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, pollCommissionSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const pollType = parsed.data.type;
    const actionKey = pollType === "large" ? "pollLarge" : "poll";
    const fundCost = pollType === "large" ? LARGE_POLL_COST : SMALL_POLL_COST;

    const db = await getDb();

    // Resolve active character (admin accounts may have multiple characters)
    const userDoc = await db.collection<User>("users").findOne({ _id: new ObjectId(user.userId) });
    const characterQuery = userDoc?.activeCharacterId
      ? { _id: userDoc.activeCharacterId, userId: new ObjectId(user.userId) }
      : { userId: new ObjectId(user.userId) };
    const [character, forexEnabled] = await Promise.all([
      db.collection<Character>("characters").findOne(characterQuery),
      isForexEnabled(),
    ]);
    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    const gameState = await getGameState();
    // Campaign funds are decoupled from live forex — poll costs convert at the
    // frozen base INITIAL_RATES scale, never the live exchangeRates.
    const campaignRate = forexEnabled ? campaignLocalRate(character.countryId ?? "US") : 1;

    const validation = canPerformAction(character, actionKey, undefined, {
      forexEnabled,
      homeFxRate: campaignRate,
    });
    if (!validation.canPerform) {
      return NextResponse.json({ error: validation.reason }, { status: 400 });
    }

    const action = ACTIONS[actionKey];

    // Compute the poll results now so we can persist them
    const [state, demographics, categories, statePartyOrgs, turnoutDoc] = await Promise.all([
      db
        .collection<State>("states")
        .findOne({ _id: character.homeState, countryId: character.countryId }),
      db
        .collection<StateDemographics>("stateDemographics")
        .findOne({ _id: character.homeState, countryId: character.countryId }),
      loadDemographicCategories(db),
      db
        .collection<StatePartyOrg>("statePartyOrg")
        .find({ countryId: character.countryId, stateId: character.homeState })
        .toArray(),
      db.collection<StateDemographicTurnout>("stateDemographicTurnout").findOne({
        _id: character.homeState,
        countryId: character.countryId,
      }),
    ]);

    // Validate before charging — never charge if we cannot produce poll data
    if (!state) {
      return NextResponse.json(
        { error: `State not found for ${character.homeState}. Contact support.` },
        { status: 404 }
      );
    }
    if (!demographics) {
      return NextResponse.json(
        {
          error:
            "Demographic data not found for your state. Run Admin → Demographics → Reseed Demographics, then try again.",
        },
        { status: 400 }
      );
    }
    const voterGroupsCategory = categories.find((c) => (c._id as string) === "voterGroups");
    if (!voterGroupsCategory?.groups?.length) {
      return NextResponse.json(
        {
          error:
            "Demographic categories not configured. Run Admin → Demographics → Reseed Demographics, then try again.",
        },
        { status: 400 }
      );
    }

    let pollSnapshot: Record<string, unknown> | null = null;
    const electionContext = await getElectionOpponents(character);
    {
      const opponentsForShare: OpponentForShare[] | undefined = electionContext?.opponents?.map(
        (o) => ({
          candidateId: o.candidateId,
          name: o.name,
          economicPosition: o.economicPosition,
          socialPosition: o.socialPosition,
          favorability: o.favorability,
          politicalInfluence: o.politicalInfluence,
          party: o.party,
          ...(o.archetypeApprovals && { archetypeApprovals: o.archetypeApprovals }),
          ...(o.infamy != null && { infamy: o.infamy }),
        })
      );

      // Use shared turnout resolver (same as elections) for consistent GOTV/canvassing effects
      const gsPreset = gameState?.preset;
      let liveTurnouts = buildLiveTurnouts(demographics, categories, turnoutDoc, {
        preset: gsPreset,
      });

      // Primary-phase polls see a shifted electorate — Dem primary voters are
      // more liberal than the general Dem-leaning electorate, GOP primary voters
      // are more conservative than the general. Retention must be applied to the
      // liveTurnouts map itself: buildLiveTurnouts for US states rebuilds from
      // Layer-1 baselines and would otherwise wipe a demographics-only shift,
      // desyncing polls from projectPrimaryByState / stagger results.
      let effectiveDemographics = demographics;
      if (
        electionContext?.inPrimary &&
        electionContext?.electionType === "president" &&
        character.party
      ) {
        const pollPartyDoc = await db
          .collection<PoliticalParty>("politicalParties")
          .findOne(
            { countryId: character.countryId ?? "US", sequentialId: Number(character.party) },
            { projection: { economicPosition: 1, socialPosition: 1 } }
          );
        if (pollPartyDoc) {
          const partyPosition = {
            economicPosition: pollPartyDoc.economicPosition,
            socialPosition: pollPartyDoc.socialPosition,
          };
          effectiveDemographics = shiftDemographicsForPrimary(demographics, partyPosition);
          liveTurnouts = applyPrimaryTurnoutRetention(liveTurnouts, demographics, partyPosition);
        }
      }

      const pd = await computePollData(
        character,
        state,
        effectiveDemographics,
        categories,
        statePartyOrgs,
        opponentsForShare,
        liveTurnouts,
        state.votingSystem ?? "fptp"
      );
      pollSnapshot = {
        takenAt: new Date(),
        overallAppeal: pd.overallAppeal,
        totalEstimatedVoters: pd.totalEstimatedVoters,
        totalPotentialVoters: pd.totalPotentialVoters,
        topGroups: pd.topGroups,
        bottomGroups: pd.bottomGroups,
        ...(pd.inRaceVoteShare && { inRaceVoteShare: pd.inRaceVoteShare }),
        ...(pollType === "large" ? { categories: pd.results } : {}),
      };
    }

    // Additive granular electorate breakdown: flag-gated, available for the US
    // and for any country with a CountryLayer1Model, and wrapped so any failure
    // here never breaks the poll commission.
    if (pollSnapshot && isGranularPollEnabled(gameState)) {
      try {
        const countryId = state.countryId ?? "US";
        const preset = gameState?.preset ?? DEFAULT_SEED_PRESET;
        const era = eraForPreset(preset);
        // Live era clock — the poll must describe the SAME electorate the vote
        // engines are counting, so it reads the year through the same gate.
        const pollEraYear = eraYearContextFromGameState(gameState);
        const model = getCountryLayer1Model(countryId, era);
        // eslint-disable-next-line local/no-country-literals -- US Layer-1 model lives outside getCountryLayer1Model
        if (model || countryId === "US") {
          const granularPayload = buildGranularPollPayloadForState({
            countryId,
            stateId: state._id as string,
            preset,
            era: pollEraYear.year != null ? undefined : era,
            year: pollEraYear.year,
            startingYear: pollEraYear.startingYear,
            character: {
              economicPosition: character.policies.economic,
              socialPosition: character.policies.social,
              favorability: character.favorability,
              politicalInfluence: character.politicalInfluence ?? 0,
            },
            opponents:
              electionContext?.opponents?.map((o) => ({
                candidateId: o.candidateId,
                name: o.name ?? o.candidateId,
                economicPosition: o.economicPosition,
                socialPosition: o.socialPosition,
                favorability: o.favorability,
                politicalInfluence: o.politicalInfluence,
              })) ?? [],
          });
          pollSnapshot.granular = granularPayload;
        }
      } catch (err) {
        console.error("[poll] granular payload failed:", err);
      }
    }

    const storedPollKey = pollType === "large" ? "lastPollLarge" : "lastPoll";

    // fundCost is ANCHOR; convert to LOCAL (frozen rate) for filter + $inc.
    const fundCostLocal = forexEnabled ? fundCost * campaignRate : fundCost;
    const campaignFundsField = forexEnabled ? "currencyBalances.campaign" : "funds";
    const spendFilter = {
      _id: character._id,
      actions: { $gte: action.baseCost },
      [campaignFundsField]: { $gte: fundCostLocal },
    };
    const spendResult = await db.collection("characters").updateOne(spendFilter, {
      $inc: {
        actions: -action.baseCost,
        [campaignFundsField]: -fundCostLocal,
      },
      $set: {
        updatedAt: new Date(),
        ...(pollSnapshot ? { [storedPollKey]: pollSnapshot } : {}),
      },
    });
    if (spendResult.modifiedCount === 0) {
      return NextResponse.json(
        { error: "Your available actions or campaign funds changed. Please try again." },
        { status: 409 }
      );
    }

    const actionLog: Omit<ActionLog, "_id"> = {
      characterId: character._id,
      userId: new ObjectId(user.userId),
      actionType: actionKey,
      actionCost: action.baseCost,
      result: {
        success: true,
        fundsChange: -fundCost,
        message:
          pollType === "large"
            ? `Commissioned a full demographic poll for $${fundCost.toLocaleString()}.`
            : `Commissioned a quick poll for $${fundCost.toLocaleString()}.`,
      },
      turn: gameState?.currentTurn || 0,
      createdAt: new Date(),
      characterName: character.name,
      username: userDoc?.username,
      countryId: character.countryId,
    };
    await db.collection("actionLogs").insertOne(actionLog);

    try {
      const { checkActionAchievements } = await import("@/lib/achievements/triggers");
      await checkActionAchievements(new ObjectId(user.userId), character._id, actionKey);
    } catch (e) {
      console.error("Achievement check failed:", e);
    }

    const updatedCharacter = await db.collection<Character>("characters").findOne({
      _id: character._id,
    });

    return NextResponse.json({
      success: true,
      message:
        pollType === "large"
          ? `Full poll commissioned for $${fundCost.toLocaleString()}.`
          : `Quick poll commissioned for $${fundCost.toLocaleString()}.`,
      character: updatedCharacter,
      pollSnapshot,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
