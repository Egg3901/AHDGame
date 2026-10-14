import { liquidBalancesAnchor, personalDebtAnchor } from "./rules/netWorth";
import { computeCareerScore, CAREER_SCORE_VERSION } from "./rules/careerScore";
import { loadCareerLegislation, loadCareerContests, loadCareerLoans } from "./careerEvidence";
import { ObjectId, type Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Character, ExchangeRate } from "@/lib/db/types";
import type { Corporation } from "@/lib/db/types/corporation";
import type { Bond } from "@/lib/db/types/bond";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import type { IndexFund, IndexFundPosition } from "@/lib/db/types/indexFund";
import type { RetiredCharacter } from "@/lib/db/types/retiredCharacter";
import type { GameIteration } from "@/lib/db/types/gameState";
import { getGameState } from "@/lib/gameState";
import { iterationLabel } from "@/lib/wiki/officeIteration";
import { deriveHighestOffice, deriveHighestOfficeRank } from "@/lib/character/deriveHighestOffice";
import { getHomeCurrency } from "@/lib/currency/characterFunds";
import {
  loadValuationFxRates,
  fxRateForCorpFromMap,
  shareTradeAnchorValue,
  corpCapitalToAnchor,
} from "@/lib/currency/corporationCapital";
import { fetchExchangeRateMap, getRateDoc, toInternalAmount } from "./forex";
import type {
  LegacyLeaderboardData,
  LegacyLeaderboardEntry,
  LegacyLeaderboardScope,
  LegacyLifeOption,
  LegacyNetWorthBreakdown,
  LegacyRankBy,
  LegacyScoreBreakdown,
} from "./legacyLeaderboardTypes";

function sameIteration(a: GameIteration | null, b: GameIteration | null): boolean {
  if (!a || !b) return false;
  return a.type === b.type && a.number === b.number;
}

interface Life {
  characterId: string;
  userId: string;
  name: string;
  countryId: CountryId;
  homeState: string;
  score: number;
  scoreBreakdown: LegacyScoreBreakdown;
  netWorth: number;
  netWorthBreakdown: LegacyNetWorthBreakdown;
  nationalInfluence: number;
  partyInfluence: number;
  achievementCount: number;
  highestOffice: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  iteration: GameIteration | null;
  retiredAt: Date | null;
  enactedBills: number;
  contestWins: number;
  contestPodiums: number;
}

interface NetWorthInputs {
  cashOnHandLocal: number;
  savingsLocal: number;
  /** Already anchor-converted — computed once per corp/bond/fund, not per life. */
  shareValueAnchor: number;
  bondValueAnchor: number;
  indexFundValueAnchor: number;
  countryId: CountryId;
}

/**
 * Net worth = personal wealth + savings + held corp shares + held bonds +
 * held index-fund positions, forex-normalized to internal units. Read at
 * retirement time for retired lives / current balance for active ones — NOT
 * a true per-turn historical peak, which would need a separate time-series
 * scan this leaderboard doesn't do. Unlike the score's wealth term, this is
 * NOT clamped at 0 — real debt should show as real negative net worth here,
 * there's no log() to protect against.
 */
function computeNetWorth(
  inputs: NetWorthInputs,
  rateMap: Map<string, ExchangeRate>
): { total: number; breakdown: LegacyNetWorthBreakdown } {
  const rateDoc = getRateDoc(rateMap, inputs.countryId);
  const breakdown: LegacyNetWorthBreakdown = {
    personal: toInternalAmount(inputs.cashOnHandLocal, rateDoc),
    savings: toInternalAmount(inputs.savingsLocal, rateDoc),
    shares: inputs.shareValueAnchor,
    bonds: inputs.bondValueAnchor,
    indexFunds: inputs.indexFundValueAnchor,
    debt: 0,
  };
  const total =
    breakdown.personal +
    breakdown.savings +
    breakdown.shares +
    breakdown.bonds +
    breakdown.indexFunds;
  return { total, breakdown };
}

/** Recalculate careers from retained evidence on every read. Best life plus account achievements,
 * rather than summing disposable characters. Politics, business, legislation, contests and
 * earned gameplay achievements each contribute at most 1,000 points. */
export async function getLegacyLeaderboardData(
  db: Db,
  authUser: { userId: string } | null,
  opts?: { scope?: LegacyLeaderboardScope; rankBy?: LegacyRankBy }
): Promise<LegacyLeaderboardData> {
  const scope = opts?.scope ?? "all";
  const rankBy = opts?.rankBy ?? "legacy";
  const gameState = await getGameState(db);
  const currentIteration = gameState?.iteration ?? null;

  const [
    activeCharacters,
    retired,
    achievementCounts,
    rateMap,
    fxByCurrency,
    corporations,
    bonds,
    fundPositions,
    legislationByCharacter,
    contestsByCharacter,
    loans,
  ] = await Promise.all([
    db
      .collection<Character>("characters")
      .find(
        { userId: { $exists: true }, isSynthetic: { $ne: true } },
        {
          projection: {
            userId: 1,
            name: 1,
            countryId: 1,
            homeState: 1,
            nationalInfluence: 1,
            partyInfluence: 1,
            infamy: 1,
            currentOffice: 1,
            careerHistory: 1,
            currencyBalances: 1,
            cashOnHand: 1,
            savingsOnHand: 1,
            avatarUrl: 1,
          },
        }
      )
      .toArray(),
    db
      .collection<RetiredCharacter>("retiredCharacters")
      .find(
        {},
        {
          projection: {
            userId: 1,
            characterId: 1,
            retiredAt: 1,
            iteration: 1,
            "snapshot.name": 1,
            "snapshot.countryId": 1,
            "snapshot.homeState": 1,
            "snapshot.stats": 1,
            "snapshot.achievementCount": 1,
            "snapshot.currentOffice": 1,
            "snapshot.careerHistory": 1,
            "snapshot.avatarUrl": 1,
          },
        }
      )
      .toArray(),
    db
      .collection("characterAchievements")
      .aggregate<{ _id: unknown; count: number }>([
        {
          $lookup: {
            from: "achievements",
            localField: "achievementId",
            foreignField: "_id",
            as: "definition",
          },
        },
        { $unwind: "$definition" },
        { $match: { grantedBy: { $exists: false } } },
        {
          $match: {
            "definition.category": { $ne: "special" },
            "definition.triggerType": { $ne: "manual_only" },
          },
        },
        { $group: { _id: { user: "$userId", achievement: "$achievementId" } } },
        { $group: { _id: "$_id.user", count: { $sum: 1 } } },
      ])
      .toArray(),
    fetchExchangeRateMap(db),
    loadValuationFxRates(db),
    db
      .collection<Corporation>("corporations")
      .find(
        { "shareholders.0": { $exists: true } },
        { projection: { _id: 1, shareholders: 1, sharePrice: 1, liquidCurrencyCode: 1 } }
      )
      .toArray(),
    db
      .collection<Bond>("bonds")
      .find(
        { "holders.0": { $exists: true } },
        { projection: { _id: 1, holders: 1, marketPrice: 1, currencyCode: 1 } }
      )
      .toArray(),
    db
      .collection<IndexFundPosition>("indexFundPositions")
      .find({ holderKind: "character" }, { projection: { fundId: 1, characterId: 1, units: 1 } })
      .toArray(),
    loadCareerLegislation(db),
    loadCareerContests(db),
    loadCareerLoans(db),
  ]);

  // Active-character net worth: shares/bonds/fund positions valued live and
  // grouped by characterId, anchor-converted once per holding (not per life).
  const shareValueByCharacter = new Map<string, number>();
  for (const corp of corporations) {
    const fxRate = fxRateForCorpFromMap(corp, fxByCurrency);
    for (const holder of corp.shareholders ?? []) {
      if (!holder.characterId || (holder.shares ?? 0) <= 0) continue;
      const key = holder.characterId.toString();
      const value = shareTradeAnchorValue(holder.shares, corp, fxRate);
      shareValueByCharacter.set(key, (shareValueByCharacter.get(key) ?? 0) + value);
    }
  }

  const bondValueByCharacter = new Map<string, number>();
  for (const bond of bonds) {
    const fxRate = bond.currencyCode ? (fxByCurrency.get(bond.currencyCode) ?? 1) : 1;
    for (const holder of bond.holders ?? []) {
      if (!holder.characterId || (holder.units ?? 0) <= 0) continue;
      const key = holder.characterId.toString();
      const localValue = holder.units * BOND_UNIT_FACE_VALUE * (bond.marketPrice ?? 1);
      const value = corpCapitalToAnchor(localValue, bond.currencyCode, fxRate);
      bondValueByCharacter.set(key, (bondValueByCharacter.get(key) ?? 0) + value);
    }
  }

  const indexFundValueByCharacter = new Map<string, number>();
  if (fundPositions.length > 0) {
    const fundIds = [
      ...new Map(fundPositions.map((p) => [p.fundId.toString(), p.fundId])).values(),
    ];
    const funds = await db
      .collection<IndexFund>("indexFunds")
      .find({ _id: { $in: fundIds } }, { projection: { _id: 1, quotedNav: 1 } })
      .toArray();
    const navByFund = new Map(funds.map((f) => [f._id.toString(), f.quotedNav]));
    for (const pos of fundPositions) {
      if (!pos.characterId || (pos.units ?? 0) <= 0) continue;
      const key = pos.characterId.toString();
      const value = pos.units * (navByFund.get(pos.fundId.toString()) ?? 0);
      indexFundValueByCharacter.set(key, (indexFundValueByCharacter.get(key) ?? 0) + value);
    }
  }

  // Only fetch the users actually referenced by a life — not the whole
  // `users` collection, which can be far larger than characters+retired.
  const referencedUserIds = new Map<string, ObjectId>();
  for (const c of activeCharacters) referencedUserIds.set(String(c.userId), c.userId);
  for (const r of retired) referencedUserIds.set(String(r.userId), r.userId);

  const users = await db
    .collection<{ _id: ObjectId; isBanned?: boolean; legacyDisplayCharacterId?: string }>("users")
    .find(
      { _id: { $in: [...referencedUserIds.values()] } },
      { projection: { isBanned: 1, legacyDisplayCharacterId: 1 } }
    )
    .toArray();

  const bannedUserIds = new Set(users.filter((u) => u.isBanned).map((u) => String(u._id)));
  const preferenceByUser = new Map(
    users.map((u) => [String(u._id), u.legacyDisplayCharacterId ?? null])
  );
  const achievementCountByUser = new Map(achievementCounts.map((a) => [String(a._id), a.count]));

  const debts = personalDebtAnchor(
    loans.flatMap((loan) =>
      loan.borrowerId
        ? [
            {
              borrowerId: loan.borrowerId.toString(),
              currency: loan.currency,
              outstanding: loan.outstanding,
            },
          ]
        : []
    ),
    fxByCurrency
  );
  const livesByUser = new Map<string, Life[]>();
  const pushLife = (life: Life) => {
    if (bannedUserIds.has(life.userId)) return;
    const existing = livesByUser.get(life.userId);
    if (existing) existing.push(life);
    else livesByUser.set(life.userId, [life]);
  };

  for (const c of activeCharacters) {
    const achievementCount = achievementCountByUser.get(String(c.userId)) ?? 0;
    const cashOnHandLocal = c.currencyBalances?.personal?.[getHomeCurrency(c)] ?? c.cashOnHand ?? 0;
    const savingsLocal = c.currencyBalances?.savings?.[getHomeCurrency(c)] ?? c.savingsOnHand ?? 0;
    const characterIdStr = String(c._id);
    const { breakdown: netWorthBreakdown } = computeNetWorth(
      {
        cashOnHandLocal,
        savingsLocal,
        shareValueAnchor: shareValueByCharacter.get(characterIdStr) ?? 0,
        bondValueAnchor: bondValueByCharacter.get(characterIdStr) ?? 0,
        indexFundValueAnchor: indexFundValueByCharacter.get(characterIdStr) ?? 0,
        countryId: c.countryId,
      },
      rateMap
    );

    const liquid = liquidBalancesAnchor({
      homeCurrency: getHomeCurrency(c),
      personal: c.currencyBalances?.personal,
      savings: c.currencyBalances?.savings,
      legacyPersonal: c.cashOnHand ?? 0,
      legacySavings: c.savingsOnHand ?? 0,
      rates: fxByCurrency,
    });
    netWorthBreakdown.personal = liquid.personal;
    netWorthBreakdown.savings = liquid.savings;
    netWorthBreakdown.debt = -(debts.get(characterIdStr) ?? 0) || 0;
    const netWorth = Object.values(netWorthBreakdown).reduce((sum, amount) => sum + amount, 0);
    const enactedBills = legislationByCharacter.get(characterIdStr) ?? 0;
    const contests = contestsByCharacter.get(characterIdStr) ?? { wins: 0, podiums: 0 };
    const { total: score, breakdown: scoreBreakdown } = computeCareerScore({
      nationalInfluence: c.nationalInfluence ?? 0,
      partyInfluence: c.partyInfluence ?? 0,
      achievementCount,
      highestOfficeRank: deriveHighestOfficeRank(c),
      infamy: c.infamy ?? 0,
      netWorthAnchor: netWorth,
      enactedBills,
      contestWins: contests.wins,
      contestPodiums: contests.podiums,
    });

    pushLife({
      enactedBills,
      contestWins: contests.wins,
      contestPodiums: contests.podiums,
      characterId: characterIdStr,
      userId: String(c.userId),
      name: c.name,
      countryId: c.countryId,
      homeState: c.homeState,
      nationalInfluence: c.nationalInfluence ?? 0,
      partyInfluence: c.partyInfluence ?? 0,
      achievementCount,
      highestOffice: deriveHighestOffice(c) ?? null,
      avatarUrl: c.avatarUrl ?? null,
      isActive: true,
      iteration: currentIteration,
      retiredAt: null,
      score,
      scoreBreakdown,
      netWorth,
      netWorthBreakdown,
    });
  }

  for (const r of retired) {
    const officeSource = {
      careerHistory: r.snapshot.careerHistory,
      currentOffice: r.snapshot.currentOffice,
    };
    const { breakdown: netWorthBreakdown } = computeNetWorth(
      {
        cashOnHandLocal: r.snapshot.stats.cashOnHand ?? 0,
        savingsLocal: r.snapshot.stats.savingsOnHand ?? 0,
        // 0 for snapshots taken before these fields existed — that value was
        // already released (shares/bonds/funds returned to float) with no
        // record by the time the field was added, unrecoverable.
        shareValueAnchor: r.snapshot.stats.shareValueAnchor ?? 0,
        bondValueAnchor: r.snapshot.stats.bondValueAnchor ?? 0,
        indexFundValueAnchor: r.snapshot.stats.indexFundValueAnchor ?? 0,
        countryId: r.snapshot.countryId,
      },
      rateMap
    );

    // New snapshots freeze forex at retirement; old snapshots retain their available balances.
    if (r.snapshot.stats.cashValueAnchor !== undefined)
      netWorthBreakdown.personal = r.snapshot.stats.cashValueAnchor;
    if (r.snapshot.stats.savingsValueAnchor !== undefined)
      netWorthBreakdown.savings = r.snapshot.stats.savingsValueAnchor;
    netWorthBreakdown.debt =
      -(r.snapshot.stats.debtValueAnchor ?? debts.get(String(r.characterId)) ?? 0) || 0;
    const frozenNetWorth = Object.values(netWorthBreakdown).reduce(
      (sum, amount) => sum + amount,
      0
    );
    const enactedBills = Math.max(
      r.snapshot.stats.enactedBills ?? 0,
      legislationByCharacter.get(String(r.characterId)) ?? 0
    );
    const contests = contestsByCharacter.get(String(r.characterId)) ?? { wins: 0, podiums: 0 };
    const achievementCount = achievementCountByUser.get(String(r.userId)) ?? 0;
    const { total: score, breakdown: scoreBreakdown } = computeCareerScore({
      nationalInfluence: r.snapshot.stats.nationalInfluence ?? 0,
      partyInfluence: r.snapshot.stats.partyInfluence ?? 0,
      achievementCount,
      highestOfficeRank: deriveHighestOfficeRank(officeSource),
      infamy: r.snapshot.stats.infamy ?? 0,
      netWorthAnchor: frozenNetWorth,
      enactedBills,
      contestWins: contests.wins,
      contestPodiums: contests.podiums,
    });

    pushLife({
      enactedBills,
      contestWins: contests.wins,
      contestPodiums: contests.podiums,
      characterId: String(r.characterId),
      userId: String(r.userId),
      name: r.snapshot.name,
      countryId: r.snapshot.countryId,
      homeState: r.snapshot.homeState,
      nationalInfluence: r.snapshot.stats.nationalInfluence ?? 0,
      partyInfluence: r.snapshot.stats.partyInfluence ?? 0,
      achievementCount,
      highestOffice: deriveHighestOffice(officeSource) ?? null,
      avatarUrl: r.snapshot.avatarUrl ?? null,
      isActive: false,
      iteration: r.iteration ?? null,
      retiredAt: r.retiredAt,
      score,
      scoreBreakdown,
      netWorth: frozenNetWorth,
      netWorthBreakdown,
    });
  }

  const metricOf = (life: Life): number => (rankBy === "netWorth" ? life.netWorth : life.score);

  const ranked: LegacyLeaderboardEntry[] = [];
  for (const [userId, lives] of livesByUser) {
    const inScopeLives =
      scope === "current"
        ? lives.filter((l) => sameIteration(l.iteration, currentIteration))
        : lives;
    if (inScopeLives.length === 0) continue;

    const bestLife = inScopeLives.reduce((best, life) =>
      metricOf(life) > metricOf(best) ||
      (metricOf(life) === metricOf(best) &&
        (life.isActive !== best.isActive ? life.isActive : life.characterId < best.characterId))
        ? life
        : best
    );
    const preference = preferenceByUser.get(userId) ?? null;
    const displayLife =
      preference === "current"
        ? (lives.find((l) => l.isActive) ?? bestLife)
        : (lives.find((l) => l.characterId === preference) ?? bestLife);
    const displayName = displayLife.name;

    ranked.push({
      rank: 0,
      userId,
      displayName,
      displayCharacterId: displayLife.characterId,
      scoringCharacterId: bestLife.characterId,
      scoringCharacterName: bestLife.name,
      enactedBills: bestLife.enactedBills,
      contestWins: bestLife.contestWins,
      contestPodiums: bestLife.contestPodiums,
      scoreVersion: CAREER_SCORE_VERSION,
      countryId: bestLife.countryId,
      homeState: bestLife.homeState,
      iterationLabel: bestLife.iteration ? iterationLabel(bestLife.iteration) : "Unknown Era",
      score: bestLife.score,
      scoreBreakdown: bestLife.scoreBreakdown,
      netWorth: bestLife.netWorth,
      netWorthBreakdown: bestLife.netWorthBreakdown,
      nationalInfluence: bestLife.nationalInfluence,
      partyInfluence: bestLife.partyInfluence,
      achievementCount: bestLife.achievementCount,
      highestOffice: bestLife.highestOffice,
      avatarUrl: displayLife.avatarUrl,
      isActive: bestLife.isActive,
      lifetimeLives: lives.length,
    });
  }

  if (rankBy === "netWorth") {
    ranked.sort((a, b) => b.netWorth - a.netWorth || a.userId.localeCompare(b.userId));
  } else {
    ranked.sort(
      (a, b) =>
        b.score - a.score ||
        b.achievementCount - a.achievementCount ||
        b.nationalInfluence - a.nationalInfluence ||
        a.userId.localeCompare(b.userId)
    );
  }
  ranked.forEach((entry, i) => {
    entry.rank = i + 1;
  });

  let self: LegacyLeaderboardData["self"] = null;
  if (authUser) {
    const lives = livesByUser.get(authUser.userId) ?? [];
    const selfEntry = ranked.find((e) => e.userId === authUser.userId);
    // Active life (retiredAt: null) sorts first — a fixed sentinel greater
    // than any real retiredAt timestamp, rather than re-evaluating Date.now()
    // per comparison (which made comparisons involving two nulls unstable).
    const ACTIVE_LIFE_SORT_KEY = Infinity;
    const lifeOptions: LegacyLifeOption[] = lives
      .slice()
      .sort(
        (a, b) =>
          (b.retiredAt?.getTime() ?? ACTIVE_LIFE_SORT_KEY) -
          (a.retiredAt?.getTime() ?? ACTIVE_LIFE_SORT_KEY)
      )
      .map((l) => ({
        characterId: l.characterId,
        name: l.name,
        isActive: l.isActive,
        iterationLabel: l.iteration ? iterationLabel(l.iteration) : "Unknown Era",
        score: l.score,
        retiredAt: l.retiredAt ? l.retiredAt.toISOString() : null,
      }));
    self = {
      rank: selfEntry?.rank ?? null,
      lives: lifeOptions,
      displayPreference: preferenceByUser.get(authUser.userId) ?? null,
    };
  }

  return { entries: ranked, total: ranked.length, self };
}
