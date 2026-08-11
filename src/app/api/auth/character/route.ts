import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { handleRouteError } from "@/lib/api/errors";
import { setCharacterGateCookie } from "@/lib/auth/characterGateCookie";
import { MongoServerError, ObjectId, type Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { Character, GameConfig, State } from "@/lib/db/types";
import { normalizeMaintenanceMode } from "@/lib/maintenanceStatus";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { createCharacterSchema } from "@/lib/api/schemas/settings";
import { getNextSequentialId } from "@/lib/db/sequentialId";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getCountryAccess } from "@/lib/countryAccess";
import { getGameTime } from "@/lib/time/gameTime";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { buildPersonalBalanceInc } from "@/lib/currency/characterFunds";
import { energyActionLimits } from "@/lib/stats/statDrift";
import { STAT_MIN } from "@/lib/stats/statsConstants";
import { COUNTRY_CURRENCY_MAP, INITIAL_RATES } from "@/lib/constants/currencies";
import { getWealthBonus, type WealthLevel } from "@/lib/constants/characterWealth";
import { getEraNominalAmount } from "@/lib/constants/sectorSeedEra";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";
import type { CountryId } from "@/lib/constants/countries";
import { validateStatAllocation } from "@/lib/stats/validateStatAllocation";
import { isRpgStatsEnabled } from "@/lib/stats/featureFlag";
import type { CharacterStats } from "@/lib/stats/statsConstants";
import { sendSystemMail } from "@/lib/mail/systemMail";
import { isOnboardingChecklistEnabled } from "@/lib/onboarding/featureFlag";
import { onboardingRewardAmount } from "@/lib/onboarding/reward";
import {
  buildWelcomeMailBody,
  WELCOME_MAIL_SENDER,
  WELCOME_MAIL_SUBJECT,
} from "@/lib/onboarding/welcomeMail";
import {
  loadUsPoliticalStateIds,
  unplayableTerritoryHomeError,
} from "@/lib/elections/usPoliticalHome";
import { isUsPoliticalState } from "@/lib/elections/statehoodAdmission";

const MIN_STARTING_DONOR_BASE_LEVEL = 1;

async function repairLegacyCharacterUserIdIndex(db: Db): Promise<boolean> {
  const collection = db.collection("characters");
  const indexes = await collection.indexes();
  const userIdIndexes = indexes.filter((index) => index.key?.userId === 1);
  const legacyIndex = userIdIndexes.find((index) => index.unique === true);
  const hasNonUniqueIndex = userIdIndexes.some((index) => !index.unique);

  if (!legacyIndex?.name) return false;

  await collection.dropIndex(legacyIndex.name);
  if (!hasNonUniqueIndex) {
    await collection.createIndex({ userId: 1 }, { name: "characters_userId" });
  }
  return true;
}

function isUserIdDuplicateKey(error: unknown): error is MongoServerError {
  return (
    error instanceof MongoServerError &&
    error.code === 11000 &&
    (!!error.keyPattern?.userId ||
      /(?:^|[.\s])userId_1\b/.test(error.message) ||
      /\bcharacters_userId\b/.test(error.message))
  );
}

// POST /api/auth/character — Creates a new character for the authenticated user with starting stats and referral bonuses.
// Auth: requireBasicAuth
// Errors: 400, 401, 409, 429
export async function POST(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const userId = auth.user.userId;

    const rateLimit = checkRateLimit(userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, createCharacterSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const {
      name,
      homeState,
      countryId: requestedCountryId,
      party: selectedParty,
      policies,
      demographics,
      stats: rawStats,
      tutorialTrack,
    } = parsed.data;

    // Validate the optional 28-point stat allocation. When provided it must be a
    // legal spread; when omitted the character is created without stats and is
    // routed through the grandfather allocation flow on next login. Gated behind
    // the RPG-stats feature flag — when off, any submitted stats are ignored.
    let allocatedStats: CharacterStats | undefined;
    const rpgStatsEnabled = await isRpgStatsEnabled();
    if (rpgStatsEnabled && rawStats !== undefined) {
      const statValidation = validateStatAllocation(rawStats);
      if (!statValidation.ok) {
        return NextResponse.json({ error: statValidation.error }, { status: 400 });
      }
      allocatedStats = statValidation.stats;
    }

    const db = await getDb();

    // Verify state exists, scoped to the country the user picked at registration.
    const stateDoc = await db.collection<State>("states").findOne({
      _id: homeState,
      countryId: requestedCountryId.toUpperCase() as import("@/lib/constants/countries").CountryId,
    });
    if (!stateDoc) {
      return NextResponse.json({ error: "Invalid home state" }, { status: 400 });
    }

    // Pre-statehood US territories (Alaska/Hawaii under 1953-default) stay on
    // the map for economy/admission but are not playable home states.
    if ((stateDoc.countryId ?? "US") === "US") {
      const { admittedIds, preset } = await loadUsPoliticalStateIds(db);
      if (!isUsPoliticalState(stateDoc._id, preset, admittedIds)) {
        return NextResponse.json(
          { error: unplayableTerritoryHomeError(stateDoc.name) },
          { status: 400 }
        );
      }
    }

    // Get game config, user, country access, and current turn in parallel
    const [gameConfig, userDoc, countryAccess, gameTime] = await Promise.all([
      db.collection<GameConfig>("gameConfig").findOne({ _id: "default" }),
      db.collection("users").findOne({ _id: new ObjectId(userId) }),
      getCountryAccess(stateDoc.countryId),
      getGameTime(),
    ]);

    // Check character limit: admins are unlimited; test mode allows 3 for everyone; otherwise 1.
    const activeCount = userDoc?.activeCharacterCount ?? 0;
    const isAdmin = !!userDoc?.isAdmin;
    const isTestMode = !!gameConfig?.testMode;
    const TEST_MODE_CHARACTER_LIMIT = 3;

    if (!isAdmin) {
      if (isTestMode && activeCount >= TEST_MODE_CHARACTER_LIMIT) {
        return NextResponse.json(
          { error: `Test server allows up to ${TEST_MODE_CHARACTER_LIMIT} characters per account` },
          { status: 409 }
        );
      } else if (!isTestMode && activeCount >= 1) {
        return NextResponse.json({ error: "You already have a character" }, { status: 409 });
      }
    }

    if (!gameConfig) {
      return NextResponse.json(
        { error: "Game not configured. Please contact administrator." },
        { status: 500 }
      );
    }

    // Block character creation during maintenance — admins bypass so they can
    // verify a freshly-reset world before reopening it.
    //
    // This guard is enforced here, in the route, rather than relying on the
    // proxy's maintenance redirect: `src/proxy.ts` returns early for `/api/*`
    // (so API clients get JSON, not a maintenance HTML redirect), which means
    // no API route is covered by that gate. Without this check a non-admin who
    // reached the creation form — or simply POSTed here directly — could still
    // create a character while the site was sealed. Mirrors the same guard on
    // `POST /api/auth/register`, and reads `gameConfig` directly so it agrees
    // with the admin panel and `/api/maintenance`.
    if (!isAdmin && normalizeMaintenanceMode(gameConfig.maintenanceMode) !== "off") {
      return NextResponse.json(
        { error: "Character creation is disabled during maintenance. Please try again later." },
        { status: 503 }
      );
    }

    const isReferred = !!userDoc?.referredBy;
    // Era money: a 1953 world's economy is ~70x smaller in nominal terms, and
    // corp founding costs deflate with this, so the two stay in proportion.
    const worldPreset = await getGameStatePresetOrDefault(db);
    const REFERRAL_PERSONAL_CAPITAL_BONUS = getEraNominalAmount(500_000, worldPreset);

    // Wealth background sets personal cash only; campaign funds are flat from gameConfig.
    // WEALTH_BONUS is shared with the registration UI so the previewed amount and the
    // amount actually credited here can never drift.
    const wealthBonus = getWealthBonus(demographics.wealth as WealthLevel, worldPreset);
    const startingDonorBaseLevel = Math.max(
      gameConfig.startingDonorBaseLevel ?? 0,
      MIN_STARTING_DONOR_BASE_LEVEL
    );

    // Create character with starting values
    // Derive countryId from the state document (populated from DB above)
    const countryId = stateDoc.countryId;

    const forexEnabled = await isForexEnabled();
    const homeCurrency =
      COUNTRY_CURRENCY_MAP[countryId as keyof typeof COUNTRY_CURRENCY_MAP] ?? "USD";

    // Block character creation in disabled countries (admins bypass for testing)
    if (!isAdmin && !countryAccess.enabledForPlayers) {
      return NextResponse.json(
        { error: "This country is not currently available for new characters." },
        { status: 403 }
      );
    }

    const character: Omit<Character, "_id"> = {
      userId: new ObjectId(userId),
      name,
      homeState,
      countryId,

      // Core Stats (10% bonus if referred, except donorBase)
      politicalInfluence: isReferred
        ? Math.floor(gameConfig.startingPoliticalInfluence * 1.1)
        : gameConfig.startingPoliticalInfluence,
      favorability: isReferred
        ? Math.floor(gameConfig.startingFavorability * 1.1)
        : gameConfig.startingFavorability,
      infamy: gameConfig.startingInfamy,

      // Resources (+10 extra actions and personal capital bonus if referred)
      // Wealth level affects personal cash only; campaign funds start flat from gameConfig
      funds: gameConfig.startingFunds,
      cashOnHand: wealthBonus + (isReferred ? REFERRAL_PERSONAL_CAPITAL_BONUS : 0),
      actions: isReferred ? gameConfig.startingActions + 10 : gameConfig.startingActions,
      // Dual-write: both legacy fields (funds, cashOnHand) and new currencyBalances are set.
      // When forexEnabled, `currencyBalances.campaign` stores the home-currency
      // campaign balance while `funds` remains the internal/anchor mirror for
      // compatibility reads.
      //
      // Starting endowment is in ₳ (anchor units). Multiply by INITIAL_RATES[countryId] to convert
      // to home currency. Using INITIAL_RATES (not live DB rates) matches migration.ts semantics and
      // prevents cohort splits where chars created at different exchange levels get unequal starts.
      ...(forexEnabled
        ? {
            currencyBalances: {
              campaign: Math.round(
                gameConfig.startingFunds * (INITIAL_RATES[countryId as CountryId] ?? 1.0)
              ),
              personal: {
                [homeCurrency]: Math.round(
                  (wealthBonus + (isReferred ? REFERRAL_PERSONAL_CAPITAL_BONUS : 0)) *
                    (INITIAL_RATES[countryId as CountryId] ?? 1.0)
                ),
              },
            },
            displayCurrencyPreference: "local" as const,
            autoConvertEnabled: true,
          }
        : {}),
      donorBaseLevel: startingDonorBaseLevel,

      // RPG stats — written only when the creation UI supplied a legal 28-point
      // allocation. Seed an empty XP ledger and anchor the Debate decay clock.
      ...(allocatedStats
        ? {
            stats: allocatedStats,
            statsAllocated: true,
            statXp: {},
            debateDecayAnchor: new Date(),
          }
        : {}),

      // Policy Positions (economic and social, -5 to +5)
      policies: {
        economic: Math.round(policies.economic),
        social: Math.round(policies.social),
      },

      // Demographics
      demographics,

      // Political Status
      party: selectedParty,
      // Tenure anchor for the leadership gate — only when starting in a real
      // party (independents have no party tenure). See leadershipTenure.ts.
      ...(selectedParty && selectedParty !== "independent"
        ? {
            partyJoinedTurn: gameTime.currentTurn,
            // `partyJoinedAt` anchors the career-history party-tenure date to the
            // game clock so a character created mid-era shows the correct game-era
            // join year, not a wall-clock fallback (e.g. ~1997 for a 1991-start
            // game at turn 300). See buildPartyTenures tail reconciliation.
            // `effectiveNow` = lastTurnProcessed when not paused, which maps
            // through formatGameMonth() to the current game month/year.
            partyJoinedAt: gameTime.effectiveNow,
          }
        : {}),
      currentOffice: null,

      // Legacy savings mirror (pre-forex); forex-era equivalent is currencyBalances.savings
      savingsOnHand: 0,
      // Line of credit — initialized empty so the turn processor can safely
      // read balances/arrears without checking for document existence first.
      lineOfCredit: {
        balances: {},
        arrears: {},
      },

      // Career & influence (initialized empty so readers never see undefined)
      careerHistory: [],
      executiveTermsServed: {},
      nationalInfluence: 0,
      partyInfluence: 0,
      groupFavorability: {},
      archetypeApprovals: {},
      onboardingDismissed: false,
      // Only set when an older client still sends it. New characters answer the
      // welcome flow instead, which writes `tutorial` (see tutorialPlan.ts).
      ...(tutorialTrack ? { tutorialTrack } : {}),
      hasReadWiki: false,
      autoRunForReelection: false,

      // Sequential ID for stable URLs
      sequentialId: await getNextSequentialId(db, "character"),
      createdAt: new Date(),
      // Turn-first anchor for the 24-turn new-character transfer barrier.
      createdTurn: gameTime.currentTurn,
      updatedAt: new Date(),
    };

    let result: { insertedId: ObjectId };
    try {
      result = await db.collection("characters").insertOne(character);
    } catch (err) {
      // Older environments can still carry the legacy unique characters.userId index.
      // Admin/test-mode multi-character creation is the first place that stale index surfaces.
      if (isUserIdDuplicateKey(err)) {
        if ((isAdmin || isTestMode) && (await repairLegacyCharacterUserIdIndex(db))) {
          try {
            result = await db.collection("characters").insertOne(character);
            // Retry succeeded after removing the stale unique userId index.
          } catch (retryErr) {
            if (isUserIdDuplicateKey(retryErr)) {
              return NextResponse.json({ error: "You already have a character" }, { status: 409 });
            }
            throw retryErr;
          }
        } else {
          return NextResponse.json({ error: "You already have a character" }, { status: 409 });
        }
      } else {
        throw err;
      }
    }
    const characterId = result.insertedId;

    // Reward referrer: +10 actions, +$500k personal capital, increment referralCount
    if (isReferred && userDoc?.referredBy) {
      const referrerChar = await db
        .collection("characters")
        .findOne({ userId: userDoc.referredBy });
      if (referrerChar) {
        const referrerCountry = (referrerChar.countryId as string) ?? "US";
        const referrerCurrency =
          COUNTRY_CURRENCY_MAP[referrerCountry as keyof typeof COUNTRY_CURRENCY_MAP] ?? "USD";
        const contestStartedAt = gameConfig?.referralContestStartedAt;
        const contestActive =
          contestStartedAt instanceof Date && character.createdAt >= contestStartedAt;
        const referrerUserInc: Record<string, number> = { referralCount: 1 };
        if (contestActive) referrerUserInc.referralContestCount = 1;

        await Promise.all([
          db.collection("characters").updateOne(
            { _id: referrerChar._id },
            {
              $inc: {
                actions: 10,
                ...buildPersonalBalanceInc(
                  REFERRAL_PERSONAL_CAPITAL_BONUS,
                  referrerCurrency,
                  forexEnabled
                ),
              },
              $set: { updatedAt: new Date() },
            }
          ),
          db.collection("users").updateOne({ _id: userDoc.referredBy }, { $inc: referrerUserInc }),
        ]);
        // Clamp the post-bonus total at the referrer's Energy-scaled action cap
        // (matches actionRefresh), not the static baseline.
        const referrerCap = energyActionLimits(referrerChar.stats?.energy ?? STAT_MIN).cap;
        await db
          .collection("characters")
          .updateOne({ _id: referrerChar._id }, [
            { $set: { actions: { $min: [referrerCap, "$actions"] } } },
          ]);
      }
    }

    // Award Alpha Tester achievement (account-bound, keyed by userId)
    try {
      const { awardAchievement } = await import("@/lib/achievements");
      await awardAchievement(new ObjectId(userId), "alpha_tester", characterId);
    } catch (e) {
      console.error("Achievement award failed:", e);
    }

    // Welcome mail pointing at the onboarding checklist (best-effort; gated on
    // the onboarding-checklist flag so flag-off worlds behave exactly as before).
    try {
      if (await isOnboardingChecklistEnabled()) {
        await sendSystemMail(db, {
          toCharacterId: characterId,
          toCharacterName: name,
          toCharacterSequentialId: character.sequentialId ?? 0,
          toUserId: new ObjectId(userId),
          senderName: WELCOME_MAIL_SENDER,
          subject: WELCOME_MAIL_SUBJECT,
          body: buildWelcomeMailBody({
            countryId,
            startingFunds: character.funds ?? gameConfig.startingFunds,
            startingActions: character.actions,
            rewardAmount: onboardingRewardAmount(gameConfig.startingFunds),
            turnLengthMinutes: gameConfig.turnLengthMinutes,
          }),
        });
      }
    } catch (e) {
      console.error("Welcome mail failed:", e);
    }

    // Update user to mark setup as complete and track active character
    await db.collection("users").updateOne(
      { _id: new ObjectId(userId) },
      {
        $set: {
          hasCompletedSetup: true,
          activeCharacterId: result.insertedId,
          accountCountryId: userDoc?.accountCountryId ?? countryId,
          updatedAt: new Date(),
        },
        $inc: { activeCharacterCount: 1 },
      }
    );

    // Clear the character-creation hint cookie now that the player has a
    // character, so the post-create redirect to /dashboard is not bounced back
    // to /create-character by the middleware on a stale hint.
    await setCharacterGateCookie(await cookies(), false);

    // Get username to update the account_created log with character name
    const user = await db.collection("users").findOne({ _id: new ObjectId(userId) });
    if (user?.username) {
      // Update the account_created log to include the character name
      await db.collection("adminLogs").updateOne(
        {
          username: user.username,
          action: "account_created",
          $or: [{ characterName: { $exists: false } }, { characterName: null }],
        },
        { $set: { characterName: name } }
      );
    }

    return NextResponse.json(
      {
        message: "Character created successfully",
        characterId: result.insertedId.toString(),
      },
      { status: 201 }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

// GET /api/auth/character — Returns the current user's character document.
// Auth: requireBasicAuth
// Errors: 401, 404
// GET endpoint to fetch current user's character
export async function GET() {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const userId = auth.user.userId;

    const db = await getDb();
    // Scope by activeCharacterId when present so multi-character accounts resolve the
    // same character /api/auth/me uses. Without this, downstream pages (actions,
    // settings, etc.) silently operate on whichever character was inserted first.
    const userDoc = await db
      .collection("users")
      .findOne({ _id: new ObjectId(userId) }, { projection: { activeCharacterId: 1 } });
    const characterQuery = userDoc?.activeCharacterId
      ? { _id: userDoc.activeCharacterId, userId: new ObjectId(userId) }
      : { userId: new ObjectId(userId) };
    const character = await db.collection("characters").findOne(characterQuery);

    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    return NextResponse.json(character);
  } catch (error) {
    return handleRouteError(error);
  }
}
