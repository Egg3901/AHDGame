import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBotToken } from "@/lib/api/requireBotToken";
import { checkRateLimit, rateLimitResponse, BOT_FINANCIAL_LIMITS } from "@/lib/api/rateLimit";
import type { Character, User, PoliticalParty, Corporation, ElectedOfficial } from "@/lib/db/types";
import { COUNTRY_ORDER, type CountryId } from "@/lib/constants/countries";
import { getHeadOfGovernmentCharacterId } from "@/lib/api/headOfGovernment";
import {
  corpLiquidCapitalToAnchor,
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
} from "@/lib/currency/corporationCapital";
import { buildSyncRoleTokens } from "./buildSyncRoles";

// GET /api/discord-bot/sync-roles — Returns the Discord roles a user should hold based on their in-game party, office, and investment status.
// Auth: requireAdminOrApiKey
// Errors: 400, 401
export async function GET(request: Request) {
  try {
    if (!requireBotToken(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(
      "discord-bot:sync-roles-get",
      BOT_FINANCIAL_LIMITS.maxRequests,
      BOT_FINANCIAL_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const url = new URL(request.url);
    const discordId = url.searchParams.get("discordId");

    if (!discordId) {
      return NextResponse.json({ error: "Must provide discordId" }, { status: 400 });
    }

    const db = await getDb();

    // Find user by Discord ID
    const user = await db.collection<User>("users").findOne({ discordId });
    if (!user) {
      return NextResponse.json({ found: false, roles: [] });
    }

    // Find character
    const character = await db.collection<Character>("characters").findOne({ userId: user._id });
    if (!character) {
      return NextResponse.json({ found: false, roles: [] });
    }

    // Get party info - filter by both sequentialId AND countryId
    let partySlug: string = "independent";
    let partyName: string = "Independent";
    let partyColor: string | null = null;
    const charCountryId = character.countryId ?? "US";
    if (character.party && character.party !== "independent") {
      const party = await db
        .collection<PoliticalParty>("politicalParties")
        .findOne({ sequentialId: Number(character.party), countryId: charCountryId });
      if (party) {
        partySlug = String(party.sequentialId);
        partyName = party.name;
        partyColor = party.color ?? null;
      } else {
        // Party not found - keep as independent to avoid numeric role names
        partySlug = "independent";
        partyName = "Independent";
      }
    }

    // Check investor status and compute portfolio value + ranking
    const allCorps = await db
      .collection<Corporation>("corporations")
      .find({})
      .project<{
        _id: import("mongodb").ObjectId;
        ceoId: import("mongodb").ObjectId;
        ceoVacant?: boolean;
        shareholders: Array<{ characterId: import("mongodb").ObjectId; shares: number }>;
        sharePrice: number;
        liquidCurrencyCode?: string;
        countryId?: string;
      }>({
        _id: 1,
        ceoId: 1,
        ceoVacant: 1,
        shareholders: 1,
        sharePrice: 1,
        liquidCurrencyCode: 1,
        countryId: 1,
      })
      .toArray();

    const isCeo = allCorps.some(
      (c) => c.ceoId?.toString() === character._id.toString() && !c.ceoVacant
    );

    // Compute portfolio values for all shareholders to rank top 3. sharePrice
    // is in each corp's liquidCurrencyCode (v0.2.6); the cross-corp ranking
    // must normalize each holding to ₳ before summing.
    const rolesFxByCurrency = await loadFxRatesByCurrency(db);
    const portfolioValues = new Map<string, number>();
    for (const corp of allCorps) {
      const price = corp.sharePrice ?? 0;
      if (price <= 0) continue;
      const corpFxRate = fxRateForCorpFromMap(corp, rolesFxByCurrency);
      for (const sh of corp.shareholders ?? []) {
        if (sh.shares > 0 && sh.characterId) {
          const cid = sh.characterId.toString();
          const local = sh.shares * price;
          portfolioValues.set(
            cid,
            (portfolioValues.get(cid) ?? 0) + corpLiquidCapitalToAnchor(local, corp, corpFxRate)
          );
        }
      }
    }

    const charIdStr = character._id.toString();
    const isInvestor = portfolioValues.has(charIdStr);
    const portfolioValue = portfolioValues.get(charIdStr) ?? 0;

    // Rank top 3 investors
    const sorted = [...portfolioValues.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    const investorRank = sorted.findIndex(([id]) => id === charIdStr);
    const rank = investorRank >= 0 ? investorRank + 1 : null;

    /*
     * Central bank chair status lives on centralBanks.chairCharacterId, not
     * currentOffice, so query it independently. The token stacks on top of any
     * elected-office token (handled inside buildSyncRoleTokens).
     */
    const chairBank = await db
      .collection("centralBanks")
      .findOne({ chairCharacterId: character._id }, { projection: { _id: 1 } });
    const isCentralBankChair = chairBank != null;

    const country = (character.countryId ?? "US") as CountryId;

    /*
     * Office holding lives in electedOfficials (keyed by characterId), not
     * character.currentOffice (which is vestigial — never populated in live
     * data). Head-of-government status comes from the canonical resolver
     * (electedOfficials for presidential, governmentFormations.pmCharacterId
     * for parliamentary/one-party systems).
     */
    const officeRows = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ characterId: character._id })
      .project<{ officeType: string }>({ officeType: 1 })
      .toArray();
    const officeTypes = officeRows.map((r) => r.officeType);

    const hogCharId = await getHeadOfGovernmentCharacterId(db, country);
    const isHead = hogCharId != null && hogCharId.equals(character._id);

    const { roles, officeName, isHeadOfGovernment } = buildSyncRoleTokens({
      countryId: country,
      officeTypes,
      partyName,
      isHeadOfGovernment: isHead,
      isCentralBankChair,
      isCeo,
      isInvestor,
      investorRank: rank,
    });

    return NextResponse.json({
      found: true,
      discordId,
      characterName: character.name,
      roles,
      details: {
        party: partySlug,
        partyName,
        partyColor,
        country,
        office: officeTypes[0] ?? null,
        officeName,
        isHeadOfGovernment,
        isCentralBankChair,
        isCeo,
        isInvestor,
        portfolioValue,
        investorRank: rank,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/discord-bot/sync-roles — Returns roles for all linked Discord users in a single bulk response for periodic full syncs.
// Auth: requireAdminOrApiKey
// Errors: 401, 429
export async function POST(request: Request) {
  try {
    if (!requireBotToken(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit("discord-bot-sync", 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const db = await getDb();

    // Find all users with Discord linked
    const linkedUsers = await db
      .collection<User>("users")
      .find({ discordId: { $exists: true, $ne: "" } })
      .project<{ _id: import("mongodb").ObjectId; discordId: string }>({
        _id: 1,
        discordId: 1,
      })
      .toArray();

    if (linkedUsers.length === 0) {
      return NextResponse.json({ users: [] });
    }

    const userIds = linkedUsers.map((u) => u._id);
    const discordIdMap = new Map(linkedUsers.map((u) => [u._id.toString(), u.discordId]));

    // Fetch all characters for linked users
    const characters = await db
      .collection<Character>("characters")
      .find({ userId: { $in: userIds } })
      .toArray();

    // Fetch all corporations (for CEO and investor checks) + FX rates for
    // anchor-normalized cross-corp wealth summation (v0.2.6).
    const [corporations, bulkFxByCurrency] = await Promise.all([
      db
        .collection<Corporation>("corporations")
        .find({})
        .project<{
          _id: import("mongodb").ObjectId;
          ceoId: import("mongodb").ObjectId;
          ceoVacant?: boolean;
          shareholders: Array<{ characterId: import("mongodb").ObjectId; shares: number }>;
          sharePrice: number;
          liquidCurrencyCode?: string;
          countryId?: string;
        }>({
          _id: 1,
          ceoId: 1,
          ceoVacant: 1,
          shareholders: 1,
          sharePrice: 1,
          liquidCurrencyCode: 1,
          countryId: 1,
        })
        .toArray(),
      loadFxRatesByCurrency(db),
    ]);

    // Build CEO and investor sets + portfolio values
    const ceoCharIds = new Set(
      corporations.filter((c) => c.ceoId != null && !c.ceoVacant).map((c) => c.ceoId!.toString())
    );
    const bulkPortfolioValues = new Map<string, number>();
    for (const corp of corporations) {
      const price = corp.sharePrice ?? 0;
      if (price <= 0) continue;
      const corpFxRate = fxRateForCorpFromMap(corp, bulkFxByCurrency);
      for (const sh of corp.shareholders ?? []) {
        // Mirror the GET guard (commit aa126a15f) — some shareholder entries
        // have a null characterId (legacy "imperial shareholders" data), and
        // .toString() on null throws a 500 for every bulk caller.
        if (sh.shares > 0 && sh.characterId) {
          const cid = sh.characterId.toString();
          const local = sh.shares * price;
          bulkPortfolioValues.set(
            cid,
            (bulkPortfolioValues.get(cid) ?? 0) + corpLiquidCapitalToAnchor(local, corp, corpFxRate)
          );
        }
      }
    }

    // Top 3 investor ranking
    const bulkSorted = [...bulkPortfolioValues.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    const bulkInvestorRankMap = new Map<string, number>();
    bulkSorted.forEach(([id], idx) => bulkInvestorRankMap.set(id, idx + 1));

    // Build chair-character set once so each character's chair role check is O(1).
    const chairBanks = await db
      .collection("centralBanks")
      .find({ chairCharacterId: { $ne: null } }, { projection: { chairCharacterId: 1 } })
      .toArray();
    const chairCharIds = new Set(
      chairBanks
        .map((b) => (b.chairCharacterId as import("mongodb").ObjectId | null)?.toString())
        .filter((id): id is string => !!id)
    );

    // Fetch party names and colors - use countryId:sequentialId as key to handle same sequentialId in different countries
    const partyLookups: { countryId: CountryId; sequentialId: number }[] = [];
    for (const c of characters) {
      if (c.party && c.party !== "independent") {
        const seqId = Number(c.party);
        if (!isNaN(seqId)) {
          partyLookups.push({
            countryId: (c.countryId ?? "US") as CountryId,
            sequentialId: seqId,
          });
        }
      }
    }
    const parties = partyLookups.length
      ? await db
          .collection<PoliticalParty>("politicalParties")
          .find({
            $or: partyLookups.map((l) => ({
              countryId: l.countryId,
              sequentialId: l.sequentialId,
            })),
          })
          .project<{ countryId: CountryId; sequentialId: number; name: string; color?: string }>({
            countryId: 1,
            sequentialId: 1,
            name: 1,
            color: 1,
          })
          .toArray()
      : [];
    // Key by countryId:sequentialId - store both name and color
    const partyInfoMap = new Map(
      parties.map((p) => [
        `${p.countryId}:${p.sequentialId}`,
        { name: p.name, color: p.color ?? null },
      ])
    );

    /*
     * Office holding lives in electedOfficials (keyed by characterId), not the
     * vestigial character.currentOffice. Load every player-held row once and
     * index by characterId so each character's office lookup is O(1).
     */
    const officeRows = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ characterId: { $ne: null } })
      .project<{ characterId: import("mongodb").ObjectId; officeType: string }>({
        characterId: 1,
        officeType: 1,
      })
      .toArray();
    const officeTypesByChar = new Map<string, string[]>();
    for (const row of officeRows) {
      const key = row.characterId.toString();
      const list = officeTypesByChar.get(key) ?? [];
      list.push(row.officeType);
      officeTypesByChar.set(key, list);
    }

    /*
     * Head-of-government charIds, resolved once per country via the canonical
     * helper (presidential → electedOfficials; parliamentary/one-party →
     * governmentFormations.pmCharacterId). Bounded to COUNTRY_ORDER, so no
     * per-character query fan-out.
     */
    const hogCharIds = new Set<string>();
    for (const c of COUNTRY_ORDER) {
      const id = await getHeadOfGovernmentCharacterId(db, c);
      if (id) hogCharIds.add(id.toString());
    }

    const users = characters.map((char) => {
      const discordId = discordIdMap.get(char.userId.toString());
      const charId = char._id.toString();
      const country = char.countryId ?? "US";
      const isCeo = ceoCharIds.has(charId);
      const isInvestor = bulkPortfolioValues.has(charId);
      const investorRank = bulkInvestorRankMap.get(charId) ?? null;

      // Look up party info using countryId:sequentialId key
      // If party not found, default to Independent (not numeric fallback)
      let charPartySlug = "independent";
      let charPartyName = "Independent";
      let charPartyColor: string | null = null;

      if (char.party && char.party !== "independent") {
        const partyKey = `${country}:${char.party}`;
        const partyInfo = partyInfoMap.get(partyKey);
        if (partyInfo) {
          charPartySlug = char.party;
          charPartyName = partyInfo.name;
          charPartyColor = partyInfo.color;
        }
        // If party not found in map, keep as Independent to avoid numeric role names
      }

      const isChairBulk = chairCharIds.has(charId);
      const charOfficeTypes = officeTypesByChar.get(charId) ?? [];
      const { roles, officeName, isHeadOfGovernment } = buildSyncRoleTokens({
        countryId: country as CountryId,
        officeTypes: charOfficeTypes,
        partyName: charPartyName,
        isHeadOfGovernment: hogCharIds.has(charId),
        isCentralBankChair: isChairBulk,
        isCeo,
        isInvestor,
        investorRank,
      });

      return {
        discordId,
        characterName: char.name,
        roles,
        details: {
          party: charPartySlug,
          partyName: charPartyName,
          partyColor: charPartyColor,
          country,
          office: charOfficeTypes[0] ?? null,
          officeName,
          isHeadOfGovernment,
          isCentralBankChair: isChairBulk,
          isCeo,
          isInvestor,
          portfolioValue: bulkPortfolioValues.get(charId) ?? 0,
          investorRank,
        },
      };
    });

    return NextResponse.json({ users });
  } catch (error) {
    return handleRouteError(error);
  }
}
