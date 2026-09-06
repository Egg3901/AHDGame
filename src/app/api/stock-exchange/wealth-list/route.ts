import { NextResponse } from "next/server";
import { ObjectId, type Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import type { Bond, Character, Corporation, State, User, WealthListSnapshot } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getDiscordAvatarUrl } from "@/lib/discord";
import { fetchBordersByUserIds } from "@/lib/db/patreonBorders";
import { EXCHANGE_API_KEYS, getCountryForExchange } from "@/lib/constants/exchangeRegistry";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import type { ExchangeRate } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { loadValuationFxRates } from "@/lib/currency/corporationCapital";
import {
  computeCharacterWealth,
  sumBondValueByCharacter,
  sumStockValueByCharacter,
  loadFundValueByCharacter,
} from "@/lib/wealth/computeCharacterWealth";

function resolveCountryId(character: Pick<Character, "countryId">): CountryId {
  return character.countryId as CountryId;
}

function resolveAvatarUrl(
  character: Pick<Character, "avatarUrl">,
  user: Pick<User, "discordId" | "discordAvatar" | "googleAvatar"> | undefined
): string | null {
  const charUrl = character.avatarUrl?.trim();
  if (charUrl) return charUrl;
  const google = user?.googleAvatar?.trim();
  if (google) return google;
  if (user?.discordId) {
    return getDiscordAvatarUrl(user.discordId, user.discordAvatar ?? null);
  }
  return null;
}

/**
 * Fallback: compute wealth list on-the-fly when no pre-computed snapshot exists.
 * Returns entries with null change fields (placeholders).
 */
async function computeWealthListFallback(
  db: Db,
  exchange: string,
  forexEnabled: boolean,
  exchangeRates?: Partial<Record<CurrencyCode, number>>
) {
  const characters = await db
    .collection<Character>("characters")
    .find({})
    .project<
      Pick<
        Character,
        | "_id"
        | "userId"
        | "name"
        | "avatarUrl"
        | "homeState"
        | "countryId"
        | "cashOnHand"
        | "sequentialId"
        | "currencyBalances"
      >
    >({
      _id: 1,
      userId: 1,
      name: 1,
      avatarUrl: 1,
      homeState: 1,
      countryId: 1,
      cashOnHand: 1,
      sequentialId: 1,
      currencyBalances: 1,
    })
    .toArray();

  if (characters.length === 0) return [];

  // Filter by exchange
  const exchangeCharacters =
    exchange === "global"
      ? characters
      : characters.filter((c) => resolveCountryId(c) === getCountryForExchange(exchange));

  if (exchangeCharacters.length === 0) return [];

  const userIds = [...new Set(exchangeCharacters.map((c) => c.userId.toString()))].map(
    (id) => new ObjectId(id)
  );
  const users = await db
    .collection<User>("users")
    .find({ _id: { $in: userIds } })
    .project<Pick<User, "_id" | "isBanned" | "discordId" | "discordAvatar" | "googleAvatar">>({
      _id: 1,
      isBanned: 1,
      discordId: 1,
      discordAvatar: 1,
      googleAvatar: 1,
    })
    .toArray();
  const userMap = new Map(users.map((u) => [u._id.toString(), u]));

  const activeCharacters = exchangeCharacters.filter((c) => {
    const user = userMap.get(c.userId.toString());
    return user?.isBanned !== true;
  });
  if (activeCharacters.length === 0) return [];

  const characterIds = activeCharacters.map((c) => c._id);
  const characterIdSet = new Set(characterIds.map((id) => id.toString()));

  // Stock and bond values are each stored in their own local currency
  // (v0.2.6); wealth summation must anchor-normalize each leg, else a UK
  // shareholder would be ranked against a JP shareholder as if both
  // currencies were identical to ₳.
  const [states, corporations, bonds, fxByCurrency] = await Promise.all([
    db
      .collection<State>("states")
      .find({ _id: { $in: [...new Set(activeCharacters.map((c) => c.homeState))] } })
      .project<Pick<State, "_id" | "name">>({ _id: 1, name: 1 })
      .toArray(),
    db
      .collection<Corporation>("corporations")
      .find({
        $or: [
          { "shareholders.characterId": { $in: characterIds } },
          { ceoId: { $in: characterIds } },
        ],
      })
      .sort({ createdAt: -1 })
      .project<
        Pick<
          Corporation,
          | "_id"
          | "name"
          | "ceoId"
          | "ceoVacant"
          | "sharePrice"
          | "shareholders"
          | "liquidCurrencyCode"
          | "countryId"
        >
      >({
        _id: 1,
        name: 1,
        ceoId: 1,
        ceoVacant: 1,
        sharePrice: 1,
        shareholders: 1,
        liquidCurrencyCode: 1,
        countryId: 1,
      })
      .toArray(),
    db
      .collection<Bond>("bonds")
      .find({ matured: false, "holders.characterId": { $in: characterIds } })
      .project<Pick<Bond, "_id" | "holders" | "marketPrice" | "currencyCode" | "countryId">>({
        _id: 1,
        holders: 1,
        marketPrice: 1,
        currencyCode: 1,
        countryId: 1,
      })
      .toArray(),
    // Valuation map, not the settlement map: this list RANKS players by wealth.
    // The settlement map leaves the six bloc currencies (PLZ/CSK/HUF/YUD/BGL/ROL)
    // missing on purpose, which converted them at 1.0. See corporationCapital.ts.
    loadValuationFxRates(db),
  ]);

  const stateNameMap = new Map(states.map((s) => [s._id, s.name]));
  // CEO display name, kept here rather than in the shared valuation module: it
  // is presentation, not net worth, and only this route renders it.
  const ceoCorpByCharId = new Map<string, string>();
  for (const corp of corporations) {
    const ceoId = corp.ceoId?.toString();
    if (ceoId && !corp.ceoVacant && characterIdSet.has(ceoId) && !ceoCorpByCharId.has(ceoId)) {
      ceoCorpByCharId.set(ceoId, corp.name);
    }
  }

  const stockValueByCharId = sumStockValueByCharacter(corporations, characterIdSet, fxByCurrency);
  const bondValueByCharId = sumBondValueByCharacter(bonds, characterIdSet, fxByCurrency);
  const fundValueByCharId = await loadFundValueByCharacter(db, characterIds, characterIdSet);

  // Fetch border data
  const borderMap = await fetchBordersByUserIds(
    db,
    activeCharacters.map((c) => c.userId)
  );

  return activeCharacters
    .map((character) => {
      const charId = character._id.toString();
      const { stockValue, bondValue, portfolioValue, cashValue, locDebtValue, totalWealth } =
        computeCharacterWealth(
          character as Character,
          stockValueByCharId,
          bondValueByCharId,
          forexEnabled,
          exchangeRates,
          fundValueByCharId
        );
      const countryId = resolveCountryId(character);
      const countryName = COUNTRY_CONFIGS[countryId]?.name ?? countryId;
      const user = userMap.get(character.userId.toString());
      const border = user ? borderMap.get(user._id.toString()) : undefined;

      return {
        characterId: charId,
        sequentialId: character.sequentialId ?? null,
        name: character.name,
        avatarUrl: resolveAvatarUrl(character, user),
        state: stateNameMap.get(character.homeState) ?? character.homeState,
        country: countryName,
        corporation: ceoCorpByCharId.get(charId) ?? null,
        borderKey: border?.borderKey ?? null,
        tintColor: border?.tintColor ?? null,
        stockValue,
        bondValue,
        portfolioValue,
        cashValue,
        locDebtValue,
        totalWealth,
        wealthChange24h: null,
        rankChange24h: null,
      };
    })
    .sort((a, b) =>
      b.totalWealth !== a.totalWealth ? b.totalWealth - a.totalWealth : a.name.localeCompare(b.name)
    )
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

/**
 * GET /api/stock-exchange/wealth-list?exchange=global|nyse|ftse
 * Returns pre-computed wealth list from the hourly snapshot, enriched with
 * 24h wealth change ($ amount) and rank movement.
 * Falls back to on-the-fly computation if no snapshot exists yet.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const exchange = searchParams.get("exchange")?.toLowerCase();
    if (!exchange || !EXCHANGE_API_KEYS.has(exchange)) {
      return NextResponse.json(
        { error: `Invalid exchange. Use one of: ${[...EXCHANGE_API_KEYS].join(", ")}` },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Read the live snapshot
    const snapshot = await db
      .collection<WealthListSnapshot>("wealthListSnapshots")
      .findOne({ _id: exchange });

    if (!snapshot || snapshot.entries.length === 0) {
      // No snapshot yet — compute on the fly with placeholder change data
      const forexEnabled = await isForexEnabled();
      // Fetch exchange rates for accurate cross-currency wealth comparison
      const rateMap = forexEnabled
        ? (Object.fromEntries(
            (await db.collection<ExchangeRate>("exchangeRates").find({}).toArray()).map((r) => [
              r.currencyCode,
              r.rate,
            ])
          ) as Partial<Record<CurrencyCode, number>>)
        : undefined;
      const fallbackEntries = await computeWealthListFallback(db, exchange, forexEnabled, rateMap);
      return NextResponse.json({ exchange: exchange.toUpperCase(), entries: fallbackEntries });
    }

    // Look up the snapshot from 24 turns ago for change calculations
    const turn24Ago = Math.max(1, snapshot.turn - 24);
    const oldSnapshot = await db
      .collection<{
        exchange: string;
        turn: number;
        entries: WealthListSnapshot["entries"];
      }>("wealthListHistory")
      .findOne({ exchange, turn: { $lte: turn24Ago } }, { sort: { turn: -1 } });

    // Build lookup maps from old snapshot
    const oldWealthMap = new Map<string, number>();
    const oldRankMap = new Map<string, number>();
    if (oldSnapshot) {
      for (const entry of oldSnapshot.entries) {
        oldWealthMap.set(entry.characterId, entry.totalWealth);
        oldRankMap.set(entry.characterId, entry.rank);
      }
    }

    // Fetch border data for all characters in the snapshot
    const charIds = snapshot.entries
      .map((e) => e.characterId)
      .filter((id) => ObjectId.isValid(id))
      .map((id) => new ObjectId(id));
    const characters =
      charIds.length > 0
        ? await db
            .collection<Character>("characters")
            .find({ _id: { $in: charIds } })
            .project<Pick<Character, "_id" | "userId">>({ _id: 1, userId: 1 })
            .toArray()
        : [];
    const charUserMap = new Map(characters.map((c) => [c._id.toString(), c.userId]));
    const borderMap = await fetchBordersByUserIds(
      db,
      characters.map((c) => c.userId)
    );

    // Enrich current entries with 24h changes and border data
    const entries = snapshot.entries.map((entry) => {
      const oldWealth = oldWealthMap.get(entry.characterId);
      const oldRank = oldRankMap.get(entry.characterId);
      const uid = charUserMap.get(entry.characterId);
      const border = uid ? borderMap.get(uid.toString()) : undefined;

      return {
        ...entry,
        borderKey: border?.borderKey ?? null,
        tintColor: border?.tintColor ?? null,
        wealthChange24h:
          oldWealth != null ? Math.round((entry.totalWealth - oldWealth) * 100) / 100 : null,
        rankChange24h: oldRank != null ? oldRank - entry.rank : null, // positive = moved up
      };
    });

    return NextResponse.json(
      {
        exchange: exchange.toUpperCase(),
        entries,
      },
      {
        // Global wealth ranking from precomputed snapshots (refreshed by the
        // 15-min stock cron), no auth/user context — safe to edge-cache. Matches
        // the /api/stock-exchange TTL so all viewers share one origin fetch.
        headers: {
          "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300, no-transform",
        },
      }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
