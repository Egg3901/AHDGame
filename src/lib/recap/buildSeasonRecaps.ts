import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type {
  Character,
  PoliticalParty,
  ActionLog,
  Bill,
  CharacterAchievement,
  Achievement,
  UserSubscription,
  NewsPost,
  InvestorRankingSnapshot,
  GameState,
} from "@/lib/db/types";
import type { ActionType, GameIteration } from "@/lib/db/types/gameState";
import { getHomeCurrency } from "@/lib/currency/characterFunds";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getEraAwareCurrencySymbol } from "@/lib/constants/currencies";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { fetchExchangeRateMap, getRateDoc, rateFromDoc, toInternalAmount } from "@/lib/world/forex";
import { buildCharacterRecap } from "./buildCharacterRecap";
import type { PerCharacterRecapInput, RankPosition } from "./buildCharacterRecap";
import { loadStoryData } from "./loadStoryData";
import { assignAwards, buildPersona } from "./awards";
import type {
  CharacterRecap,
  RecapAchievementHighlight,
  RecapActionBreakdown,
  RecapRankedStat,
} from "./types";

/** Bill statuses that count as "passed" (enacted) for the recap. */
const PASSED_BILL_STATUSES = ["signed", "enrolled", "veto_override", "override_shugiin"];

export interface RecapBuildContext {
  /** Outgoing iteration this life belonged to (title of the recap). */
  iteration?: GameIteration;
  /** Outgoing currentTurn — anchors tenure. */
  currentTurn: number;
}

export interface BuildSeasonRecapsOptions {
  /**
   * Population used to compute field-metric ranks (npi/favorability/net
   * worth/funds), per country. Defaults to `targets`. A solo build passes the
   * full current field so a single retiree still gets a real rank.
   */
  field?: Character[];
  /**
   * Whether to compute the action-count rank. Only valid when `targets` equals
   * `field` (season reset) so every ranked character's action total was
   * aggregated. Defaults to true. Solo builds pass false (actions scoped to one
   * target ⇒ no field-wide action counts ⇒ `actions.rank` is null).
   */
  rankActions?: boolean;
  /** Progress/warning sink; a failed v2 section is reported here and skipped. */
  log?: (msg: string) => void;
}

/** Rank a field descending by `valueOf`, within each country. */
function rankByCountry(
  field: Character[],
  valueOf: (c: Character) => number
): Map<string, RankPosition> {
  const byCountry = new Map<string, Array<{ id: string; value: number }>>();
  for (const c of field) {
    const arr = byCountry.get(c.countryId) ?? [];
    arr.push({ id: c._id.toString(), value: valueOf(c) });
    byCountry.set(c.countryId, arr);
  }
  const out = new Map<string, RankPosition>();
  for (const arr of byCountry.values()) {
    arr.sort((a, b) => b.value - a.value);
    const total = arr.length;
    arr.forEach((e, i) =>
      out.set(e.id, {
        rank: i + 1,
        total,
        aboveId: arr[i - 1]?.id ?? null,
        belowId: arr[i + 1]?.id ?? null,
      })
    );
  }
  return out;
}

/** Rank the whole field descending by `valueOf`, GLOBALLY (one bucket) — used
 *  for cross-country wealth so a forex-normalized net worth ranks worldwide. */
function rankGlobal(
  field: Character[],
  valueOf: (c: Character) => number
): Map<string, RankPosition> {
  const entries = field.map((c) => ({ id: c._id.toString(), value: valueOf(c) }));
  entries.sort((a, b) => b.value - a.value);
  const total = entries.length;
  const out = new Map<string, RankPosition>();
  entries.forEach((e, i) =>
    out.set(e.id, {
      rank: i + 1,
      total,
      aboveId: entries[i - 1]?.id ?? null,
      belowId: entries[i + 1]?.id ?? null,
    })
  );
  return out;
}

function campaignFundsOf(c: Character): number {
  return c.currencyBalances?.campaign ?? c.funds ?? 0;
}

function cashOnHandOf(c: Character): number {
  return c.currencyBalances?.personal?.[getHomeCurrency(c)] ?? c.cashOnHand ?? 0;
}

/** Look-back for the latest portfolio snapshot; it is written every turn. */
const PORTFOLIO_LOOKBACK_TURNS = 12;

/**
 * Each character's most recent net portfolio value (anchor units), from the
 * last few turns of portfolioHistory. Empty on failure: callers fall back.
 */
async function latestPortfolioNetValues(
  db: Db,
  field: Character[],
  currentTurn: number
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const rows = await db
      .collection("portfolioHistory")
      .aggregate<{ _id: ObjectId; v: number | null }>([
        {
          $match: {
            characterId: { $in: field.map((c) => c._id) },
            turn: { $gte: currentTurn - PORTFOLIO_LOOKBACK_TURNS },
          },
        },
        { $sort: { turn: -1 } },
        {
          $group: {
            _id: "$characterId",
            v: { $first: { $ifNull: ["$netValue", "$totalValue"] } },
          },
        },
      ])
      .toArray();
    for (const r of rows)
      if (typeof r.v === "number" && Number.isFinite(r.v)) out.set(String(r._id), r.v);
  } catch {
    // fall back to the cash + stock sum
  }
  return out;
}

/**
 * Batch-build every target character's Season Recap. Runs a bounded set of
 * aggregations (one each over actionLogs / bills / characterAchievements /
 * userSubscriptions / newsPosts, plus the investor snapshot), scoped to the
 * target ids, and computes per-country ranks in memory from the `field`. Must
 * run BEFORE `resetGameWorld` wipes those runtime collections. Returns a map
 * keyed by `characterId` string.
 */
export async function buildSeasonRecaps(
  db: Db,
  targets: Character[],
  ctx: RecapBuildContext,
  opts?: BuildSeasonRecapsOptions
): Promise<Map<string, CharacterRecap>> {
  const result = new Map<string, CharacterRecap>();
  if (targets.length === 0) return result;

  const field = opts?.field ?? targets;
  const rankActions = opts?.rankActions ?? true;
  const canRank = field.length >= 2; // a one-character field cannot be meaningfully ranked
  const ids = targets.map((c) => c._id);

  const [actionRows, billRows, achievementRows, subRows, newsRows, investorSnap] =
    await Promise.all([
      db
        .collection<ActionLog>("actionLogs")
        .aggregate<{ _id: { c: ObjectId; t: ActionType }; n: number }>([
          { $match: { characterId: { $in: ids } } },
          { $group: { _id: { c: "$characterId", t: "$actionType" }, n: { $sum: 1 } } },
        ])
        .toArray(),
      db
        .collection<Bill>("bills")
        .aggregate<{ _id: ObjectId | null; sponsored: number; passed: number }>([
          { $match: { sponsorId: { $in: ids } } },
          {
            $group: {
              _id: "$sponsorId",
              sponsored: { $sum: 1 },
              passed: { $sum: { $cond: [{ $in: ["$status", PASSED_BILL_STATUSES] }, 1, 0] } },
            },
          },
        ])
        .toArray(),
      db
        .collection<CharacterAchievement>("characterAchievements")
        .aggregate<{ _id: ObjectId; n: number }>([
          { $match: { characterId: { $in: ids } } },
          { $group: { _id: "$characterId", n: { $sum: 1 } } },
        ])
        .toArray(),
      db
        .collection<UserSubscription>("userSubscriptions")
        .aggregate<{ _id: ObjectId; n: number }>([
          { $match: { subscribedToCharacterId: { $in: ids } } },
          { $group: { _id: "$subscribedToCharacterId", n: { $sum: 1 } } },
        ])
        .toArray(),
      db
        .collection<NewsPost>("newsPosts")
        .aggregate<{ _id: ObjectId; posts: number; likes: number }>([
          { $match: { authorId: { $in: ids }, isSystem: { $ne: true } } },
          {
            $group: {
              _id: "$authorId",
              posts: { $sum: { $cond: [{ $eq: [{ $type: "$parentId" }, "missing"] }, 1, 0] } },
              likes: { $sum: { $ifNull: ["$reactions.agree", 0] } },
            },
          },
        ])
        .toArray(),
      db.collection<InvestorRankingSnapshot>("investorRankingSnapshots").findOne({ _id: "global" }),
    ]);

  // ── Fold aggregate rows into per-character maps ────────────────────────────
  const actionsByChar = new Map<string, { total: number; byType: RecapActionBreakdown }>();
  for (const row of actionRows) {
    const id = row._id.c.toString();
    const entry = actionsByChar.get(id) ?? { total: 0, byType: {} };
    entry.byType[row._id.t] = (entry.byType[row._id.t] ?? 0) + row.n;
    entry.total += row.n;
    actionsByChar.set(id, entry);
  }
  const billsByChar = new Map<string, { sponsored: number; passed: number }>();
  for (const row of billRows) {
    if (!row._id) continue;
    billsByChar.set(row._id.toString(), { sponsored: row.sponsored, passed: row.passed });
  }
  const achCountByChar = new Map<string, number>();
  for (const row of achievementRows) achCountByChar.set(row._id.toString(), row.n);
  const subsByChar = new Map<string, number>();
  for (const row of subRows) subsByChar.set(row._id.toString(), row.n);
  const newsByChar = new Map<string, { posts: number; likes: number }>();
  for (const row of newsRows)
    newsByChar.set(row._id.toString(), { posts: row.posts, likes: row.likes });
  const portfolioValues = investorSnap?.portfolioValues ?? {};

  // ── Per-character money values ─────────────────────────────────────────────
  // Local values drive the displayed figure (in the player's own currency); the
  // forex-normalized internal values drive the GLOBAL wealth ranking so a £
  // fortune and a $ fortune compare fairly worldwide.
  //
  // Personal wealth comes from the character's latest portfolioHistory row: it
  // is written every turn in anchor units and counts savings and every
  // currency held. The older sum (home-currency cash + stock portfolio) missed
  // both, so a saver with M 115mn in the bank read as worth M 5.8mn. That sum
  // stays as the fallback for characters with no snapshot.
  const rateMap = await fetchExchangeRateMap(db);
  const latestPortfolio = await latestPortfolioNetValues(db, field, ctx.currentTurn);
  const netWorthByChar = new Map<string, number>(); // local (display)
  const fundsByChar = new Map<string, number>(); // local (display)
  const netWorthInternalByChar = new Map<string, number>(); // fx-normalized (rank)
  const fundsInternalByChar = new Map<string, number>();
  for (const c of field) {
    const id = c._id.toString();
    const funds = campaignFundsOf(c);
    const rateDoc = getRateDoc(rateMap, c.countryId);
    const fundsInternal = toInternalAmount(funds, rateDoc);
    const personalInternal = latestPortfolio.get(id);
    const netWorthInternal =
      personalInternal != null
        ? fundsInternal + personalInternal
        : toInternalAmount(funds + cashOnHandOf(c) + (portfolioValues[id] ?? 0), rateDoc);
    fundsByChar.set(id, funds);
    fundsInternalByChar.set(id, fundsInternal);
    netWorthInternalByChar.set(id, netWorthInternal);
    netWorthByChar.set(id, netWorthInternal * rateFromDoc(rateDoc));
  }

  // ── Ranks: political standing per country; wealth GLOBAL + forex-normalized ─
  const npiRank = canRank ? rankByCountry(field, (c) => c.nationalInfluence ?? 0) : null;
  const favRank = canRank ? rankByCountry(field, (c) => c.favorability ?? 50) : null;
  const netWorthRank = canRank
    ? rankGlobal(field, (c) => netWorthInternalByChar.get(c._id.toString()) ?? 0)
    : null;
  const fundsRank = canRank
    ? rankGlobal(field, (c) => fundsInternalByChar.get(c._id.toString()) ?? 0)
    : null;
  const actionsRank =
    rankActions && canRank
      ? rankByCountry(field, (c) => actionsByChar.get(c._id.toString())?.total ?? 0)
      : null;

  // ── Party display names (one query for the whole target set) ───────────────
  const partyKeys = [
    ...new Map(
      targets
        .filter((c) => c.party && c.party !== "independent" && Number.isFinite(Number(c.party)))
        .map((c) => [
          `${c.countryId}:${c.party}`,
          { countryId: c.countryId, sequentialId: Number(c.party) },
        ])
    ).values(),
  ];
  const partyDocs =
    partyKeys.length > 0
      ? await db
          .collection<PoliticalParty>("politicalParties")
          .find({
            $or: partyKeys.map((k) => ({ countryId: k.countryId, sequentialId: k.sequentialId })),
          })
          .toArray()
      : [];
  const partyNameMap = new Map(partyDocs.map((p) => [`${p.countryId}:${p.sequentialId}`, p.name]));
  const partyColorMap = new Map(
    partyDocs.map((p) => [`${p.countryId}:${p.sequentialId}`, p.color ?? null])
  );
  const partyNameFor = (c: Character): string =>
    c.party === "independent"
      ? "Independent"
      : (partyNameMap.get(`${c.countryId}:${c.party}`) ?? "Independent");

  // ── Achievement highlights (player-chosen; up to 3 each) ───────────────────
  const highlightIds = new Map<string, ObjectId>();
  for (const c of targets) {
    for (const id of (c.highlightedAchievementIds ?? []).slice(0, 3))
      highlightIds.set(id.toString(), id);
  }
  const achDefs =
    highlightIds.size > 0
      ? await db
          .collection<Achievement>("achievements")
          .find({ _id: { $in: [...highlightIds.values()] } })
          .toArray()
      : [];
  const achDefMap = new Map(achDefs.map((a) => [a._id.toString(), a]));
  const highlightsFor = (c: Character): RecapAchievementHighlight[] =>
    (c.highlightedAchievementIds ?? [])
      .slice(0, 3)
      .map((id) => achDefMap.get(id.toString()))
      .filter((a): a is Achievement => Boolean(a))
      .map((a) => ({ name: a.name, icon: a.icon ?? null }));

  // ── v2 story sections (best-effort; never blocks the v1 core) ──────────────
  const log = opts?.log ?? (() => {});
  const story = await loadStoryData(db, targets, field, ctx, {
    includeWorld: rankActions,
    warn: (name, err) =>
      log(
        `season recap: ${name} section skipped (${err instanceof Error ? err.message : String(err)})`
      ),
  }).catch((err: unknown) => {
    log(`season recap: story data skipped (${err instanceof Error ? err.message : String(err)})`);
    return null;
  });

  // Neighbors on a board, by name, valued in the viewer's own terms.
  const fieldById = new Map(field.map((c) => [c._id.toString(), c]));
  const npiNeighbors = (pos: RankPosition | null | undefined): RecapRankedStat["neighbors"] => {
    if (!pos) return undefined;
    const pick = (id: string | null | undefined) => {
      const n = id ? fieldById.get(id) : undefined;
      return n ? { name: n.name, value: n.nationalInfluence ?? 0 } : null;
    };
    return { above: pick(pos.aboveId), below: pick(pos.belowId) };
  };
  const wealthNeighbors = (
    viewer: Character,
    pos: RankPosition | null | undefined
  ): RecapRankedStat["neighbors"] => {
    if (!pos) return undefined;
    const rate = rateFromDoc(getRateDoc(rateMap, viewer.countryId));
    const pick = (id: string | null | undefined) => {
      const n = id ? fieldById.get(id) : undefined;
      return n
        ? { name: n.name, value: (netWorthInternalByChar.get(n._id.toString()) ?? 0) * rate }
        : null;
    };
    return { above: pick(pos.aboveId), below: pick(pos.belowId) };
  };

  // Money symbols as this world's era showed them (1953 DM, not euros).
  const era = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { preset: 1, eurozoneEnabled: 1 } })
    .catch(() => null);
  const symbolFor = (c: Character) =>
    getEraAwareCurrencySymbol(
      getHomeCurrency(c),
      era?.preset ?? DEFAULT_SEED_PRESET,
      era?.eurozoneEnabled === true
    );

  // ── Assemble ───────────────────────────────────────────────────────────────
  for (const c of targets) {
    const id = c._id.toString();
    const input: PerCharacterRecapInput = {
      partyName: partyNameFor(c),
      actions: actionsByChar.get(id) ?? { total: 0, byType: {} },
      bills: billsByChar.get(id) ?? { sponsored: 0, passed: 0 },
      social: {
        subscribers: subsByChar.get(id) ?? 0,
        posts: newsByChar.get(id)?.posts ?? 0,
        likes: newsByChar.get(id)?.likes ?? 0,
      },
      achievementsCount: achCountByChar.get(id) ?? 0,
      achievementHighlights: highlightsFor(c),
      campaignFunds: fundsByChar.get(id) ?? 0,
      netWorth: netWorthByChar.get(id) ?? 0,
      ranks: {
        npi: npiRank?.get(id) ?? null,
        favorability: favRank?.get(id) ?? null,
        netWorth: netWorthRank?.get(id) ?? null,
        campaignFunds: fundsRank?.get(id) ?? null,
        actions: actionsRank?.get(id) ?? null,
      },
    };
    const core = buildCharacterRecap(c, input, ctx);
    if (core.influence.npi) core.influence.npi.neighbors = npiNeighbors(npiRank?.get(id));
    if (core.netWorth) core.netWorth.neighbors = wealthNeighbors(c, netWorthRank?.get(id));
    const partyKey = `${c.countryId}:${c.party}`;
    const recap: CharacterRecap = {
      ...core,
      schemaVersion: 2,
      countryName: Object.hasOwn(COUNTRY_CONFIGS, c.countryId)
        ? COUNTRY_CONFIGS[c.countryId as CountryId].name
        : c.countryId,
      currency: getHomeCurrency(c),
      currencySymbol: symbolFor(c),
      partyColor: partyColorMap.get(partyKey) ?? null,
      ...(story?.perCharacter.get(id) ?? {}),
      world: story?.world ?? null,
    };
    result.set(id, recap);
  }

  // Awards compare the whole cohort, so they only run on a season build.
  const awards = rankActions && canRank ? assignAwards([...result.values()]) : null;
  for (const [id, recap] of result) {
    try {
      recap.awards = awards?.get(id) ?? [];
      recap.persona = buildPersona(recap);
    } catch (err) {
      log(`season recap: persona skipped (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  return result;
}

/**
 * Build a single character's recap for a mid-season retirement (voluntary or
 * admin). Ranks against the full current field (cheap, in-memory) but scopes
 * the action aggregation to just this character, so it never scans the whole
 * action history — the trade-off being `actions.rank` is null here. Call BEFORE
 * `retireCharacter` deletes this character's actionLogs.
 */
export async function buildSoloRecap(
  db: Db,
  character: Character,
  ctx: RecapBuildContext
): Promise<CharacterRecap | null> {
  const field = await db.collection<Character>("characters").find({}).toArray();
  if (!field.some((c) => c._id.equals(character._id))) field.push(character);
  const recaps = await buildSeasonRecaps(db, [character], ctx, { field, rankActions: false });
  return recaps.get(character._id.toString()) ?? null;
}
