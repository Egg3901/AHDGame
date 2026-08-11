import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { clearAuthCookie, getTrackingCookieOptions, verifyAuth } from "@/lib/auth";
import { needsCharacterHint } from "@/lib/auth/characterGate";
import { setCharacterGateCookie } from "@/lib/auth/characterGateCookie";
import { AUTH_COOKIE_NAME } from "@/lib/authCookieName";
import type { Character, Notification, PoliticalParty, State, User } from "@/lib/db/types";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import { handleRouteError } from "@/lib/api/errors";
import { isPatreonActive } from "@/lib/db/types";
import { getImperialTitle } from "@/lib/imperial";
import { getTotalPersonalLiquidWealth, getHomeCurrency } from "@/lib/currency/characterFunds";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { isRpgStatsEnabled } from "@/lib/stats/featureFlag";
import { getGameState } from "@/lib/gameState";
import { isRedistrictingEnabled } from "@/lib/redistricting/flag";
import { loadFxRatesRecord } from "@/lib/currency/corporationCapital";
import { getNotificationBundleUserIds } from "@/lib/notifications/notificationBundle";

function getPatreonAdPreference(
  user: User | null | undefined
): "ad-free" | "player-only" | "all-ads" {
  if (user?.patreonAdPreference) return user.patreonAdPreference;
  return user?.adsDisabled ? "ad-free" : "all-ads";
}

// GET /api/auth/me — Returns the current user's profile, character, and unread notification counts.
// Auth: public (manual JWT via cookie)
// Errors: 401
export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;

    if (!token) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const payload = await verifyAuth();
    if (!payload) {
      await clearAuthCookie("auth_me:verify_returned_null");
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const userId = payload.userId;
    const username = payload.username;
    const isAdminFromJwt = payload.isAdmin;

    const db = await getDb();
    let user = await db.collection<User>("users").findOne({ _id: new ObjectId(userId) });
    if (!user) {
      await clearAuthCookie("auth_me:user_not_found");
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    if (user.isBanned) {
      await clearAuthCookie("auth_me:user_banned");
      return NextResponse.json(
        { error: "banned", reason: user.banReason || "Violation of rules" },
        { status: 403 }
      );
    }
    if (
      user.authRevokedAt &&
      (typeof payload.iat !== "number" || user.authRevokedAt >= new Date(payload.iat * 1000))
    ) {
      await clearAuthCookie("auth_me:auth_revoked");
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    // Resolve admin status from JWT or DB (handles stale JWTs minted before isAdmin was added)
    const isAdmin = isAdminFromJwt || user?.isAdmin || user?.role === "admin";
    const isModerator = isAdmin || user?.role === "moderator";

    // Clear expired Patreon benefits inline — avoids 2 extra DB reads from clearExpiredPatreonBenefits
    if (
      user &&
      user.patreonTier &&
      !isPatreonActive(user.patreonTier, user.patreonExpiresAt ?? null)
    ) {
      await db.collection<User>("users").updateOne(
        { _id: user._id },
        {
          $set: {
            patreonTier: null,
            patreonExpiresAt: user.patreonExpiresAt ?? new Date(),
          },
          $unset: { patreonProfileBorder: "", patreonHighlightColor: "" },
        }
      );
      user = await db.collection<User>("users").findOne({ _id: user._id });
    }

    // Resolve active character — check if user is in imperial mode
    let isImperialMode = user?.activeCharacterType === "imperial";
    let character = null;
    let imperialCharacter: ImperialCharacter | null = null;

    if (isImperialMode && user?.activeImperialCharacterId) {
      imperialCharacter = await db
        .collection<ImperialCharacter>("imperialCharacters")
        .findOne({ _id: user.activeImperialCharacterId, userId: new ObjectId(userId) });

      // If the imperial character was deleted (e.g., by a game reset), clear the orphaned
      // reference and fall back to regular character mode.
      if (!imperialCharacter) {
        isImperialMode = false;
        db.collection<User>("users")
          .updateOne(
            { _id: new ObjectId(userId) },
            { $unset: { activeImperialCharacterId: "", activeCharacterType: "" } }
          )
          .catch(() => {});
      }
    }

    if (!isImperialMode || !imperialCharacter) {
      // Regular character resolution (existing behavior)
      const characterQuery = user?.activeCharacterId
        ? { _id: user.activeCharacterId, userId: new ObjectId(userId) }
        : { userId: new ObjectId(userId) };
      character = await db.collection<Character>("characters").findOne(characterQuery);
    }

    // Ensure persistent tracking cookie exists for anti-fraud duplicate detection
    const existingTrack = cookieStore.get("__ahd_track")?.value;
    const trackingId = existingTrack || randomUUID();
    if (!existingTrack) {
      cookieStore.set("__ahd_track", trackingId, await getTrackingCookieOptions());
    }

    // Update last activity timestamp and tracking ID (fire-and-forget for performance)
    db.collection("users")
      // `trackingIdAt` matters most here: this is the ONLY trackingId writer
      // with no `lastLogin` alongside it, so without the stamp an active
      // player's cookie would be dated by a login months old and expire under
      // the identity-signal cutoff (src/lib/auth/identitySignals.ts).
      .updateOne(
        { _id: new ObjectId(userId) },
        { $set: { lastActivity: new Date(), trackingId, trackingIdAt: new Date() } }
      )
      .catch(() => {
        /* ignore errors */
      });

    // Get home state name, party name, and unread count in parallel
    let homeStateName: string | undefined;
    let partyName: string | undefined;
    let unreadCount = 0;
    let unreadMailCount = 0;
    let notificationAccounts: { id: string; username: string; displayName: string }[] | undefined;

    const bundleIds =
      user && user._id
        ? getNotificationBundleUserIds({
            _id: user._id,
            notificationBundleUserIds: user.notificationBundleUserIds,
          })
        : [new ObjectId(userId)];

    if (bundleIds.length > 1) {
      const labelDocs = await db
        .collection<User>("users")
        .find({ _id: { $in: bundleIds } })
        .project<{ _id: ObjectId; username: string; displayName: string }>({
          username: 1,
          displayName: 1,
        })
        .toArray();
      const order = new Map(bundleIds.map((id, i) => [id.toString(), i]));
      labelDocs.sort(
        (a, b) => (order.get(a._id.toString()) ?? 0) - (order.get(b._id.toString()) ?? 0)
      );
      notificationAccounts = labelDocs.map((d) => ({
        id: d._id.toString(),
        username: d.username,
        displayName: d.displayName,
      }));
    }

    if (character) {
      const [state, party, unread, unreadMail] = await Promise.all([
        db
          .collection<State>("states")
          .findOne({ _id: character.homeState, countryId: character.countryId }),
        character.party && Number.isFinite(Number(character.party))
          ? db.collection<PoliticalParty>("politicalParties").findOne({
              sequentialId: Number(character.party),
              countryId: character.countryId,
            })
          : Promise.resolve(null),
        db.collection<Notification>("notifications").countDocuments({
          userId: { $in: bundleIds },
          read: false,
        }),
        db.collection("playerMail").countDocuments({
          toUserId: new ObjectId(userId),
          read: false,
          deletedByRecipient: false,
        }),
      ]);
      homeStateName = state?.name;
      partyName = party?.name;
      unreadCount = unread;
      unreadMailCount = unreadMail;
    } else {
      [unreadCount, unreadMailCount] = await Promise.all([
        db.collection<Notification>("notifications").countDocuments({
          userId: { $in: bundleIds },
          read: false,
        }),
        db.collection("playerMail").countDocuments({
          toUserId: new ObjectId(userId),
          read: false,
          deletedByRecipient: false,
        }),
      ]);
    }

    const forexEnabled = await isForexEnabled();
    const forexRates = forexEnabled ? await loadFxRatesRecord(db) : undefined;
    const rpgStatsEnabled = await isRpgStatsEnabled();
    const redistrictingEnabled = isRedistrictingEnabled(await getGameState(db));

    // Keep the character-creation hint cookie (read by middleware) in sync with
    // DB truth on every page load. This is the self-healer: a character lost to
    // reset, retirement, a game event, or an admin action redirects the player
    // back to /create-character on their next navigation without any per-route
    // wiring.
    await setCharacterGateCookie(
      cookieStore,
      needsCharacterHint({
        role: user?.role ?? "player",
        isAdmin: !!isAdmin,
        hasCharacter: !!character || !!imperialCharacter,
      })
    );

    return NextResponse.json(
      {
        user: {
          id: userId,
          username,
          email: user?.email ?? undefined,
          patreonTier: user?.patreonTier ?? null,
          supporterProvider: user?.supporterProvider ?? null,
          patreonExpiresAt: user?.patreonExpiresAt ?? null,
          patreonSince: user?.patreonSince ?? null,
          patreonUserId: user?.patreonUserId ?? null,
          adsDisabled: user?.adsDisabled ?? false,
          rpgStatsEnabled,
          redistrictingEnabled,
          patreonAdPreference: getPatreonAdPreference(user),
          patreonHighlightColor: user?.patreonHighlightColor ?? null,
          patreonProfileBorder: user?.patreonProfileBorder ?? null,
          isPatronActive:
            !!isAdmin || isPatreonActive(user?.patreonTier ?? null, user?.patreonExpiresAt ?? null),
          isAdmin: isAdmin || false,
          isModerator: isModerator || false,
          role: user?.role ?? "player",
          theme: user?.theme ?? undefined,
          statusBarLayout: user?.statusBarLayout ?? undefined,
          hasCharacter: !!character || !!imperialCharacter,
          isImperial: !!imperialCharacter && isImperialMode,
          forexEnabled,
          referralCount: user?.referralCount ?? 0,
          discordId: user?.discordId ?? undefined,
          discordUsername: user?.discordUsername ?? undefined,
          discordAvatar: user?.discordAvatar ?? undefined,
          googleId: user?.googleId ?? undefined,
          googleEmail: user?.googleEmail ?? undefined,
          googleName: user?.googleName ?? undefined,
          googleAvatar: user?.googleAvatar ?? undefined,
          hasPassword: !!user?.password,
          character: character
            ? {
                id: character._id.toString(),
                name: character.name,
                party: character.party,
                partyName,
                homeState: character.homeState,
                homeStateName,
                countryId: character.countryId,
                homeCurrency: getHomeCurrency(character),
                actions: character.actions,
                // Both fields now expose the LOCAL home-currency balance —
                // the canonical source of truth post-cf-inconsistency-fix.
                // `funds` is kept as an alias for older clients; new clients
                // should read `campaignFundsStored`.
                funds: character.currencyBalances?.campaign ?? character.funds ?? 0,
                campaignFundsStored: character.currencyBalances?.campaign ?? character.funds ?? 0,
                cashOnHand: getTotalPersonalLiquidWealth(character, forexEnabled, forexRates),
                nationalInfluence: character.nationalInfluence ?? 0,
                missingDemographics: !character.demographics,
                // RPG stats: expose the block and a grandfather flag so the
                // client can force the one-time allocation modal for characters
                // created before the stat system shipped.
                stats: character.stats ?? null,
                statsAllocated: character.statsAllocated ?? false,
                statsReallocationUsed: character.statsReallocationUsed ?? false,
                needsStatAllocation:
                  rpgStatsEnabled &&
                  !character.statsAllocated &&
                  !character.statAllocationDismissed,
                displayCurrencyPreference:
                  character.displayCurrencyPreference ?? (forexEnabled ? "local" : "internal"),
              }
            : undefined,
          imperialCharacter: imperialCharacter
            ? {
                id: imperialCharacter._id.toString(),
                name: imperialCharacter.name,
                title: getImperialTitle(imperialCharacter.countryId, imperialCharacter.gender),
                gender: imperialCharacter.gender,
                countryId: imperialCharacter.countryId,
                homeState: imperialCharacter.homeState,
                royalHouse: imperialCharacter.royalHouse,
                avatarUrl: imperialCharacter.avatarUrl,
                coatOfArmsUrl: imperialCharacter.coatOfArmsUrl,
                sequentialId: imperialCharacter.sequentialId,
                displayCurrencyPreference:
                  imperialCharacter.displayCurrencyPreference ??
                  (forexEnabled ? "local" : "internal"),
              }
            : undefined,
          unreadCount,
          unreadMailCount,
          ...(notificationAccounts ? { notificationAccounts } : {}),
        },
      },
      {
        headers: {
          // no-store, not a positive max-age: /api/auth/me carries per-user
          // unread counts and character-gate state that a CDN/browser must
          // never serve stale or cross-user (matches /api/character/me).
          "Cache-Control": "no-store, no-transform",
        },
      }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
