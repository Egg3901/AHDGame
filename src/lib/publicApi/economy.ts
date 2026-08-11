import type { Db, Filter } from "mongodb";
import type { CentralBank } from "@/lib/db/types";
import type { StockExchangeSnapshot } from "@/lib/db/types";
import type { ElectedOfficial, PoliticalParty, Bill } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { getCountryState } from "@/lib/countryState";
import { getExchangeApiKey } from "@/lib/constants/exchangeRegistry";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://ahousedividedgame.com";
const HISTORY_CAP = 12;

export async function queryCountrySummary(db: Db, country: string) {
  const countryConfig = COUNTRY_CONFIGS[country as CountryId];
  if (!countryConfig) return null;

  const [executive, parties, officials, gfDoc] = await Promise.all([
    db.collection<ElectedOfficial>("electedOfficials").findOne({
      countryId: country,
      officeType: {
        $in: ["president", "prime_minister", "primeMinister", "chancellor", "taoiseach"],
      },
    } as Filter<ElectedOfficial>),
    db
      .collection<PoliticalParty>("politicalParties")
      .find({ countryId: country } as Filter<PoliticalParty>)
      .toArray(),
    db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ countryId: country } as Filter<ElectedOfficial>)
      .toArray(),
    getGovernmentFormationsCollection(db).findOne({ countryId: country as CountryId }),
  ]);

  const currentLeader = executive
    ? {
        name: executive.characterName ?? null,
        party: executive.party ?? null,
        profileUrl: executive.characterId ? `${BASE_URL}/character/${executive.characterId}` : null,
      }
    : null;

  const partyMap = new Map(parties.map((p) => [String(p.sequentialId), p]));

  const seatCounts = new Map<string, number>();
  for (const official of officials) {
    if (official.party) seatCounts.set(official.party, (seatCounts.get(official.party) ?? 0) + 1);
  }
  const totalSeats = officials.length;

  const legislatureComposition = [...seatCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([partySeqId, seats]) => {
      const p = partyMap.get(partySeqId);
      return {
        partyId: p?._id?.toString() ?? partySeqId,
        partyName: p?.name ?? partySeqId,
        partyColor: p?.color ?? "#666666",
        seats,
        seatPct: totalSeats > 0 ? Math.round((seats / totalSeats) * 1000) / 10 : 0,
      };
    });

  const lastElectionCycle = gfDoc
    ? (((gfDoc as Record<string, unknown>).cycle as number | undefined) ?? null)
    : null;

  // Public API exposes runtime governmentType so a post-Stage-4 country
  // shows its new regime.
  const runtime = await getCountryState(db, country as CountryId);
  return {
    found: true,
    countryId: country,
    name: countryConfig.name,
    governmentType: runtime.governmentType,
    population: (countryConfig as unknown as Record<string, unknown>).population as
      number | null | undefined,
    currentLeader,
    legislatureComposition,
    lastElectionCycle,
  };
}

export async function queryCountryEconomy(db: Db, country: string) {
  const countryConfig = COUNTRY_CONFIGS[country as CountryId];
  if (!countryConfig) return null;

  const exchangeApiKey = getExchangeApiKey(country as CountryId);

  const [centralBank, snapshot] = await Promise.all([
    db
      .collection<CentralBank>("centralBanks")
      .findOne({ countryId: country } as Filter<CentralBank>),
    exchangeApiKey
      ? db
          .collection<StockExchangeSnapshot>("stockExchangeSnapshots")
          .findOne({ _id: exchangeApiKey as unknown as StockExchangeSnapshot["_id"] })
      : Promise.resolve(null),
  ]);

  const rateHistory = (centralBank?.interestRateHistory ?? []).slice(-HISTORY_CAP);
  const inflationHistory = (centralBank?.inflationHistory ?? []).slice(-HISTORY_CAP);
  const gdpGrowthHistory = (centralBank?.gdpGrowthHistory ?? []).slice(-HISTORY_CAP);

  const latestInflation = inflationHistory.at(-1)?.rate ?? null;
  const latestGdpGrowth = gdpGrowthHistory.at(-1)?.rate ?? null;

  const listings = snapshot?.listings ?? [];
  const totalMarketCap = listings.reduce((sum, l) => sum + (l.marketCap ?? 0), 0);
  const weightedChange1h = listings.reduce(
    (sum, l) => sum + (l.priceChange1h ?? 0) * (l.marketCap ?? 0),
    0
  );
  const weightedChange24h = listings.reduce(
    (sum, l) => sum + (l.priceChange24h ?? 0) * (l.marketCap ?? 0),
    0
  );

  const stockMarket = {
    totalMarketCap,
    change1h: totalMarketCap > 0 ? Math.round((weightedChange1h / totalMarketCap) * 100) / 100 : 0,
    change24h:
      totalMarketCap > 0 ? Math.round((weightedChange24h / totalMarketCap) * 100) / 100 : 0,
    exchange: snapshot?.exchangeName ?? countryConfig.exchangeName ?? null,
  };

  return {
    found: true,
    countryId: country,
    primeRate: centralBank?.primeRate ?? null,
    inflation: latestInflation,
    gdpGrowth: latestGdpGrowth,
    chair: centralBank?.chairCharacterName
      ? {
          name: centralBank.chairCharacterName,
          profileUrl: centralBank.chairCharacterId
            ? `${BASE_URL}/character/${centralBank.chairCharacterId}`
            : null,
        }
      : null,
    rateHistory: rateHistory.map((s) => ({ turn: s.turn, rate: s.rate })),
    inflationHistory: inflationHistory.map((s) => ({ turn: s.turn, rate: s.rate })),
    gdpGrowthHistory: gdpGrowthHistory.map((s) => ({ turn: s.turn, rate: s.rate })),
    stockMarket,
  };
}

export async function queryLegislature(db: Db, country: string) {
  const countryConfig = COUNTRY_CONFIGS[country as CountryId];
  if (!countryConfig) return null;

  const chamberName = (countryConfig as unknown as Record<string, unknown>).legislature as
    { lowerChamber?: { name?: string } } | undefined;

  const [officials, parties, pendingBills, recentlyPassed] = await Promise.all([
    db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ countryId: country } as Filter<ElectedOfficial>)
      .toArray(),
    db
      .collection<PoliticalParty>("politicalParties")
      .find({ countryId: country } as Filter<PoliticalParty>)
      .toArray(),
    db
      .collection<Bill>("bills")
      .find({
        countryId: country,
        status: { $in: ["floor_vote", "other_chamber"] },
      } as unknown as Filter<Bill>)
      .sort({ proposedAt: -1 })
      .limit(5)
      .toArray(),
    db
      .collection<Bill>("bills")
      .find({
        countryId: country,
        status: { $in: ["enacted", "passed"] },
      } as unknown as Filter<Bill>)
      .sort({ enactedAt: -1 })
      .limit(5)
      .toArray(),
  ]);

  const partyMap = new Map(parties.map((p) => [String(p.sequentialId), p]));
  const seatCounts = new Map<string, number>();
  for (const official of officials) {
    if (official.party) seatCounts.set(official.party, (seatCounts.get(official.party) ?? 0) + 1);
  }
  const totalSeats = officials.length;

  const composition = [...seatCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([partySeqId, seats]) => {
      const p = partyMap.get(partySeqId);
      return {
        partyId: p?._id?.toString() ?? partySeqId,
        partyName: p?.name ?? partySeqId,
        partyColor: p?.color ?? "#666666",
        seats,
      };
    });

  return {
    found: true,
    countryId: country,
    chamber: chamberName?.lowerChamber?.name ?? "Legislature",
    totalSeats,
    composition,
    pendingBills: pendingBills.map((b) => ({
      id: b._id.toString(),
      title: b.title,
      status: b.status,
      sponsor: b.sponsorName ?? null,
      scheduledVoteAt: b.votingEndsAt?.toISOString() ?? null,
    })),
    recentlyPassed: recentlyPassed.map((b) => ({
      id: b._id.toString(),
      title: b.title,
      passedAt: b.enactedAt?.toISOString() ?? b.passedOriginAt?.toISOString() ?? null,
      vote: { yes: b.votesFor ?? 0, no: b.votesAgainst ?? 0 },
    })),
  };
}
