/**
 * Investor-ranking and wealth-list snapshots. Split out of
 * stockExchangeSnapshot.ts (pure code motion) — both are re-exported from that
 * module so existing import paths keep working. Runs once per turn after
 * corporation processing, alongside generateStockExchangeSnapshots.
 */
import { ObjectId, type Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type {
  Bond,
  Character,
  Corporation,
  State,
  InvestorRankingSnapshot,
  User,
  WealthListSnapshot,
  WealthListEntry,
} from "@/lib/db/types";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import type { ExchangeRate } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  corpLiquidCapitalToAnchor,
  fxRateForCorpFromMap,
  loadValuationFxRates,
} from "@/lib/currency/corporationCapital";
import { getDiscordAvatarUrl } from "@/lib/discord";
import { getPublicShareQuote } from "@/lib/corporations/marketQuote";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import type { CountryId } from "@/lib/constants/countries";
import { ALL_EXCHANGES, isStateRegister } from "@/lib/constants/exchangeRegistry";
import {
  computeCharacterWealth,
  sumBondValueByCharacter,
  sumStockValueByCharacter,
  loadFundValueByCharacter,
} from "@/lib/wealth/computeCharacterWealth";

/**
 * Generate pre-computed global investor rankings.
 * Called once per turn after corporation processing.
 */
export async function generateInvestorRankingSnapshot(currentTurn: number, db?: Db): Promise<void> {
  const database = db ?? (await getDb());
  const now = new Date();

  // Fetch all corporations with shareholders. Include currency metadata so we
  // can anchor-normalize per-corp share values before cross-corp summation —
  // same pattern as `generateStockExchangeSnapshots` and `generateWealthList-
  // Snapshots` in this file. Without it, a character holding ¥ + £ + $ corps
  // would have their holdings summed as if the numeric values were identical
  // units, and JP-corp-heavy portfolios would rank dramatically ahead of
  // comparable USD-equivalent wealth.
  const corporations = await database
    .collection<Corporation>("corporations")
    .find({})
    .project<{
      _id: ObjectId;
      shareholders: Array<{ characterId: ObjectId; shares: number }>;
      sharePrice: number;
      liquidCurrencyCode?: CurrencyCode;
      countryId?: string;
    }>({
      _id: 1,
      shareholders: 1,
      sharePrice: 1,
      liquidCurrencyCode: 1,
      countryId: 1,
    })
    .toArray();

  // Valuation map, not the settlement map: this value is DISPLAYED and RANKED.
  // The settlement map leaves the six bloc currencies (PLZ/CSK/HUF/YUD/BGL/ROL,
  // 102 corps) missing on purpose, which converted them at 1.0. See
  // corporationCapital.ts.
  const fxByCurrency = await loadValuationFxRates(database);

  // Calculate portfolio values for all shareholders (₳-normalized).
  const portfolioValues = new Map<string, number>();
  for (const corp of corporations) {
    const quoteLocal = getPublicShareQuote(corp);
    const corpFxRate = fxRateForCorpFromMap(corp, fxByCurrency);
    const quoteAnchor = corpLiquidCapitalToAnchor(quoteLocal, corp, corpFxRate);
    for (const sh of corp.shareholders ?? []) {
      if (sh.characterId && sh.shares > 0) {
        const charId = sh.characterId.toString();
        const valueAnchor = sh.shares * quoteAnchor;
        portfolioValues.set(charId, (portfolioValues.get(charId) ?? 0) + valueAnchor);
      }
    }
  }

  // Get character names for top investors
  const sortedInvestors = [...portfolioValues.entries()].sort((a, b) => b[1] - a[1]).slice(0, 100); // Top 100 for rankings display

  const topCharacterIds = sortedInvestors.map(([id]) => new ObjectId(id));
  const characters =
    topCharacterIds.length > 0
      ? await database
          .collection<Character>("characters")
          .find({ _id: { $in: topCharacterIds } })
          .project<{ _id: ObjectId; name: string }>({ _id: 1, name: 1 })
          .toArray()
      : [];
  const charNameMap = new Map(characters.map((c) => [c._id.toString(), c.name]));

  // Build rankings
  const rankings = sortedInvestors.map(([charId, value], idx) => ({
    characterId: charId,
    characterName: charNameMap.get(charId) ?? "Unknown",
    portfolioValue: value,
    rank: idx + 1,
  }));

  // Convert map to record for storage
  const portfolioValuesRecord: Record<string, number> = {};
  for (const [charId, value] of portfolioValues) {
    portfolioValuesRecord[charId] = value;
  }

  // Exclude _id from $set — MongoDB rejects updates that modify the immutable _id field
  // when the document already exists (e.g. persists across game resets).
  await database.collection<InvestorRankingSnapshot>("investorRankingSnapshots").updateOne(
    { _id: "global" },
    {
      $set: {
        turn: currentTurn,
        rankings,
        portfolioValues: portfolioValuesRecord,
        createdAt: now,
      },
    },
    { upsert: true }
  );
}

// ─── Wealth list snapshot ────────────────────────────────────────────────────

function resolveCountryId(character: Pick<Character, "countryId">): CountryId {
  return character.countryId as CountryId;
}

function resolveWealthAvatarUrl(
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
 * Generate pre-computed wealth list snapshots for all exchanges.
 * Called once per turn (hourly) after corporation processing.
 * Also archives the current snapshot to wealthListHistory for 24h-change lookups.
 */
export async function generateWealthListSnapshots(currentTurn: number, db?: Db): Promise<void> {
  const database = db ?? (await getDb());
  const now = new Date();

  const forexEnabled = await isForexEnabled();

  // Fetch exchange rates for accurate cross-currency wealth conversion
  const exchangeRates = forexEnabled
    ? (Object.fromEntries(
        (
          await database
            .collection<ExchangeRate>("exchangeRates")
            .find({})
            .project<Pick<ExchangeRate, "_id" | "currencyCode" | "rate">>({
              currencyCode: 1,
              rate: 1,
            })
            .toArray()
        ).map((r) => [r.currencyCode, r.rate])
      ) as Partial<Record<CurrencyCode, number>>)
    : undefined;

  // Fetch all characters
  const characters = await database
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
        | "currencyBalances"
        | "sequentialId"
      >
    >({
      _id: 1,
      userId: 1,
      name: 1,
      avatarUrl: 1,
      homeState: 1,
      countryId: 1,
      cashOnHand: 1,
      currencyBalances: 1,
      sequentialId: 1,
    })
    .toArray();

  if (characters.length === 0) return;

  // Fetch users for ban check and avatars
  const userIds = [...new Set(characters.map((c) => c.userId.toString()))].map(
    (id) => new ObjectId(id)
  );
  const users = await database
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

  const activeCharacters = characters.filter((c) => {
    const user = userMap.get(c.userId.toString());
    return user?.isBanned !== true;
  });
  if (activeCharacters.length === 0) return;

  const characterIds = activeCharacters.map((c) => c._id);
  const characterIdSet = new Set(characterIds.map((id) => id.toString()));

  // Fetch states, corporations, bonds, and FX rates in parallel. Wealth totals
  // sum across corps and bonds of any currency, so each value must be
  // anchor-normalized via `fxByCurrency` before accumulation (v0.2.6).
  const [states, corporations, bonds, fxByCurrency] = await Promise.all([
    database
      .collection<State>("states")
      .find({ _id: { $in: [...new Set(activeCharacters.map((c) => c.homeState))] } })
      .project<Pick<State, "_id" | "name">>({ _id: 1, name: 1 })
      .toArray(),
    database
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
    database
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
    loadValuationFxRates(database),
  ]);

  const stateNameMap = new Map(states.map((s) => [s._id, s.name]));

  // CEO display name (presentation, not net worth — the shared valuation
  // module deliberately does not carry it).
  const ceoCorpByCharId = new Map<string, string>();
  for (const corp of corporations) {
    const ceoId = corp.ceoId?.toString();
    if (ceoId && !corp.ceoVacant && characterIdSet.has(ceoId) && !ceoCorpByCharId.has(ceoId)) {
      ceoCorpByCharId.set(ceoId, corp.name);
    }
  }

  const stockValueByCharId = sumStockValueByCharacter(corporations, characterIdSet, fxByCurrency);
  const bondValueByCharId = sumBondValueByCharacter(bonds, characterIdSet, fxByCurrency);
  const fundValueByCharId = await loadFundValueByCharacter(database, characterIds, characterIdSet);

  // Build the global entry list sorted by totalWealth
  const globalEntries: WealthListEntry[] = activeCharacters
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

      return {
        characterId: charId,
        sequentialId: character.sequentialId ?? null,
        name: character.name,
        avatarUrl: resolveWealthAvatarUrl(character, user),
        state: stateNameMap.get(character.homeState) ?? character.homeState,
        country: countryName,
        corporation: ceoCorpByCharId.get(charId) ?? null,
        stockValue,
        bondValue,
        portfolioValue,
        cashValue,
        locDebtValue,
        totalWealth,
        rank: 0, // assigned below
      };
    })
    .sort((a, b) =>
      b.totalWealth !== a.totalWealth ? b.totalWealth - a.totalWealth : a.name.localeCompare(b.name)
    )
    .map((entry, idx) => ({ ...entry, rank: idx + 1 }));

  // Split by exchange — dynamically from registry
  function rankEntries(entries: WealthListEntry[]): WealthListEntry[] {
    return entries.map((e, idx) => ({ ...e, rank: idx + 1 }));
  }

  const snapshots: WealthListSnapshot[] = [
    { _id: "global", turn: currentTurn, entries: globalEntries, createdAt: now },
  ];
  for (const ex of ALL_EXCHANGES) {
    // Command-economy registers have no private investors by construction
    // (disallowPrivateCorporationFounding), so their wealth list is always
    // empty. Writing it would add a wealthListSnapshots upsert AND a
    // wealthListHistory row per register per turn that nothing ever reads —
    // the wealth-list route recomputes on the fly whenever a snapshot is
    // missing OR empty, so the stored empty document is dead weight.
    if (isStateRegister(ex.apiKey)) continue;
    const countryName = COUNTRY_CONFIGS[ex.countryId].name;
    const exchangeEntries = rankEntries(globalEntries.filter((e) => e.country === countryName));
    snapshots.push({ _id: ex.apiKey, turn: currentTurn, entries: exchangeEntries, createdAt: now });
  }

  const collection = database.collection<WealthListSnapshot>("wealthListSnapshots");

  // Archive current snapshots to history (for 24h lookups), then upsert new ones
  const historyOps: Array<{
    updateOne: {
      filter: { exchange: string; turn: number };
      update: {
        $set: {
          exchange: string;
          turn: number;
          entries: WealthListEntry[];
          createdAt: Date;
        };
      };
      upsert: true;
    };
  }> = [];
  const snapshotOps: Array<{
    updateOne: {
      filter: { _id: string };
      update: { $set: WealthListSnapshot };
      upsert: true;
    };
  }> = [];

  for (const snapshot of snapshots) {
    historyOps.push({
      updateOne: {
        filter: { exchange: snapshot._id, turn: currentTurn },
        update: {
          $set: {
            exchange: snapshot._id,
            turn: currentTurn,
            entries: snapshot.entries,
            createdAt: now,
          },
        },
        upsert: true,
      },
    });
    snapshotOps.push({
      updateOne: {
        filter: { _id: snapshot._id },
        update: { $set: snapshot },
        upsert: true,
      },
    });
  }

  if (historyOps.length > 0) {
    await database.collection("wealthListHistory").bulkWrite(historyOps as never);
  }
  if (snapshotOps.length > 0) {
    await collection.bulkWrite(snapshotOps as never);
  }
}
