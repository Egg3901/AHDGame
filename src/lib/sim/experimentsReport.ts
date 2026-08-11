import { readFileSync } from "fs";
import { join } from "path";
import type { Db } from "mongodb";
import type { PoliticalParty } from "@/lib/db/types/party";
import type { NPP } from "@/lib/db/types/npp";
import type { ElectedOfficial } from "@/lib/db/types";
import type { Corporation } from "@/lib/db/types";
import type { GameState } from "@/lib/db/types/gameState";
import {
  collectBalanceMetrics,
  computeNppWealthAnchorMap,
  computeNppWarChestAnchorMap,
  type BalanceReport,
} from "@/lib/sim/metrics";
import { NPP_FUND_INVESTMENT_INTERVAL } from "@/lib/indexFunds/nppInvesting";
import {
  corpLiquidCapitalToAnchor,
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
} from "@/lib/currency/corporationCapital";

// Static sim-harness parameters — the "conditions we specified" for a run.
// Source-of-truth lives in scripts/sim/runWorld.ts (country allowlist,
// perSectorCount) and src/lib/turn/corporation/nppInsolvencyDissolution.ts
// (dissolution threshold); mirrored here so the report is self-documenting.
// Keep in sync if those change.
const HARNESS = {
  countries: ["US", "UK", "DE", "JP", "CN", "BR", "NG", "IE"],
  corpsPerSector: 3,
  fundInvestmentInterval: NPP_FUND_INVESTMENT_INTERVAL,
  insolvencyThresholdAnchor: -1_000_000,
};

/**
 * Deterministic (non-LLM), data-only report over a sim run's full turn
 * history. Produces the timelines the ops-dashboard report renders —
 * seats/party-org/corporations per turn — PLUS the four things a first draft
 * was missing and the user (rightly) called out:
 *
 *  1. `parties` — a countryId+partyId → {name, abbreviation, color} directory
 *     so the front-end can resolve "US:1" to "Democratic Party" instead of an
 *     opaque id. Both seatsTimeline.party and partyOrgTimeline.partyId are the
 *     party's `sequentialId` as a string (see snapshotParliamentSeats /
 *     snapshotPartyHistory), which is exactly this directory's key.
 *  2. `governmentTimeline` — plurality party in each country's primary
 *     legislative chamber, per turn. Answers "is one party perpetually in
 *     power or does control actually change hands?" — derived here rather than
 *     in the front-end so the report doc is self-describing.
 *  3. `wealthLeaders` — the richest NPPs (anchor-converted, via the SAME
 *     source-of-truth wealth map the aggregate Gini metric uses) WITH
 *     attribution: office held, corp they run as CEO, and how many corps they
 *     hold stock in. "Who is richest and why", not just a number.
 *  4. `topCorporations` — the biggest corps by anchor market cap, with country,
 *     sector, CEO name, and solvency — a cross-country-comparable league table
 *     (raw local-currency market caps are not comparable, same FX trap as the
 *     NPP wealth bug).
 */

export interface SeatsTimelinePoint {
  turn: number;
  countryId: string;
  officeType: string;
  party: string;
  seats: number;
}

export interface PartyOrgTimelinePoint {
  turn: number;
  countryId: string;
  partyId: string;
  organization: number;
  playerCount: number;
  nppCount: number;
  memberCount: number;
}

export interface CorporationsTimelinePoint {
  turn: number;
  countryId: string;
  corpCount: number;
  totalMarketCapAnchor: number;
  totalLiquidCapitalAnchor: number;
}

export interface PartyInfo {
  countryId: string;
  partyId: string; // sequentialId as string — the timeline join key
  name: string;
  abbreviation: string;
  color: string;
}

export interface GovernmentControlPoint {
  turn: number;
  countryId: string;
  officeType: string; // the chamber this plurality is measured over
  governingParty: string; // sequentialId string; join against `parties`
  seats: number; // the governing party's seats
  totalSeats: number; // chamber total that turn — lets the UI show a share
}

export interface WealthLeader {
  nppId: string;
  name: string;
  countryId: string;
  party: string; // sequentialId string; join against `parties`
  /** Personal net worth in ₳: personal + savings + investment portfolio.
   *  EXCLUDES the campaign war chest (see wealthAnchor vs warChestAnchor). */
  wealthAnchor: number;
  /** Campaign war chest (`npp.funds`) in ₳ — political money, shown separately. */
  warChestAnchor: number;
  /** Highest office currently held (e.g. "primeMinister", "house"), or null. */
  office: string | null;
  /** Corp this NPP runs as CEO (its name), or null if not a CEO. */
  ceoOfCorp: string | null;
  /** How many distinct corporations this NPP holds shares in. */
  stockPositionCount: number;
}

export interface TopCorporation {
  corpId: string;
  sequentialId: number | null;
  name: string;
  countryId: string;
  sector: string | null;
  ceoName: string | null;
  marketCapAnchor: number;
  liquidCapitalAnchor: number;
  insolvent: boolean;
}

export interface RunConfig {
  // Provenance filled in by the CLI (collectExperimentReport.ts), which has the
  // control-plane job doc + shell access. Optional here for that reason.
  seed?: string;
  turns?: number;
  jobId?: string;
  gitCommit?: string;
  gitDirty?: boolean;
  mcpVersion?: string;
  // Captured from the sandbox world / app by the collector below.
  appVersion: string;
  preset: string;
  nppAutonomyLevel: string;
  turnRange: { from: number; to: number };
  crisisSpawnMultiplier: number;
  featureFlags: Record<string, boolean>;
  // Static harness parameters (the conditions we specified).
  countries: string[];
  corpsPerSector: number;
  fundInvestmentInterval: number;
  insolvencyThresholdAnchor: number;
}

function readAppVersion(): string {
  // Collector runs from the game-repo root (worker/CLI cwd); read its version.
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

function collectRunConfig(
  gs: GameState | null,
  turnRange: { from: number; to: number }
): RunConfig {
  const flagKeys = [
    "autoDisastersEnabled",
    "crisisAidBillsEnabled",
    "conflictsEnabled",
    "coldWarEnabled",
    "autoSectorSeedEnabled",
    "sectorTechTreesEnabled",
  ] as const;
  const featureFlags: Record<string, boolean> = {};
  for (const k of flagKeys) featureFlags[k] = Boolean((gs as Record<string, unknown> | null)?.[k]);
  return {
    appVersion: readAppVersion(),
    preset: gs?.preset ?? "unknown",
    nppAutonomyLevel: gs?.nppAutonomyLevel ?? "unknown",
    turnRange,
    crisisSpawnMultiplier:
      typeof gs?.crisisSpawnChanceMultiplier === "number" ? gs.crisisSpawnChanceMultiplier : 1,
    featureFlags,
    countries: HARNESS.countries,
    corpsPerSector: HARNESS.corpsPerSector,
    fundInvestmentInterval: HARNESS.fundInvestmentInterval,
    insolvencyThresholdAnchor: HARNESS.insolvencyThresholdAnchor,
  };
}

export interface ExperimentsReport {
  turn: number;
  runConfig: RunConfig;
  seatsTimeline: SeatsTimelinePoint[];
  partyOrgTimeline: PartyOrgTimelinePoint[];
  corporationsTimeline: CorporationsTimelinePoint[];
  parties: PartyInfo[];
  governmentTimeline: GovernmentControlPoint[];
  wealthLeaders: WealthLeader[];
  topCorporations: TopCorporation[];
  finalMetrics: BalanceReport;
}

const WEALTH_LEADER_COUNT = 25;
const TOP_CORP_COUNT = 25;

// Office-held attribution priority for a wealth leader (highest wins).
const OFFICE_PRIORITY: string[] = [
  "president",
  "primeMinister",
  "vicePresident",
  "governor",
  "senate",
  "commons",
  "house",
  "stateSenate",
  "regionalCouncil",
];

/**
 * Plurality party in EACH chamber/office, per (country, officeType, turn).
 *
 * Emits a point for every distinct office a country holds elections for — the
 * national legislature(s), the executive (president = a 1-seat "chamber" whose
 * plurality is simply the party holding it), and the governors/state-executive
 * aggregate (plurality = the party controlling the most of them). The report
 * RENDERER decides which of these to surface per country and how to label them
 * (US → President/House/Senate/Governors; UK → Commons/Lords; …). This stays
 * deliberately generic and does NOT try to guess a single "primary chamber" —
 * an earlier max-total-seats heuristic wrongly picked appointed/sub-national
 * bodies (UK Lords ≈ 784 seats > Commons 650; US stateSenate ≈ 1923 across 50
 * states > the 435-seat federal House), which is exactly the mis-selection the
 * per-chamber emit avoids.
 */
function deriveGovernmentTimeline(seats: SeatsTimelinePoint[]): GovernmentControlPoint[] {
  // (country, officeType, turn) -> party -> seats.   join avoids any
  // ambiguity if an id ever contained a ':'.
  const perKey = new Map<string, Map<string, number>>();
  for (const s of seats) {
    const key = `${s.countryId} ${s.officeType} ${s.turn}`;
    let byParty = perKey.get(key);
    if (!byParty) perKey.set(key, (byParty = new Map()));
    byParty.set(s.party, (byParty.get(s.party) ?? 0) + s.seats);
  }

  const out: GovernmentControlPoint[] = [];
  for (const [key, byParty] of perKey) {
    const [countryId, officeType, turnStr] = key.split(" ");
    let winner: string | null = null;
    let winnerSeats = -1;
    let totalSeats = 0;
    for (const [party, seatCount] of byParty) {
      totalSeats += seatCount;
      if (seatCount > winnerSeats) {
        winnerSeats = seatCount;
        winner = party;
      }
    }
    if (winner) {
      out.push({
        turn: Number(turnStr),
        countryId,
        officeType,
        governingParty: winner,
        seats: winnerSeats,
        totalSeats,
      });
    }
  }
  return out.sort(
    (a, b) =>
      a.turn - b.turn ||
      a.countryId.localeCompare(b.countryId) ||
      a.officeType.localeCompare(b.officeType)
  );
}

async function collectWealthLeaders(db: Db, parties: PartyInfo[]): Promise<WealthLeader[]> {
  void parties; // name-join happens in the front-end via the `parties` directory.
  const npps = await db
    .collection<NPP>("npps")
    .find(
      { retiredAt: null },
      {
        projection: {
          name: 1,
          countryId: 1,
          party: 1,
          funds: 1,
          currencyBalances: 1,
          nppInvestmentCashAnchor: 1,
        },
      }
    )
    .toArray();
  if (npps.length === 0) return [];

  const [wealthMap, warChestMap] = await Promise.all([
    computeNppWealthAnchorMap(db, npps),
    computeNppWarChestAnchorMap(db, npps),
  ]);
  // Rank by PERSONAL net worth (funds/war-chest excluded — see the metric).
  const top = [...npps]
    .sort((a, b) => (wealthMap.get(String(b._id)) ?? 0) - (wealthMap.get(String(a._id)) ?? 0))
    .slice(0, WEALTH_LEADER_COUNT);
  const topIds = top.map((n) => n._id);

  // Attribution — only for the top NPPs, so these are tiny scoped queries.
  const [officials, ceoCorps, stockCorps] = await Promise.all([
    db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ nppId: { $in: topIds } }, { projection: { nppId: 1, officeType: 1 } })
      .toArray(),
    db
      .collection<Corporation>("corporations")
      .find({ ceoType: "npp", ceoId: { $in: topIds } }, { projection: { ceoId: 1, name: 1 } })
      .toArray(),
    db
      .collection<Corporation>("corporations")
      .find({ "shareholders.nppId": { $in: topIds } }, { projection: { shareholders: 1 } })
      .toArray(),
  ]);

  const officeByNpp = new Map<string, string>();
  for (const o of officials) {
    if (!o.nppId) continue;
    const key = String(o.nppId);
    const cur = officeByNpp.get(key);
    const better =
      !cur ||
      (OFFICE_PRIORITY.indexOf(o.officeType) >= 0 &&
        (OFFICE_PRIORITY.indexOf(o.officeType) < OFFICE_PRIORITY.indexOf(cur) ||
          OFFICE_PRIORITY.indexOf(cur) < 0));
    if (better) officeByNpp.set(key, o.officeType);
  }

  const ceoByNpp = new Map<string, string>();
  for (const c of ceoCorps) if (c.ceoId) ceoByNpp.set(String(c.ceoId), c.name);

  const stockCountByNpp = new Map<string, number>();
  for (const c of stockCorps) {
    const holders = new Set<string>();
    for (const sh of c.shareholders ?? []) {
      if (sh.nppId) holders.add(String(sh.nppId));
    }
    for (const id of holders) stockCountByNpp.set(id, (stockCountByNpp.get(id) ?? 0) + 1);
  }

  return top.map((n) => {
    const key = String(n._id);
    return {
      nppId: key,
      name: n.name,
      countryId: n.countryId ?? "US",
      party: n.party ?? "independent",
      wealthAnchor: Math.round(wealthMap.get(key) ?? 0),
      warChestAnchor: Math.round(warChestMap.get(key) ?? 0),
      office: officeByNpp.get(key) ?? null,
      ceoOfCorp: ceoByNpp.get(key) ?? null,
      stockPositionCount: stockCountByNpp.get(key) ?? 0,
    };
  });
}

async function collectTopCorporations(db: Db): Promise<TopCorporation[]> {
  const corps = await db
    .collection<Corporation>("corporations")
    .find(
      { countryOwnerId: { $exists: false }, suspended: { $ne: true } },
      {
        projection: {
          name: 1,
          sequentialId: 1,
          countryId: 1,
          ceoId: 1,
          ceoType: 1,
          type: 1,
          totalShares: 1,
          sharePrice: 1,
          liquidCapital: 1,
          liquidCurrencyCode: 1,
        },
      }
    )
    .toArray();
  if (corps.length === 0) return [];

  const fxByCurrency = await loadFxRatesByCurrency(db);
  const ranked = corps
    .map((c) => {
      const fx = fxRateForCorpFromMap(c, fxByCurrency);
      const marketCapLocal = (c.totalShares ?? 0) * (c.sharePrice ?? 0);
      const marketCapAnchor = corpLiquidCapitalToAnchor(marketCapLocal, c, fx);
      const liquidCapitalAnchor = corpLiquidCapitalToAnchor(c.liquidCapital ?? 0, c, fx);
      return { corp: c, marketCapAnchor, liquidCapitalAnchor };
    })
    .sort((a, b) => b.marketCapAnchor - a.marketCapAnchor)
    .slice(0, TOP_CORP_COUNT);

  // Resolve CEO names for NPP-run corps in one scoped query.
  const ceoIds = ranked.map((r) => r.corp.ceoId).filter((id): id is NonNullable<typeof id> => !!id);
  const ceoNpps =
    ceoIds.length > 0
      ? await db
          .collection<NPP>("npps")
          .find({ _id: { $in: ceoIds } }, { projection: { name: 1 } })
          .toArray()
      : [];
  const ceoNameById = new Map(ceoNpps.map((n) => [String(n._id), n.name]));

  return ranked.map(({ corp, marketCapAnchor, liquidCapitalAnchor }) => ({
    corpId: String(corp._id),
    sequentialId: corp.sequentialId ?? null,
    name: corp.name,
    countryId: corp.countryId,
    sector: corp.type ?? null,
    ceoName: corp.ceoId ? (ceoNameById.get(String(corp.ceoId)) ?? null) : null,
    marketCapAnchor: Math.round(marketCapAnchor),
    liquidCapitalAnchor: Math.round(liquidCapitalAnchor),
    insolvent: liquidCapitalAnchor < 0,
  }));
}

export async function collectExperimentsReport(db: Db): Promise<ExperimentsReport> {
  const [seatsRows, partyOrgRows, corpRows, partyRows, finalMetrics, gameStateDoc] =
    await Promise.all([
      db
        .collection("parliamentSeatsHistory")
        .find({}, { projection: { _id: 0, createdAt: 0 } })
        .sort({ turn: 1 })
        .toArray(),
      db
        .collection("partyHistory")
        .find({}, { projection: { _id: 0, createdAt: 0 } })
        .sort({ turn: 1 })
        .toArray(),
      db
        .collection("corporationCountryHistory")
        .find({}, { projection: { _id: 0, createdAt: 0 } })
        .sort({ turn: 1 })
        .toArray(),
      db
        .collection<PoliticalParty>("politicalParties")
        .find(
          {},
          { projection: { sequentialId: 1, countryId: 1, name: 1, abbreviation: 1, color: 1 } }
        )
        .toArray(),
      collectBalanceMetrics(db),
      db.collection<GameState>("gameState").findOne({ _id: "current" }),
    ]);

  const parties: PartyInfo[] = partyRows.map((p) => ({
    countryId: p.countryId,
    partyId: String(p.sequentialId),
    name: p.name,
    abbreviation: p.abbreviation,
    color: p.color,
  }));

  const seatsTimeline = seatsRows as unknown as SeatsTimelinePoint[];

  // Report window = span of the retained snapshot history.
  const turnNums = seatsTimeline.map((s) => s.turn);
  const turnRange = {
    from: turnNums.length ? Math.min(...turnNums) : finalMetrics.turn,
    to: finalMetrics.turn,
  };
  const runConfig = collectRunConfig(gameStateDoc, turnRange);

  // Wealth leaders + top corporations read live end-state (not history) — run
  // concurrently, independent of the timeline reshaping above.
  const [wealthLeaders, topCorporations] = await Promise.all([
    collectWealthLeaders(db, parties),
    collectTopCorporations(db),
  ]);

  return {
    turn: finalMetrics.turn,
    runConfig,
    seatsTimeline,
    partyOrgTimeline: partyOrgRows as unknown as PartyOrgTimelinePoint[],
    corporationsTimeline: corpRows as unknown as CorporationsTimelinePoint[],
    parties,
    governmentTimeline: deriveGovernmentTimeline(seatsTimeline),
    wealthLeaders,
    topCorporations,
    finalMetrics,
  };
}
