import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SignJWT, decodeJwt } from "jose";
import { ObjectId } from "mongodb";
import type { Db, Filter } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getAuthUser, getJwtSecret, getAuthCookieOptions, clearAuthCookie } from "@/lib/auth";
import { AUTH_COOKIE_NAME } from "@/lib/authCookieName";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCabinetOfficeNavEntry } from "@/lib/navigation/cabinetOfficeNavEntry";
import { resolveMyUnionNav } from "@/lib/navigation/resolveMyUnionNav";
import { formatElectionTypeLabel } from "@/lib/utils/electionLabels";
import type { CountryId } from "@/lib/constants/countries";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { isLabourFullMode } from "@/lib/labour/featureFlag";
import { getGameStateCollection } from "@/lib/db/collections";
import { isPatreonActive } from "@/lib/db/types";
import type {
  Campaign,
  Character,
  Election,
  ElectionCandidate,
  ImperialCharacter,
  Notification,
  PoliticalParty,
  State,
  User,
} from "@/lib/db/types";
import type { RetiredCharacter } from "@/lib/db/types/retiredCharacter";
import { isSeasonRecapEnabled } from "@/lib/recap/featureFlag";

/**
 * Whether to show the "Campaign Manager" navbar link. Returns true for: admins,
 * candidates in active presidential elections, campaign managers of active
 * presidential campaigns, or chair / vice chair / treasurer of a party with an
 * active presidential candidate. Hidden from everyone else (~99% of users) so
 * the link doesn't take up navbar space for people who'd hit a dead-end page.
 */
async function computeCanSeeCampaignManager(args: {
  db: Db;
  userId: string;
  isAdmin: boolean;
  characterCountryId: PoliticalParty["countryId"] | null;
  presidentElectionIds: ObjectId[];
}): Promise<boolean> {
  const { db, userId, isAdmin, characterCountryId, presidentElectionIds } = args;
  if (isAdmin) return true;
  if (presidentElectionIds.length === 0) return false;

  const userOid = new ObjectId(userId);
  const ownedChars = await db
    .collection<Character>("characters")
    .find({ userId: userOid })
    .project({ _id: 1 })
    .toArray();
  const ownedIds = ownedChars.map((c) => c._id);

  const userCampaignClauses: Filter<Campaign>[] = [{ managerId: userOid }];
  if (ownedIds.length > 0) userCampaignClauses.push({ candidateId: { $in: ownedIds } });

  const directCampaignMatch = await db.collection<Campaign>("campaigns").findOne(
    {
      electionId: { $in: presidentElectionIds },
      $or: userCampaignClauses,
    },
    { projection: { _id: 1 } }
  );
  if (directCampaignMatch) return true;

  if (ownedIds.length === 0 || !characterCountryId) return false;

  const campaignPartyIds = await db
    .collection<Campaign>("campaigns")
    .distinct("party", { electionId: { $in: presidentElectionIds } });
  const partySeqIds = [
    ...new Set(campaignPartyIds.map((party) => Number(party)).filter(Number.isFinite)),
  ];
  if (partySeqIds.length === 0) return false;

  const officerMatch = await db.collection<PoliticalParty>("politicalParties").findOne(
    {
      sequentialId: { $in: partySeqIds },
      countryId: characterCountryId,
      $or: [
        { chairId: { $in: ownedIds } },
        { viceChairId: { $in: ownedIds } },
        { treasurerId: { $in: ownedIds } },
      ],
    },
    { projection: { _id: 1 } }
  );
  return officerMatch !== null;
}

// GET /api/client-nav — Returns navbar essentials (auth, links, unread counts) in a single fast request.
// Status bar data (funds, corp, election stats) is served by /api/client-status.
// Auth: public (returns guest data if unauthenticated)
// Errors: (none)
export async function GET() {
  try {
    const db = await getDb();
    const cookieStore = await cookies();
    const rawToken = cookieStore.get(AUTH_COOKIE_NAME)?.value;

    // Start president election + game-state queries immediately — both needed regardless of auth state
    const presidentElectionPromise = db
      .collection<Election>("elections")
      .findOne(
        { electionType: "president", state: "US", status: { $in: ["active", "upcoming"] } },
        { projection: { _id: 1, seatId: 1 } }
      );
    /**
     * Is there a settlement crisis to LOOK at — the subsystem flag AND a live
     * crisis? The German Question is admin-started and can be closed again, so
     * the flag alone would leave the nav link standing over an empty board.
     * Short-circuited on the flag, so a world with the feature off pays nothing
     * and every other world pays one indexed lookup over a handful of rows.
     */
    const isSettlementCrisisLive = async (enabled: boolean | undefined) =>
      enabled === true &&
      (await db
        .collection("settlementCrises")
        .findOne({ status: { $in: ["open", "frozen"] } }, { projection: { _id: 1 } })) != null;

    const gameStatePromise = getGameStateCollection(db).then((col) =>
      col.findOne(
        { _id: "current" },
        {
          projection: {
            wikiDisabled: 1,
            rpgStatsEnabled: 1,
            conflictsEnabled: 1,
            settlementCrisisEnabled: 1,
            seasonRecapEnabled: 1,
          },
        }
      )
    );
    const authUser = await getAuthUser();

    if (!authUser) {
      if (rawToken) {
        await clearAuthCookie("client_nav:auth_user_null");
      }
      const [presidentElection, gameState] = await Promise.all([
        presidentElectionPromise,
        gameStatePromise,
      ]);
      return NextResponse.json(
        {
          user: null,
          hasCharacter: false,
          characterCountryId: null,
          characterName: null,
          unreadCount: 0,
          unreadMailCount: 0,
          myCorporationId: null,
          myUnionId: null,
          homeState: null,
          currentParty: null,
          activeElection: null,
          cabinetOffice: null,
          governorOffice: null,
          activePresidentElectionId: presidentElection ? presidentElection._id.toString() : null,
          activePresidentElectionSeatId: presidentElection?.seatId ?? null,
          missingDemographics: false,
          adminCharacters: null,
          imperialCharacter: null,
          isImperialMode: false,
          wikiDisabled: !!gameState?.wikiDisabled,
          conflictsEnabled: !!gameState?.conflictsEnabled,
          settlementCrisisLive: await isSettlementCrisisLive(gameState?.settlementCrisisEnabled),
          unionsEnabled: false,
          pendingCharterCount: 0,
          pendingSeasonRecapId: null,
        },
        { headers: { "Cache-Control": "private, max-age=5, no-transform" } }
      );
    }

    const userId = authUser.userId;
    const userOid = new ObjectId(userId);

    const [user, presidentElection, gameState, forexEnabled, unionsEnabled] = await Promise.all([
      db.collection<User>("users").findOne(
        { _id: userOid },
        {
          projection: {
            role: 1,
            isAdmin: 1,
            activeCharacterId: 1,
            activeCharacterType: 1,
            activeImperialCharacterId: 1,
            patreonAdPreference: 1,
            adsDisabled: 1,
            statusBarLayout: 1,
            enableExperimentalUI: 1,
            patreonTier: 1,
            patreonExpiresAt: 1,
            patreonProfileBorder: 1,
            patreonHighlightColor: 1,
          },
        }
      ),
      presidentElectionPromise,
      gameStatePromise,
      isForexEnabled(),
      isLabourFullMode(),
    ]);
    const wikiDisabled = !!gameState?.wikiDisabled;
    const rpgStatsEnabled = !!gameState?.rpgStatsEnabled;
    const conflictsEnabled = !!gameState?.conflictsEnabled;
    const settlementCrisisLive = await isSettlementCrisisLive(gameState?.settlementCrisisEnabled);

    if (!user) {
      if (rawToken) {
        await clearAuthCookie("client_nav:user_lookup_null");
      }
      return NextResponse.json(
        {
          user: null,
          hasCharacter: false,
          characterCountryId: null,
          characterName: null,
          unreadCount: 0,
          unreadMailCount: 0,
          myCorporationId: null,
          myUnionId: null,
          homeState: null,
          currentParty: null,
          activeElection: null,
          cabinetOffice: null,
          governorOffice: null,
          activePresidentElectionId: presidentElection ? presidentElection._id.toString() : null,
          activePresidentElectionSeatId: presidentElection?.seatId ?? null,
          missingDemographics: false,
          adminCharacters: null,
          imperialCharacter: null,
          isImperialMode: false,
          wikiDisabled,
          conflictsEnabled,
          settlementCrisisLive,
          unionsEnabled,
          pendingCharterCount: 0,
          pendingSeasonRecapId: null,
        },
        { headers: { "Cache-Control": "private, max-age=5, no-transform" } }
      );
    }

    const isImperialMode = user.activeCharacterType === "imperial";

    // Resolve character by activeCharacterId if set (admin multi-character), fallback to userId
    const characterQuery = user.activeCharacterId
      ? { _id: user.activeCharacterId, userId: userOid }
      : { userId: userOid };
    const character = await db.collection<Character>("characters").findOne(characterQuery, {
      projection: {
        _id: 1,
        actions: 1,
        countryId: 1,
        displayCurrencyPreference: 1,
        demographics: 1,
        funds: 1,
        homeState: 1,
        name: 1,
        party: 1,
        avatarUrl: 1,
        profileHeaderImageUrl: 1,
        statsAllocated: 1,
        unionLeaderOf: 1,
      },
    });

    // Fire-and-forget last activity update
    db.collection("users")
      .updateOne({ _id: userOid }, { $set: { lastActivity: new Date() } })
      .catch(() => {});

    let homeState: { id: string; name: string; countryId: string } | null = null;
    let currentParty: { id: string; name: string; countryId: string } | null = null;
    let activeElection: { id: string; seatId?: string; label: string } | null = null;
    let cabinetOffice: { positionId: string; positionName: string; countryCode: string } | null =
      null;
    let governorOffice: { stateId: string; stateName: string; countryCode: string } | null = null;
    let myCorporationId: number | null = null;
    let myCorporationType: string | null = null;
    let myCorporationCountryId: string | null = null;
    let myUnionId: string | null = null;
    let unreadCount = 0;
    let unreadMailCount = 0;
    let activeImperialCharacterForUser: {
      id: string;
      name: string;
      countryId: string;
      displayCurrencyPreference?: Character["displayCurrencyPreference"];
      avatarUrl?: string | null;
      profileHeaderImageUrl?: string | null;
      borderKey?: Character["borderKey"] | null;
      tintColor?: string | null;
    } | null = null;
    const missingDemographics = character ? !character.demographics : false;

    if (character) {
      const [stateDoc, partyDoc, unread, unreadMail, myCandidate, myCabinetMember, myCorporation] =
        await Promise.all([
          character.homeState
            ? db
                .collection<State>("states")
                .findOne({ _id: character.homeState }, { projection: { name: 1 } })
            : null,
          character.party && Number.isFinite(Number(character.party))
            ? db
                .collection<PoliticalParty>("politicalParties")
                .findOne(
                  { sequentialId: Number(character.party), countryId: character.countryId },
                  { projection: { name: 1, sequentialId: 1, countryId: 1 } }
                )
            : null,
          db.collection<Notification>("notifications").countDocuments({
            userId: userOid,
            read: false,
          }),
          db.collection("playerMail").countDocuments({
            toUserId: userOid,
            read: false,
            deletedByRecipient: false,
          }),
          db
            .collection<ElectionCandidate>("electionCandidates")
            .findOne(
              { characterId: character._id, status: "active" },
              { sort: { enteredAt: -1 }, projection: { electionId: 1 } }
            ),
          // Unified cabinetMembers covers every country's cabinet (US Senate-
          // confirmed and parliamentary/OPS direct-appointment alike).
          db
            .collection<{ positionId: string; countryId: string }>("cabinetMembers")
            .findOne(
              { characterId: character._id },
              { projection: { positionId: 1, countryId: 1 } }
            ),
          !isImperialMode
            ? db
                .collection<{
                  sequentialId?: number;
                  type?: string;
                  countryId?: string;
                }>("corporations")
                .findOne(
                  {
                    ceoId: character._id,
                    ceoVacant: { $ne: true },
                  },
                  { projection: { sequentialId: 1, type: 1, countryId: 1 } }
                )
            : Promise.resolve(null),
        ]);

      unreadCount = unread;
      unreadMailCount = unreadMail;
      myCorporationId = myCorporation?.sequentialId ?? null;
      myCorporationType = myCorporation?.type ?? null;
      myCorporationCountryId = myCorporation?.countryId ?? null;

      if (unionsEnabled && !isImperialMode) {
        const myUnion = await resolveMyUnionNav(db, character);
        myUnionId = myUnion?.id ?? null;
      }

      if (character.homeState && stateDoc) {
        homeState = {
          id: character.homeState,
          name: stateDoc.name,
          countryId: character.countryId ?? "US",
        };
      }

      if (character.party && partyDoc) {
        currentParty = {
          id: character.party,
          name: partyDoc.name,
          countryId: partyDoc.countryId ?? character.countryId ?? "US",
        };
      }

      cabinetOffice = resolveCabinetOfficeNavEntry(myCabinetMember);

      // Governor / Minister-President office lookup (strictly office-holder).
      if (character.countryId) {
        const { getRegionalExecutiveOfficeKey } = await import("@/lib/constants/countries");
        const officeRow = await db.collection<{ state: string }>("electedOfficials").findOne(
          {
            officeType: getRegionalExecutiveOfficeKey(character.countryId),
            characterId: character._id,
            countryId: character.countryId,
          },
          { projection: { state: 1 } }
        );
        if (officeRow) {
          const officeState = await db
            .collection<State>("states")
            .findOne({ _id: officeRow.state }, { projection: { name: 1 } });
          if (officeState) {
            governorOffice = {
              stateId: officeRow.state,
              stateName: officeState.name,
              countryCode: character.countryId.toLowerCase(),
            };
          }
        } else if (character.homeState && stateDoc) {
          // Not the holder anywhere — but the viewer may still manage their
          // home-state executive office as a party officer of an NPP-held office
          // (state Chair/Vice, or national Chair/Vice when the state party has
          // neither). Surface the nav link for that case too.
          const { resolveOfficeAccess } = await import("@/lib/governorOffice/access");
          const access = await resolveOfficeAccess(
            db,
            character.countryId,
            character.homeState,
            character._id
          );
          if (access.canManage) {
            governorOffice = {
              stateId: character.homeState,
              stateName: stateDoc.name,
              countryCode: character.countryId.toLowerCase(),
            };
          }
        }
      }

      if (myCandidate) {
        // Fetch the election doc for the link label — lightweight findOne, no vote tallies
        const election = await db.collection<Election>("elections").findOne(
          {
            _id: myCandidate.electionId,
            status: { $in: ["upcoming", "active", "completed"] },
          },
          { projection: { electionType: 1, seatId: 1, state: 1 } }
        );

        if (election) {
          // Governor electionType maps to different titles per (country, state):
          // US → Governor; UK SCO/WAL/NIR → First Minister; UK LON → Mayor of
          // London; JP regions → Governor; DE uses ministerPresident instead.
          let governorLabel = "Governor";
          if (election.electionType === "governor" && character.countryId) {
            const { getRegionalBillAssentTitleForState } =
              await import("@/lib/constants/countries");
            governorLabel = getRegionalBillAssentTitleForState(
              character.countryId,
              election.state ?? null
            );
          }
          const typeLabel =
            election.electionType === "governor"
              ? governorLabel
              : formatElectionTypeLabel(
                  election.electionType,
                  (election.countryId ?? character.countryId) as CountryId
                );

          const isNational = ["president", "primeMinister", "uachtaran"].includes(
            election.electionType
          );
          activeElection = {
            id: election._id.toString(),
            seatId: election.seatId ?? undefined,
            label: isNational ? `${typeLabel} — National` : `${typeLabel} — ${election.state}`,
          };
        }
      }
    }

    if (isImperialMode && user.activeImperialCharacterId) {
      const [activeImperialCharacterDoc, imperialCorporation] = await Promise.all([
        db.collection<ImperialCharacter>("imperialCharacters").findOne(
          { _id: user.activeImperialCharacterId, userId: userOid },
          {
            projection: {
              _id: 1,
              name: 1,
              countryId: 1,
              displayCurrencyPreference: 1,
              avatarUrl: 1,
              profileHeaderImageUrl: 1,
              borderKey: 1,
              tintColor: 1,
            },
          }
        ),
        db.collection<{ sequentialId?: number }>("corporations").findOne(
          {
            ceoId: user.activeImperialCharacterId,
            ceoType: "imperial",
            ceoVacant: { $ne: true },
          },
          { projection: { sequentialId: 1 } }
        ),
      ]);
      if (activeImperialCharacterDoc) {
        activeImperialCharacterForUser = {
          id: activeImperialCharacterDoc._id.toString(),
          name: activeImperialCharacterDoc.name,
          countryId: activeImperialCharacterDoc.countryId,
          displayCurrencyPreference:
            activeImperialCharacterDoc.displayCurrencyPreference ??
            (forexEnabled ? "local" : "internal"),
          avatarUrl: activeImperialCharacterDoc.avatarUrl ?? null,
          profileHeaderImageUrl: activeImperialCharacterDoc.profileHeaderImageUrl ?? null,
          borderKey: activeImperialCharacterDoc.borderKey ?? null,
          tintColor: activeImperialCharacterDoc.tintColor ?? null,
        };
      }
      myCorporationId = imperialCorporation?.sequentialId ?? null;
    }

    // Admin: character switcher + imperial mode
    let adminCharacters = null;
    let adminImperialCharacter: {
      id: string;
      name: string;
      countryId: string;
      royalHouse: string;
    } | null = null;
    if (user.isAdmin) {
      const [allChars, imperialChar] = await Promise.all([
        db
          .collection("characters")
          .find({ userId: userOid })
          .project({ _id: 1, name: 1, countryId: 1, party: 1 })
          .toArray(),
        user.activeImperialCharacterId
          ? db.collection<ImperialCharacter>("imperialCharacters").findOne(
              { _id: user.activeImperialCharacterId },
              {
                projection: {
                  name: 1,
                  countryId: 1,
                  royalHouse: 1,
                  sequentialId: 1,
                  homeState: 1,
                },
              }
            )
          : null,
      ]);

      if (imperialChar) {
        adminImperialCharacter = {
          id: (imperialChar.sequentialId ?? imperialChar._id).toString(),
          name: imperialChar.name,
          countryId: imperialChar.countryId,
          royalHouse: imperialChar.royalHouse,
        };
      }

      // Override homeState with imperial character's home state when in imperial mode
      if (isImperialMode && imperialChar?.homeState) {
        const imperialStateDoc = await db
          .collection<State>("states")
          .findOne({ _id: imperialChar.homeState }, { projection: { name: 1 } });
        if (imperialStateDoc) {
          homeState = {
            id: imperialChar.homeState,
            name: imperialStateDoc.name,
            countryId: imperialChar.countryId,
          };
        }
      }

      if (allChars.length > 1 || imperialChar) {
        adminCharacters = allChars.map((c) => ({
          id: c._id.toString(),
          name: c.name,
          countryId: c.countryId,
          party: c.party,
          isActive: !isImperialMode && character ? c._id.equals(character._id) : false,
        }));
      }
    }

    // Silent token refresh — mint a new JWT when the current one is within 1 day of expiry.
    try {
      if (rawToken) {
        const claims = decodeJwt(rawToken);
        const oneDay = 60 * 60 * 24;
        if (claims.exp && claims.exp - Math.floor(Date.now() / 1000) < oneDay) {
          const freshToken = await new SignJWT({
            userId: authUser.userId,
            email: authUser.email,
            username: authUser.username,
            role: authUser.role,
            isAdmin: authUser.isAdmin ?? false,
          })
            .setProtectedHeader({ alg: "HS256" })
            .setIssuedAt()
            .setExpirationTime("7d")
            .sign(getJwtSecret());
          cookieStore.set(AUTH_COOKIE_NAME, freshToken, await getAuthCookieOptions());
        }
      }
    } catch {
      // Non-critical — if refresh fails, the user still has their current token
    }

    const canSeeCampaignManager = await computeCanSeeCampaignManager({
      db,
      userId,
      isAdmin: authUser.isAdmin ?? false,
      characterCountryId: character?.countryId ?? null,
      presidentElectionIds: presidentElection ? [presidentElection._id] : [],
    });

    // Count actionable charters bound to any of the caller's characters
    // (Phase 6). Drives the "My Party Charters" entry in the Nation
    // dropdown — hidden when 0. We count only `pending-signatures` and
    // `founder-replacement` because those are the states a founder can
    // act on; ratified / migrated / migrated-incomplete charters live
    // behind the party page itself rather than the charter list.
    let pendingCharterCount = 0;
    const ownedCharacters = await db
      .collection<Character>("characters")
      .find({ userId: userOid })
      .project<{ _id: ObjectId }>({ _id: 1 })
      .toArray();
    if (ownedCharacters.length > 0) {
      pendingCharterCount = await db.collection("partyCharters").countDocuments({
        foundersCharacterIds: { $in: ownedCharacters.map((c) => c._id) },
        status: { $in: ["pending-signatures", "founder-replacement"] },
      });
    }

    // Post-reset / post-retirement Season Recap ("Wrapped"): surface the newest
    // unviewed recap for character-less sessions (the state right after a reset
    // or a retirement). Gated on the flag AND only queried when the viewer has
    // no active character, keeping this hot path cheap for the ~99% who do.
    // Re-viewing older recaps happens in character history, not here.
    let pendingSeasonRecapId: string | null = null;
    if (isSeasonRecapEnabled(gameState) && !character) {
      const pendingRecap = await db
        .collection<RetiredCharacter>("retiredCharacters")
        .findOne(
          { userId: userOid, recap: { $exists: true }, recapViewedAt: { $exists: false } },
          { sort: { retiredAt: -1 }, projection: { _id: 1 } }
        );
      pendingSeasonRecapId = pendingRecap?._id.toString() ?? null;
    }

    return NextResponse.json(
      {
        user: {
          id: userId,
          username: authUser.username,
          isAdmin: authUser.isAdmin ?? false,
          isModerator:
            (authUser.isAdmin ?? false) || user.role === "moderator" || user.role === "admin",
          forexEnabled,
          rpgStatsEnabled,
          canSeeCampaignManager,
          patreonAdPreference:
            user.patreonAdPreference ?? (user.adsDisabled ? "ad-free" : "all-ads"),
          statusBarLayout: user.statusBarLayout ?? null,
          // New interface is the default; only an explicit opt-out (false) is classic.
          enableExperimentalUI: user.enableExperimentalUI !== false,
          patreonTier: user.patreonTier ?? null,
          isPatronActive: isPatreonActive(user.patreonTier ?? null, user.patreonExpiresAt ?? null),
          imperialCharacter: activeImperialCharacterForUser,
          character: character
            ? {
                id: character._id.toString(),
                name: character.name,
                countryId: character.countryId,
                party: character.party,
                avatarUrl: character.avatarUrl ?? null,
                profileHeaderImageUrl: character.profileHeaderImageUrl ?? null,
                borderKey: user.patreonProfileBorder ?? null,
                tintColor: user.patreonHighlightColor ?? null,
                displayCurrencyPreference:
                  character.displayCurrencyPreference ?? (forexEnabled ? "local" : "internal"),
                // Grandfather flag: drives the blocking stat-allocation modal.
                // Gated behind the RPG-stats feature flag.
                needsStatAllocation: rpgStatsEnabled && !character.statsAllocated,
              }
            : null,
        },
        hasCharacter: !!character || (isImperialMode && !!activeImperialCharacterForUser),
        characterCountryId:
          (isImperialMode && activeImperialCharacterForUser?.countryId) ||
          (character?.countryId ?? null),
        characterName:
          (isImperialMode && activeImperialCharacterForUser?.name) || (character?.name ?? null),
        unreadCount,
        unreadMailCount,
        myCorporationId,
        myCorporationType,
        myCorporationCountryId,
        myUnionId,
        funds: character?.funds ?? null,
        actions: character?.actions ?? null,
        homeState,
        currentParty,
        activeElection,
        cabinetOffice,
        governorOffice,
        activePresidentElectionId: presidentElection ? presidentElection._id.toString() : null,
        activePresidentElectionSeatId: presidentElection?.seatId ?? null,
        missingDemographics,
        adminCharacters,
        imperialCharacter: adminImperialCharacter,
        isImperialMode,
        wikiDisabled,
        conflictsEnabled,
        settlementCrisisLive,
        unionsEnabled,
        pendingCharterCount,
        pendingSeasonRecapId,
      },
      { headers: { "Cache-Control": "private, max-age=5, no-transform" } }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
