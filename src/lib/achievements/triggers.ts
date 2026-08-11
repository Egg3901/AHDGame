/**
 * Trigger-based achievement checks. Called from various API/turn handlers.
 * All are non-blocking; errors are logged and swallowed.
 *
 * Each trigger accepts userId + characterId. The userId is used as the
 * primary FK for the achievement record; characterId provides historical context.
 */
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { ActionType } from "@/lib/db/types/gameState";
import { awardAchievement, awardAchievements } from "./index";

export async function checkActionAchievements(
  userId: ObjectId,
  characterId: ObjectId,
  actionType: ActionType,
  currentTurn?: number
): Promise<void> {
  try {
    const db = await getDb();

    const [actionCounts, totalActionCount] = await Promise.all([
      db
        .collection("actionLogs")
        .aggregate<{ _id: string; count: number }>([
          { $match: { characterId, actionType } },
          { $group: { _id: "$actionType", count: { $sum: 1 } } },
        ])
        .toArray(),
      db.collection("actionLogs").countDocuments({ characterId }),
    ]);

    const countForType = actionCounts.find((a) => a._id === actionType)?.count ?? 0;

    const checks: Array<{ slug: string; required: number }> = [];
    if (actionType === "fundraise") {
      if (countForType >= 1) checks.push({ slug: "first_fundraise", required: 1 });
      if (countForType >= 10) checks.push({ slug: "fundraiser", required: 10 });
      if (countForType >= 50) checks.push({ slug: "big_fundraiser", required: 50 });
    } else if (actionType === "campaign") {
      if (countForType >= 10) checks.push({ slug: "campaigner", required: 10 });
    } else if (actionType === "buildDonorBase") {
      if (countForType >= 5) checks.push({ slug: "grassroots", required: 5 });
    } else if (actionType === "advertise") {
      if (countForType >= 3) checks.push({ slug: "advertiser", required: 3 });
    } else if (actionType === "rest") {
      if (countForType >= 1) checks.push({ slug: "rested", required: 1 });
    } else if (actionType === "poll" || actionType === "pollLarge") {
      const pollCount = await db
        .collection("actionLogs")
        .countDocuments({ characterId, actionType: { $in: ["poll", "pollLarge"] } });
      if (pollCount >= 5) checks.push({ slug: "pollster", required: 5 });
    }
    if (totalActionCount >= 100) checks.push({ slug: "century_club", required: 100 });
    if (currentTurn !== undefined && currentTurn <= 1) {
      checks.push({ slug: "turn_one", required: 1 });
    }
    if (new Date().getHours() === 0) checks.push({ slug: "night_shift", required: 1 });

    await awardAchievements(
      userId,
      checks.map((c) => c.slug),
      characterId
    );
  } catch (error) {
    console.error("[achievements] checkActionAchievements error:", error);
  }
}

export async function checkPassiveProfileAchievements(
  userId: ObjectId,
  characterId: ObjectId,
  facts: {
    iteration?: { type: string; number: number } | null;
    hasCeoCorp: boolean;
    hasCabinetSeat: boolean;
    hasCentralBankChair: boolean;
    isPartyChair: boolean;
    hasElectedOffice: boolean;
    bondIncomePerTurn: number;
    dividendIncomePerTurn: number;
    characterCreatedAt: Date;
    statsAllocated: boolean;
    onboardingComplete: boolean;
    hallOfFameTop10: boolean;
  }
): Promise<void> {
  try {
    const slugs: string[] = [];
    if (facts.iteration?.type === "Iteration" && facts.iteration.number === 1) {
      slugs.push("iteration4_founder");
    }
    if (facts.hasCeoCorp) slugs.push("corner_office");
    if (facts.hasCabinetSeat) slugs.push("cabinet_seat");
    if (facts.hasCentralBankChair) slugs.push("central_banker");
    if (facts.bondIncomePerTurn > 0) slugs.push("bondholder");
    if (facts.dividendIncomePerTurn > 0) slugs.push("dividend_day");
    if (Date.now() - facts.characterCreatedAt.getTime() >= 30 * 24 * 60 * 60 * 1000) {
      slugs.push("elder_statesman");
    }
    if (facts.statsAllocated) slugs.push("built_different");
    if (facts.onboardingComplete) slugs.push("onboarded");
    if (facts.hallOfFameTop10) slugs.push("hall_of_famer");
    if (facts.hasElectedOffice && facts.hasCabinetSeat && facts.isPartyChair) {
      slugs.push("iron_triangle");
    }
    await awardAchievements(userId, slugs, characterId);
  } catch (error) {
    console.error("[achievements] checkPassiveProfileAchievements error:", error);
  }
}

export async function checkElectionEntryAchievements(
  userId: ObjectId,
  characterId: ObjectId,
  election: { electionType: string }
): Promise<void> {
  try {
    const db = await getDb();
    const slugs: string[] = [];

    const totalCandidacies = await db
      .collection("electionCandidates")
      .countDocuments({ characterId });
    if (totalCandidacies >= 1) slugs.push("first_candidate");

    const typeSlugs: Record<string, string> = {
      house: "house_candidate",
      senate: "senate_candidate",
      governor: "governor_candidate",
      president: "president_candidate",
    };
    const slug = typeSlugs[election.electionType];
    if (slug) slugs.push(slug);

    await awardAchievements(userId, slugs, characterId);
  } catch (error) {
    console.error("[achievements] checkElectionEntryAchievements error:", error);
  }
}

export async function checkElectionWinAchievements(
  userId: ObjectId,
  characterId: ObjectId,
  electionType: string
): Promise<void> {
  try {
    const slugs: string[] = [];

    const typeSlugs: Record<string, string> = {
      house: "house_member",
      senate: "senator",
      governor: "governor",
      stateSenate: "state_senator",
    };
    const slug = typeSlugs[electionType];
    if (slug) slugs.push(slug);

    const db = await getDb();
    const wins = await db.collection("electedOfficials").countDocuments({ characterId });
    if (wins >= 3) slugs.push("three_terms");

    await awardAchievements(userId, slugs, characterId);
  } catch (error) {
    console.error("[achievements] checkElectionWinAchievements error:", error);
  }
}

export async function checkOfficeHeldAchievements(
  userId: ObjectId,
  characterId: ObjectId,
  officeType: string
): Promise<void> {
  try {
    const slugs: string[] = [];
    if (officeType === "president") slugs.push("president");
    if (officeType === "vicePresident") slugs.push("vice_president");
    await awardAchievements(userId, slugs, characterId);
  } catch (error) {
    console.error("[achievements] checkOfficeHeldAchievements error:", error);
  }
}

export async function checkInfluenceAchievements(
  userId: ObjectId,
  characterId: ObjectId
): Promise<void> {
  try {
    const db = await getDb();
    const [influenceCount, barnstormCount] = await Promise.all([
      db.collection("actionLogs").countDocuments({
        characterId,
        actionType: { $in: ["supportPlayer", "attackPlayer", "barnstorm"] },
      }),
      db.collection("actionLogs").countDocuments({ characterId, actionType: "barnstorm" }),
    ]);

    const slugs: string[] = [];
    if (influenceCount >= 5) slugs.push("influencer");
    if (barnstormCount >= 1) slugs.push("barnstormer");
    await awardAchievements(userId, slugs, characterId);
  } catch (error) {
    console.error("[achievements] checkInfluenceAchievements error:", error);
  }
}

export async function checkSubscriberAchievements(
  userId: ObjectId,
  characterId: ObjectId
): Promise<void> {
  try {
    const db = await getDb();
    const count = await db
      .collection("userSubscriptions")
      .countDocuments({ subscribedToCharacterId: characterId });
    const slugs: string[] = [];
    if (count >= 5) slugs.push("popular");
    if (count >= 20) slugs.push("celebrity");
    await awardAchievements(userId, slugs, characterId);
  } catch (error) {
    console.error("[achievements] checkSubscriberAchievements error:", error);
  }
}

export async function checkFundsAchievements(
  userId: ObjectId,
  characterId: ObjectId,
  funds: number
): Promise<void> {
  try {
    if (funds >= 1_000_000) await awardAchievement(userId, "millionaire", characterId);
  } catch (error) {
    console.error("[achievements] checkFundsAchievements error:", error);
  }
}

export async function checkBillSponsoredAchievements(
  userId: ObjectId,
  characterId: ObjectId
): Promise<void> {
  try {
    const db = await getDb();
    const count = await db.collection("bills").countDocuments({ sponsorId: characterId });
    if (count >= 1) await awardAchievement(userId, "first_bill", characterId);
  } catch (error) {
    console.error("[achievements] checkBillSponsoredAchievements error:", error);
  }
}

export async function checkNewsPostAchievements(
  userId: ObjectId,
  characterId: ObjectId
): Promise<void> {
  try {
    const db = await getDb();
    const count = await db
      .collection("newsPosts")
      .countDocuments({ authorId: characterId, parentId: null });
    if (count >= 1) await awardAchievement(userId, "first_post", characterId);
  } catch (error) {
    console.error("[achievements] checkNewsPostAchievements error:", error);
  }
}

export async function checkNewsReplyAchievements(
  userId: ObjectId,
  characterId: ObjectId
): Promise<void> {
  try {
    const db = await getDb();
    const count = await db
      .collection("newsPosts")
      .countDocuments({ authorId: characterId, parentId: { $ne: null } });
    if (count >= 5) await awardAchievement(userId, "commenter", characterId);
  } catch (error) {
    console.error("[achievements] checkNewsReplyAchievements error:", error);
  }
}
