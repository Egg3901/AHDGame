import { charterMay } from "@/lib/banking/rules/capabilities";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter, requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { z } from "zod";
import type { Character, Corporation, Election, ImperialCharacter, User } from "@/lib/db/types";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { findBlockingActiveCandidacy } from "@/lib/elections/activeCandidacy";
import { foundingCooldownTurnsRemaining } from "@/lib/corporations/foundingCooldown";
import { getGameState } from "@/lib/gameState";
import { fetchBordersByUserIds } from "@/lib/db/patreonBorders";
import { getAuthUser } from "@/lib/auth";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { getTotalPersonalLiquidWealth } from "@/lib/currency/characterFunds";
import { loadFxRatesRecord } from "@/lib/currency/corporationCapital";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import { reconcileUnionLeaderCache } from "@/lib/unions/unionReconciliation";
import { TRACKED_ONBOARDING_STEP_IDS } from "@/lib/onboarding/checklist";
import { isOnboardingChecklistEnabled } from "@/lib/onboarding/featureFlag";
import { isBankPropTradingEnabled } from "@/lib/banking/featureFlag";

// The current corporation is read here, so this endpoint must never serve a
// stale body: a positive max-age let the browser return a pre-founding
// (corporation: null) response to the post-founding refetch, making a newly
// founded corp "disappear" until a hard refresh. no-store keeps it fresh.
const ME_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-transform",
};

// GET /api/character/me — Returns the authenticated user's character data and their current CEO corporation if any.
// Handles both regular and imperial characters.
// Auth: requireAuthWithCharacter (regular) or getAuthUser + manual imperial lookup
// Errors: 401
export async function GET() {
  try {
    const db = await getDb();
    const bankPropTradingEnabled = await isBankPropTradingEnabled();

    // Check for imperial mode first — requireAuthWithCharacter would 401
    const authUser = await getAuthUser();
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userDoc = await db
      .collection<User>("users")
      .findOne({ _id: new ObjectId(authUser.userId) });
    if (userDoc?.activeCharacterType === "imperial" && userDoc.activeImperialCharacterId) {
      const imperial = await db
        .collection<ImperialCharacter>("imperialCharacters")
        .findOne({ _id: userDoc.activeImperialCharacterId, userId: new ObjectId(authUser.userId) });

      if (imperial) {
        const [corporation, forexEnabled] = await Promise.all([
          db.collection<Corporation>("corporations").findOne(
            { ceoId: imperial._id, ceoType: "imperial", ceoVacant: { $ne: true } },
            {
              projection: {
                _id: 1,
                sequentialId: 1,
                name: 1,
                countryOwnerId: 1,
                liquidCapital: 1,
                liquidCurrencyCode: 1,
                bankCharter: 1,
              },
            }
          ),
          isForexEnabled(),
        ]);

        const homeCurrency = COUNTRY_CURRENCY_MAP[imperial.countryId as CountryId];
        const imperialForexRates = forexEnabled ? await loadFxRatesRecord(db) : undefined;

        return NextResponse.json(
          {
            character: {
              _id: imperial._id.toString(),
              name: imperial.name,
              party: null,
              homeState: imperial.homeState,
              cashOnHand: getTotalPersonalLiquidWealth(imperial, forexEnabled, imperialForexRates),
              countryId: imperial.countryId,
              avatarUrl: imperial.avatarUrl ?? null,
              borderKey: imperial.borderKey ?? null,
              tintColor: imperial.tintColor ?? null,
              activeElection: null,
              isImperial: true,
              ...(forexEnabled && imperial.currencyBalances
                ? {
                    currencyBalances: imperial.currencyBalances,
                    homeCurrency,
                    autoConvertEnabled: imperial.autoConvertEnabled ?? true,
                  }
                : {}),
            },
            corporation: corporation
              ? {
                  _id: corporation._id.toString(),
                  sequentialId: corporation.sequentialId,
                  name: corporation.name,
                  isNationalCorp: !!corporation.countryOwnerId,
                  liquidCapital: corporation.liquidCapital ?? 0,
                  liquidCurrencyCode: corporation.liquidCurrencyCode,
                  isInvestmentBank:
                    bankPropTradingEnabled &&
                    charterMay(corporation.bankCharter, "proprietaryTrading"),
                }
              : null,
          },
          { headers: ME_CACHE_HEADERS }
        );
      }
    }

    // Regular character path
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    // Parallelize independent queries
    const [corporation, blockingRace, borderMap, forexEnabled, reconciledUnionLeaderOf] =
      await Promise.all([
        db.collection<Corporation>("corporations").findOne(
          { ceoId: user.character._id, ceoVacant: { $ne: true } },
          {
            projection: {
              _id: 1,
              sequentialId: 1,
              name: 1,
              logoUrl: 1,
              countryOwnerId: 1,
              liquidCapital: 1,
              liquidCurrencyCode: 1,
              bankCharter: 1,
            },
          }
        ),
        findBlockingActiveCandidacy(db, user.character._id),
        fetchBordersByUserIds(db, [new ObjectId(user.userId)]),
        isForexEnabled(),
        // Code-review fix #8: self-heal a desynced unionLeaderOf cache on
        // read (see reconcileUnionLeaderCache's docblock) — also un-sticks a
        // character wrongly locked out of claiming a union.
        reconcileUnionLeaderCache(db, user.character),
      ]);

    const activeElection: {
      id: string;
      seatId?: string;
      electionType: Election["electionType"];
      state: string;
      cycle: number;
    } | null = blockingRace
      ? {
          id: blockingRace.election._id.toString(),
          seatId: blockingRace.election.seatId ?? undefined,
          electionType: blockingRace.election.electionType,
          state: blockingRace.election.state,
          cycle: blockingRace.election.cycle,
        }
      : null;

    const border = borderMap.get(user.userId);

    const homeCurrency = COUNTRY_CURRENCY_MAP[user.character.countryId as CountryId];
    const forexRates = forexEnabled ? await loadFxRatesRecord(db) : undefined;

    // Bug #0728: turns remaining before this user may found another corporation.
    // userDoc is fetched above for every request; 0 means "may found now".
    const gameState = await getGameState();
    const foundingCooldownRemaining = foundingCooldownTurnsRemaining(
      userDoc?.lastCorporationFoundedTurn,
      gameState?.currentTurn ?? 0
    );

    return NextResponse.json(
      {
        foundingCooldownTurnsRemaining: foundingCooldownRemaining,
        character: {
          _id: user.character._id.toString(),
          name: user.character.name,
          party: user.character.party,
          homeState: user.character.homeState,
          cashOnHand: getTotalPersonalLiquidWealth(user.character, forexEnabled, forexRates),
          actions: user.character.actions ?? 0,
          countryId: user.character.countryId,
          // Both shapes: `tutorial` is the plan the welcome flow writes,
          // `tutorialTrack` is the legacy field resolveTutorialPlan migrates
          // from for characters that predate it.
          tutorial: user.character.tutorial ?? null,
          tutorialTrack: user.character.tutorialTrack ?? null,
          createdAt: user.character.createdAt ?? null,
          avatarUrl: user.character.avatarUrl ?? null,
          borderKey: border?.borderKey ?? null,
          tintColor: border?.tintColor ?? null,
          activeElection,
          unionLeaderOf: reconciledUnionLeaderOf?.toString() ?? null,
          ...(forexEnabled && user.character.currencyBalances
            ? {
                currencyBalances: user.character.currencyBalances,
                homeCurrency,
                savingsAccountsOpened: user.character.savingsAccountsOpened ?? {},
                autoConvertEnabled: user.character.autoConvertEnabled ?? true,
                displayCurrencyPreference:
                  user.character.displayCurrencyPreference ?? (forexEnabled ? "local" : "internal"),
              }
            : {}),
        },
        corporation: corporation
          ? {
              _id: corporation._id.toString(),
              sequentialId: corporation.sequentialId,
              name: corporation.name,
              logoUrl: corporation.logoUrl ?? null,
              isNationalCorp: !!corporation.countryOwnerId,
              liquidCapital: corporation.liquidCapital ?? 0,
              liquidCurrencyCode: corporation.liquidCurrencyCode,
              isInvestmentBank:
                bankPropTradingEnabled && charterMay(corporation.bankCharter, "proprietaryTrading"),
            }
          : null,
      },
      { headers: ME_CACHE_HEADERS }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

const patchSchema = z.object({
  onboardingDismissed: z.boolean().optional(),
  autoConvertEnabled: z.boolean().optional(),
  statAllocationDismissed: z.boolean().optional(),
  // Strict whitelist: only the two page-visit checklist steps are recordable,
  // only for the caller's own character, and the timestamp is set server-side.
  onboardingStep: z.enum(TRACKED_ONBOARDING_STEP_IDS).optional(),
});

// PATCH /api/character/me — Updates mutable character settings such as onboarding dismissed state
// Auth: requireBasicAuth
// Errors: 400, 401, 404, 429
export async function PATCH(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const rateLimit = checkRateLimit(user.userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, patchSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const now = new Date();
    const updates: Record<string, unknown> = {};
    if (parsed.data.onboardingDismissed !== undefined) {
      updates.onboardingDismissed = parsed.data.onboardingDismissed;
      // Keep the checklist-era dismissal stamp in sync with the legacy boolean
      // so both readers agree (see isOnboardingDismissed).
      if (parsed.data.onboardingDismissed) {
        updates["onboarding.dismissedAt"] = now;
      }
    }
    if (parsed.data.autoConvertEnabled !== undefined) {
      updates.autoConvertEnabled = parsed.data.autoConvertEnabled;
    }
    if (parsed.data.statAllocationDismissed !== undefined) {
      updates.statAllocationDismissed = parsed.data.statAllocationDismissed;
    }

    const onboardingStep = parsed.data.onboardingStep;
    if (Object.keys(updates).length === 0 && onboardingStep === undefined) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const db = await getDb();
    const activeCharacter = await getCharacterByUserId(db, user.userId);
    if (!activeCharacter) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    const ownCharacterFilter = { _id: activeCharacter._id, userId: new ObjectId(user.userId) };

    if (Object.keys(updates).length > 0) {
      await db
        .collection<Character>("characters")
        .updateOne(ownCharacterFilter, { $set: { ...updates, updatedAt: now } });
    }

    if (onboardingStep !== undefined && (await isOnboardingChecklistEnabled())) {
      // Flag-gated so flag-off worlds truly take zero onboarding writes (the
      // tracker never renders there, but the invariant shouldn't rely on the
      // client). First visit wins: never overwrite an existing timestamp.
      await db
        .collection<Character>("characters")
        .updateOne(
          { ...ownCharacterFilter, [`onboarding.steps.${onboardingStep}`]: { $exists: false } },
          { $set: { [`onboarding.steps.${onboardingStep}`]: now, updatedAt: now } }
        );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
