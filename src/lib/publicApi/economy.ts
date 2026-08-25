import type { Db, Filter } from "mongodb";
import type { CentralBank } from "@/lib/db/types";
import type { StockExchangeSnapshot } from "@/lib/db/types";
import type { ElectedOfficial, PoliticalParty, Bill } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { getCountryState } from "@/lib/countryState";
import { getExchangeApiKey } from "@/lib/constants/exchangeRegistry";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import type { FederalBudget } from "@/lib/db/types/budget";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { aggregateExchangeTotals } from "@/lib/stockExchange/aggregate";

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

  const [centralBank, snapshot, budget] = await Promise.all([
    db
      .collection<CentralBank>("centralBanks")
      .findOne({ countryId: country } as Filter<CentralBank>),
    exchangeApiKey
      ? db
          .collection<StockExchangeSnapshot>("stockExchangeSnapshots")
          .findOne({ _id: exchangeApiKey as unknown as StockExchangeSnapshot["_id"] })
      : Promise.resolve(null),
    db
      .collection<FederalBudget>("federalBudget")
      .findOne(
        { _id: getNationalBudgetId(country as CountryId) },
        { projection: { "economicFactors.inflationRate": 1 } }
      ),
  ]);

  const rateHistory = (centralBank?.interestRateHistory ?? []).slice(-HISTORY_CAP);
  const inflationHistory = (centralBank?.inflationHistory ?? []).slice(-HISTORY_CAP);
  const gdpGrowthHistory = (centralBank?.gdpGrowthHistory ?? []).slice(-HISTORY_CAP);

  // `centralBanks.inflationHistory` is a per-turn COPY of this budget field
  // (interestRateSnapshot.ts), so the budget is the source and the history is a
  // chart series. Reading the copy returned null for the three countries that
  // hold a budget but no central bank, while the site showed a real rate.
  const budgetInflation = budget?.economicFactors?.inflationRate;
  const latestInflation =
    typeof budgetInflation === "number" && Number.isFinite(budgetInflation)
      ? budgetInflation
      : (inflationHistory.at(-1)?.rate ?? null);
  const latestGdpGrowth = gdpGrowthHistory.at(-1)?.rate ?? null;

  // Anchored totals, matching the stock market page and the Economy page card.
  // The raw sum added currencies together. See lib/stockExchange/aggregate.
  const listings = snapshot?.listings ?? [];
  const totals = aggregateExchangeTotals(listings);

  const stockMarket = {
    totalMarketCap: totals.marketCap,
    change1h: Math.round(totals.weightedChange1h * 100) / 100,
    change24h: Math.round(totals.weightedChange24h * 100) / 100,
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
