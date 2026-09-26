import type { Db } from "mongodb";
import type {
  GameHealthSnapshot,
  GameHealthSummary,
  TurnWarning,
  TurnError,
  DataIntegrityResult,
  IntegrityIssue,
  PopulationStats,
  EconomyStats,
  TurnPhaseTelemetryMap,
  ElectedOfficial,
  Seat,
} from "@/lib/db/types";
import type { StateMetrics, CentralBank, SystemSettings, FederalBudget } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_ORDER, COUNTRY_CONFIGS, getOfficeTypeConfig } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { getSimulatedCountryIds } from "@/lib/countryAccess";
import { NATIONAL_SCOPE } from "@/lib/constants/nationalScope";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { getSeatIdFromElection } from "@/lib/seats";
import {
  findCountriesMissingFederalBudget,
  findFederalBudgetCountryMismatches,
} from "@/lib/turn/ensureFederalBudget";
import { summarizeGameHealth } from "@/lib/turn/rules/gameHealth";

type SeatScopedOfficial = ElectedOfficial & { seatId?: string };

/**
 * Collect game health metrics and write a snapshot document.
 * Runs as a turn phase in Group 13 (History). Purely observational — never modifies game state.
 *
 * Auth: called by turnSystem.ts during processTurn()
 * Errors: caller wraps in runPhase() for isolation
 *
 * **Currency (v0.2.6):** `byCountry[*].totalCorporationRevenue` and
 * `byCountry[*].fundCirculation` / `averagePlayerFunds` are all scoped to a
 * single country via `$match: { countryId }`, so each figure stays in that
 * country's currency (for corps: `liquidCurrencyCode`; for character funds:
 * the character's home currency). No cross-country aggregation happens here,
 * so no FX conversion is needed — the bucket currency is implied by the
 * country key. Presenters should pair each byCountry value with the country's
 * currency symbol.
 */
export async function processGameHealthSnapshot(
  db: Db,
  turn: number,
  year: number,
  durationMs: number,
  success: boolean,
  warnings: string[],
  phaseStatuses?: TurnPhaseTelemetryMap
): Promise<{ snapshotWritten: boolean; integrityCheckRan: boolean; health: GameHealthSummary }> {
  const now = new Date();
  const failureMessages = new Map<string, string>();
  for (const warning of warnings) {
    const colonIdx = warning.indexOf(": ");
    const phase = colonIdx > 0 ? warning.slice(0, colonIdx) : "unknown";
    const message = colonIdx > 0 ? warning.slice(colonIdx + 2) : warning;
    failureMessages.set(phase, message);
  }

  const snapshotPhaseStatuses: TurnPhaseTelemetryMap = Object.fromEntries(
    Object.entries(phaseStatuses ?? {}).map(([phase, telemetry]) => {
      if (phase === "gameHealthSnapshot") {
        return [
          phase,
          {
            ...telemetry,
            status: "completed",
            completedAt: now,
            updatedAt: now,
            reason: null,
            message: null,
          },
        ];
      }

      return [
        phase,
        {
          ...telemetry,
          message: failureMessages.get(phase) ?? telemetry.message,
        },
      ];
    })
  );

  const countedPhaseEntries = Object.entries(snapshotPhaseStatuses).filter(
    ([phase]) => phase !== "gameHealthSnapshot"
  );
  const skippedPhaseEntries = countedPhaseEntries.filter(
    ([, telemetry]) => telemetry.status === "skipped"
  );

  // Turn warnings (issue #2054): every entry of the turn warning channel
  // persists here exactly once. Entries follow the `"<phase>: <message>"`
  // convention (see the failureMessages parse above); entries without a
  // prefix land under "unknown". Identical phase+message pairs collapse to
  // one record, so a retried or replayed turn that re-pushes the same
  // deterministic warning cannot inflate warningCount.
  const seenWarnings = new Set<string>();
  const turnWarnings: TurnWarning[] = [];
  for (const warning of warnings) {
    const colonIdx = warning.indexOf(": ");
    const phase = colonIdx > 0 ? warning.slice(0, colonIdx) : "unknown";
    const message = colonIdx > 0 ? warning.slice(colonIdx + 2) : warning;
    const key = phase + "\n" + message;
    if (seenWarnings.has(key)) continue;
    seenWarnings.add(key);
    turnWarnings.push({ phase, message, turn, timestamp: now });
  }
  const turnErrors: TurnError[] = countedPhaseEntries
    .filter(([, telemetry]) => telemetry.status === "failed" || telemetry.status === "notReached")
    .map(([phase, telemetry]) => ({
      phase,
      message: telemetry.message ?? "Phase failed before the turn completed.",
      turn,
      timestamp: telemetry.completedAt ?? telemetry.updatedAt ?? now,
    }));

  const turnProcessing = {
    durationMs,
    success,
    phaseCount: countedPhaseEntries.length,
    phasesSkipped: skippedPhaseEntries.length,
    warningCount: turnWarnings.length,
    errorCount: turnErrors.length,
    warnings: turnWarnings,
    errors: turnErrors,
    phaseStatuses: snapshotPhaseStatuses,
  };

  // Check integrity cadence setting
  const healthConfig = await db
    .collection<SystemSettings>("systemSettings")
    .findOne({ _id: "healthConfig" });
  const cadence = healthConfig?.integrityCheckCadenceTurns ?? 1;
  const shouldRunIntegrity = turn % cadence === 0;

  // Run integrity checks if cadence matches
  let dataIntegrity: DataIntegrityResult | null = null;
  if (shouldRunIntegrity) {
    dataIntegrity = await runIntegrityChecks(db, turn, cadence);
  }

  // Collect population and economy stats in parallel
  const [population, economy] = await Promise.all([
    collectPopulationStats(db),
    collectEconomyStats(db),
  ]);
  const health = summarizeGameHealth({
    turnSuccess: success,
    processingWarningCount: turnProcessing.warningCount,
    processingErrorCount: turnProcessing.errorCount,
    integrityChecked: shouldRunIntegrity,
    integrityIssues: dataIntegrity?.issues ?? [],
  });

  // Write the snapshot
  const snapshot: Omit<GameHealthSnapshot, "_id"> = {
    turn,
    year,
    timestamp: now,
    health,
    turnProcessing,
    dataIntegrity,
    population,
    economy,
  };

  await db.collection("gameHealthSnapshots").insertOne(snapshot as GameHealthSnapshot);

  return { snapshotWritten: true, integrityCheckRan: shouldRunIntegrity, health };
}

async function runIntegrityChecks(
  db: Db,
  turn: number,
  cadence: number
): Promise<DataIntegrityResult> {
  const issues: IntegrityIssue[] = [];

  // 1. Orphaned candidates — electionCandidates where electionId has no matching election
  // (#2166): project to the join key before the $lookup so full candidate
  // documents never cross the join. The count is unchanged.
  const orphanedCandidates = await db
    .collection("electionCandidates")
    .aggregate([
      { $project: { electionId: 1 } },
      {
        $lookup: {
          from: "elections",
          localField: "electionId",
          foreignField: "_id",
          as: "election",
          // Only existence matters; never materialize the matching documents.
          pipeline: [{ $project: { _id: 1 } }, { $limit: 1 }],
        },
      },
      { $match: { election: { $size: 0 } } },
      { $count: "count" },
    ])
    .toArray();
  const orphanedCandidateCount = orphanedCandidates[0]?.count ?? 0;
  if (orphanedCandidateCount > 0) {
    issues.push({
      category: "orphanedCandidate",
      severity: "warning",
      message: `${orphanedCandidateCount} candidates reference non-existent elections`,
      collection: "electionCandidates",
    });
  }

  // 2. Orphaned officials — electedOfficials where seatId has no matching seat
  const seatIntegrity = await collectSeatIntegrity(db);
  const orphanedOfficialCount = seatIntegrity.orphanedOfficialCount;
  if (orphanedOfficialCount > 0) {
    issues.push({
      category: "orphanedOfficial",
      severity: "error",
      message: `${orphanedOfficialCount} officials could not be matched to a known seat or office configuration`,
      collection: "electedOfficials",
    });
  }

  // 3. Parties with zero members
  const hasPlayerCharacters =
    (await db.collection("characters").countDocuments({}, { limit: 1 })) > 0;
  const partiesWithoutMembers = hasPlayerCharacters
    ? await db.collection("politicalParties").countDocuments({ memberCount: 0 })
    : 0;
  if (partiesWithoutMembers > 0) {
    issues.push({
      category: "emptyParty",
      severity: "warning",
      message: `${partiesWithoutMembers} parties have zero members`,
      collection: "politicalParties",
    });
  }

  // 4. Party members referencing deleted parties
  // (#2166): project to the join key before the $lookup so full member
  // documents never cross the join. The count is unchanged.
  const membersInDeletedParties = await db
    .collection("partyMembers")
    .aggregate([
      { $project: { partyId: 1 } },
      {
        $lookup: {
          from: "politicalParties",
          localField: "partyId",
          foreignField: "_id",
          as: "party",
          // Only existence matters; never materialize the matching documents.
          pipeline: [{ $project: { _id: 1 } }, { $limit: 1 }],
        },
      },
      { $match: { party: { $size: 0 } } },
      { $count: "count" },
    ])
    .toArray();
  const membersInDeletedCount = membersInDeletedParties[0]?.count ?? 0;
  if (membersInDeletedCount > 0) {
    issues.push({
      category: "orphanedMember",
      severity: "error",
      message: `${membersInDeletedCount} party members reference non-existent parties`,
      collection: "partyMembers",
    });
  }

  // 5. Elections nearing resolution with zero candidates. Long-dated elections
  // are active for many turns before nominations open, so they are not gaps yet.
  // (#2166): project to the join key after the status match so full
  // election documents never cross the $lookup. The count is unchanged.
  const electionsWithoutCandidates = await db
    .collection("elections")
    .aggregate([
      {
        $match: {
          status: "active",
          $or: [{ endTurn: { $lte: turn + 24 } }, { endTurn: { $exists: false } }],
        },
      },
      { $project: { _id: 1 } },
      {
        $lookup: {
          from: "electionCandidates",
          localField: "_id",
          foreignField: "electionId",
          as: "candidates",
          // Only existence matters; never materialize the matching documents.
          pipeline: [{ $project: { _id: 1 } }, { $limit: 1 }],
        },
      },
      { $match: { candidates: { $size: 0 } } },
      { $count: "count" },
    ])
    .toArray();
  const electionsNoCandidatesCount = electionsWithoutCandidates[0]?.count ?? 0;
  if (electionsNoCandidatesCount > 0) {
    issues.push({
      category: "electionNoCandidates",
      severity: "warning",
      message: `${electionsNoCandidatesCount} active elections have zero candidates`,
      collection: "elections",
    });
  }

  // 6. Seats without elected officials (empty seats count)
  const seatBackedSeatsWithoutOfficials = seatIntegrity.seatBackedSeatsWithoutOfficials;

  // 7. Countries with a live central bank but no federalBudget document.
  // treasuryTurn/inflationRecalc now self-heal this via ensureFederalBudget(),
  // but a country still showing up here means the self-heal itself is failing
  // (e.g. no seed config for that country/preset) — surface it as an error
  // rather than let it go silent again.
  const missingFederalBudget = await findCountriesMissingFederalBudget(db);
  if (missingFederalBudget.length > 0) {
    issues.push({
      category: "missingFederalBudget",
      severity: "error",
      message: `${missingFederalBudget.length} countries have a centralBanks doc but no federalBudget: ${missingFederalBudget.join(", ")}`,
      collection: "federalBudget",
    });
  }

  // 8. federalBudget docs whose own `countryId` field doesn't match the
  // country its `_id` resolves to (e.g. `_id: "federal"` — US's budget by
  // convention — carrying `countryId: "BAL"`). The `_id` join key is what
  // treasuryTurn/inflationRecalc use, so those keep working, but any
  // consumer that derives country from `budget.countryId` (sovereign.ts,
  // fiscalYear.ts, corporationDetail.ts, ...) would misattribute the budget.
  const budgetCountryMismatches = await findFederalBudgetCountryMismatches(db);
  if (budgetCountryMismatches.length > 0) {
    issues.push({
      category: "federalBudgetCountryMismatch",
      severity: "error",
      message: budgetCountryMismatches
        .map(
          (m) =>
            `federalBudget "${m.budgetId}" has countryId "${m.actualCountryId}", expected "${m.expectedCountryId}"`
        )
        .join("; "),
      collection: "federalBudget",
    });
  }

  return {
    lastCheckTurn: turn,
    checkCadenceTurns: cadence,
    orphanedCandidates: orphanedCandidateCount,
    orphanedOfficials: orphanedOfficialCount,
    partiesWithoutMembers,
    membersInDeletedParties: membersInDeletedCount,
    electionsWithoutCandidates: electionsNoCandidatesCount,
    seatBackedSeatsWithoutOfficials,
    issues,
  };
}

async function collectSeatIntegrity(
  db: Db
): Promise<{ orphanedOfficialCount: number; seatBackedSeatsWithoutOfficials: number }> {
  const [seats, officials] = await Promise.all([
    db
      .collection<Seat>("seats")
      .find({}, { projection: { _id: 1, countryId: 1, electionType: 1, state: 1 } })
      .toArray(),
    db
      .collection<SeatScopedOfficial>("electedOfficials")
      .find(
        {},
        {
          projection: {
            countryId: 1,
            officeType: 1,
            state: 1,
            senateClass: 1,
            chamberClass: 1,
            seatId: 1,
            seatsHeld: 1,
          },
        }
      )
      .toArray(),
  ]);

  const knownSeatIds = new Set(seats.map((seat) => seat._id));
  const seatBackedOfficeKeys = new Set(
    seats.map((seat) => `${seat.countryId}:${seat.electionType}`)
  );
  const seatBackedRegionKeys = new Set(
    seats.map((seat) => `${seat.countryId}:${seat.electionType}:${seat.state}`)
  );
  const filledSeatIds = new Set<string>();
  let orphanedOfficialCount = 0;

  for (const official of officials) {
    if (!official.countryId) {
      orphanedOfficialCount += 1;
      continue;
    }

    const officeConfig = getOfficeTypeConfig(official.countryId, official.officeType);
    if (
      !officeConfig &&
      !seatBackedOfficeKeys.has(`${official.countryId}:${official.officeType}`)
    ) {
      orphanedOfficialCount += 1;
      continue;
    }

    // Modern electedOfficials rows key seats by officeType/state/class rather than
    // storing a literal seatId. We derive that logical seat identity here so the
    // integrity check follows the live schema instead of flagging every modern row.
    if (typeof official.seatId === "string" && official.seatId.length > 0) {
      if (knownSeatIds.has(official.seatId)) {
        filledSeatIds.add(official.seatId);
      } else {
        orphanedOfficialCount += 1;
      }
      continue;
    }

    if (!seatBackedOfficeKeys.has(`${official.countryId}:${official.officeType}`)) {
      if (officeConfig?.isSubNational && !official.state) {
        orphanedOfficialCount += 1;
      }
      continue;
    }

    if (official.officeType !== "president" && !official.state) {
      orphanedOfficialCount += 1;
      continue;
    }

    // The Japanese upper-house seed stores one party bloc per region, without
    // choosing either staggered chamber class. Its office and region are real,
    // but no exact class seat can be marked filled from that aggregate row.
    if (
      official.countryId === "JP" &&
      official.officeType === "sangiin" &&
      official.chamberClass == null &&
      (official.seatsHeld ?? 0) > 0 &&
      seatBackedRegionKeys.has(`JP:sangiin:${official.state}`)
    ) {
      continue;
    }

    const derivedSeatId = getSeatIdFromElection({
      countryId: official.countryId,
      electionType: official.officeType,
      state: official.state ?? official.countryId,
      senateClass: official.senateClass,
      chamberClass: official.chamberClass,
    });

    if (!knownSeatIds.has(derivedSeatId)) {
      orphanedOfficialCount += 1;
      continue;
    }

    filledSeatIds.add(derivedSeatId);
  }

  return {
    orphanedOfficialCount,
    seatBackedSeatsWithoutOfficials: Math.max(0, knownSeatIds.size - filledSeatIds.size),
  };
}

async function collectPopulationStats(db: Db): Promise<PopulationStats> {
  const [
    activePlayers,
    totalCharacters,
    totalNPPs,
    totalSeats,
    partiesCount,
    activeElections,
    filledSeats,
  ] = await Promise.all([
    db.collection("users").countDocuments({ banned: { $ne: true } }),
    db.collection("characters").countDocuments(),
    db.collection("npps").countDocuments(),
    db.collection("seats").countDocuments(),
    db.collection("politicalParties").countDocuments(),
    db.collection("elections").countDocuments({ status: "active" }),
    db.collection("electedOfficials").countDocuments(),
  ]);

  const emptySeats = Math.max(0, totalSeats - filledSeats);
  const averagePartySize = partiesCount > 0 ? totalCharacters / partiesCount : 0;

  // Per-country breakdown. Resolve the roster at RUNTIME rather than from the
  // compile-time COUNTRY_CONFIGS status: that constant marks RU, DD, BR and NG
  // `coming-soon`, so a world actively simulating them produced no economy rows
  // and no population stats for them at all — a player country could be running
  // a full economy and be invisible to every chart and check downstream.
  // `getSimulatedCountryIds` resolves on STATUS, honouring the per-world
  // `countryGameStates`
  // override and falls back to config status, so a normal deployment keeps the
  // exact roster it had while a sandbox that enables extra countries gets them
  // instrumented. Flipping the global config instead would have been wrong: it
  // is era-blind, and would put the USSR and East Germany on a 2019 roster.
  const enabledIds = await getSimulatedCountryIds(db);
  const enabledSet = new Set<string>(enabledIds);
  const activeCountries = COUNTRY_ORDER.filter(
    (id) => enabledSet.has(id) || COUNTRY_CONFIGS[id].status === "active"
  );
  const activeCountryIds = activeCountries as string[];

  // Batch per-country counts with $group aggregates instead of looping countDocuments
  const [charCounts, nppCounts, seatCounts, partyCounts, officialCounts] = await Promise.all([
    db
      .collection("characters")
      .aggregate([
        { $match: { countryId: { $in: activeCountryIds } } },
        { $group: { _id: "$countryId", count: { $sum: 1 } } },
      ])
      .toArray() as Promise<{ _id: string | null; count: number }[]>,
    db
      .collection("npps")
      .aggregate([
        { $match: { countryId: { $in: activeCountryIds } } },
        { $group: { _id: "$countryId", count: { $sum: 1 } } },
      ])
      .toArray() as Promise<{ _id: string | null; count: number }[]>,
    db
      .collection("seats")
      .aggregate([
        { $match: { countryId: { $in: activeCountryIds } } },
        { $group: { _id: "$countryId", count: { $sum: 1 } } },
      ])
      .toArray() as Promise<{ _id: string | null; count: number }[]>,
    db
      .collection("politicalParties")
      .aggregate([
        { $match: { countryId: { $in: activeCountryIds } } },
        { $group: { _id: "$countryId", count: { $sum: 1 } } },
      ])
      .toArray() as Promise<{ _id: string | null; count: number }[]>,
    db
      .collection("electedOfficials")
      .aggregate([
        { $match: { countryId: { $in: activeCountryIds } } },
        { $group: { _id: "$countryId", count: { $sum: 1 } } },
      ])
      .toArray() as Promise<{ _id: string | null; count: number }[]>,
  ]);

  const toMap = (arr: { _id: string | null; count: number }[]) =>
    new Map<string, number>(arr.map((d) => [String(d._id ?? "unknown"), d.count]));

  const charMap = toMap(charCounts);
  const nppMap = toMap(nppCounts);
  const seatMap = toMap(seatCounts);
  const partyMap = toMap(partyCounts);
  const officialMap = toMap(officialCounts);

  const byCountry: PopulationStats["byCountry"] = {};
  for (const countryId of activeCountries) {
    const seats = seatMap.get(countryId) ?? 0;
    const officials = officialMap.get(countryId) ?? 0;
    byCountry[countryId as CountryId] = {
      players: charMap.get(countryId) ?? 0,
      npps: nppMap.get(countryId) ?? 0,
      emptySeats: Math.max(0, seats - officials),
      parties: partyMap.get(countryId) ?? 0,
    };
  }

  return {
    activePlayers,
    totalCharacters,
    totalNPPs,
    emptySeats,
    totalSeats,
    partiesCount,
    activeElections,
    averagePartySize,
    byCountry,
  };
}

async function collectEconomyStats(db: Db): Promise<EconomyStats> {
  // Read central banks for interest rates, and stateMetrics national docs for GDP/economic data.
  // National metrics are stored as stateMetrics docs with national scope IDs (e.g., "federal" for US).
  // (#2166): only the join key and the rate flow into the snapshot.
  const centralBanks = await db
    .collection<CentralBank>("centralBanks")
    .find({}, { projection: { countryId: 1, primeRate: 1 } })
    .toArray();
  const centralBankMap = new Map(centralBanks.map((b) => [String(b.countryId ?? b._id), b]));

  const nationalIds = Object.keys(NATIONAL_SCOPE);
  // Every country the engine simulates, not just those with a national metrics
  // doc. The per-country aggregations below all $group by countryId anyway, so
  // widening the match simply lets budget-only countries (the Eastern-bloc
  // stubs) carry real GDP and corporate-revenue figures instead of zeroes.
  const scopedCountryIds = Object.values(NATIONAL_SCOPE) as string[];
  const simulatedIds = await getSimulatedCountryIds(db);
  // ...AND every country that merely has a budget. The byCountry loop discovers
  // countries from `federalBudget`, so if the $match filters on a NARROWER set
  // than the discovery set, those countries get a row with every aggregate
  // silently zeroed. That is what made Greece, Austria and Finland report
  // gdp=0 and revenue=0 while holding real states and sectors: they have no
  // `countryGameStates.status`, so they fell out of the filter but stayed in
  // the discovery. Filter set and discovery set must be the same set.
  // FX rates, so corporate revenue can be reported in a single comparable unit.
  const fxRows = await db
    .collection<{ _id: string; rate?: number; currencyCode?: string }>("exchangeRates")
    .find({}, { projection: { rate: 1, currencyCode: 1 } })
    .toArray();
  const fxByCurrency = new Map<string, number>(
    fxRows.map((r) => [String(r.currencyCode ?? r._id), Number(r.rate) || 1])
  );

  const budgetCountryIds = (
    await db
      .collection<FederalBudget>("federalBudget")
      .find({}, { projection: { countryId: 1 } })
      .toArray()
  )
    .map((b) => String((b as { countryId?: string }).countryId ?? ""))
    .filter(Boolean);
  const countryIds = Array.from(
    new Set<string>([...scopedCountryIds, ...simulatedIds, ...budgetCountryIds])
  );

  // Batch all per-country data in parallel instead of looping individual queries
  const [
    nationalMetricsDocs,
    budgetDocs,
    bondCounts,
    corpRevenues,
    // NOTE: this destructuring MUST track the Promise.all order below —
    // corporations, corporateSectors, states, characters.
    sectorRevenues,
    stateGdps,
    fundAggs,
  ] = await Promise.all([
    db
      .collection<StateMetrics>("macroMetrics")
      // (#2166): only the gdpGrowth value is read below.
      .find({ _id: { $in: nationalIds } }, { projection: { "economic.gdpGrowth.value": 1 } })
      .toArray(),
    db
      .collection<FederalBudget>("federalBudget")
      // ALL budgets, not just the NATIONAL_SCOPE ones: the Eastern-bloc stubs
      // (PL/HU/CS/RO/BG/YU) have a federalBudget but no national metrics doc, and
      // the byCountry loop below uses this list to discover them. Scoping it to
      // `budgetIds` made that discovery impossible, so the bloc produced no
      // economy row and could not be charted individually.
      // (#2166): only the discovery key and the inflation rate are read below.
      .find({}, { projection: { countryId: 1, "economicFactors.inflationRate": 1 } })
      .toArray(),
    db
      .collection("bonds")
      .aggregate([
        { $match: { countryId: { $in: countryIds } } },
        {
          $group: {
            _id: "$countryId",
            total: { $sum: 1 },
            defaulted: { $sum: { $cond: [{ $eq: ["$status", "defaulted"] }, 1, 0] } },
          },
        },
      ])
      .toArray(),
    db
      .collection("corporations")
      .aggregate([
        { $match: { countryId: { $in: countryIds } } },
        // Corps have no top-level `revenue` field — per-turn revenue lives on
        // each sector (`sectors[].revenue`, home currency). The old `$sum: "$revenue"`
        // therefore summed a missing field and was always 0 (#3298). Sum the
        // per-corp sector revenues, then accumulate across the country's corps.
        {
          $group: {
            _id: "$countryId",
            totalRevenue: { $sum: { $sum: "$sectors.revenue" } },
          },
        },
      ])
      .toArray(),
    // Per-sector revenue moved OFF the corporation document into its own
    // `corporateSectors` collection, so the embedded-array sum above resolves
    // to 0 for every country — the same failure mode as #3298 one schema move
    // later. Aggregate the real collection.
    db
      .collection("corporateSectors")
      .aggregate([
        { $match: { countryId: { $in: countryIds } } },
        {
          $group: {
            _id: "$countryId",
            totalRevenue: { $sum: "$revenue" },
            realizedRevenue: { $sum: "$realizedRevenue" },
          },
        },
      ])
      .toArray(),
    db
      .collection("states")
      .aggregate([
        { $match: { countryId: { $in: countryIds } } },
        { $group: { _id: "$countryId", gdp: { $sum: "$gdp" } } },
      ])
      .toArray(),
    db
      .collection("characters")
      .aggregate([
        { $match: { countryId: { $in: countryIds } } },
        {
          $group: {
            _id: "$countryId",
            avgFunds: { $avg: "$funds" },
            totalFunds: { $sum: "$funds" },
          },
        },
      ])
      .toArray(),
  ]);

  const nationalMetricsMap = new Map(nationalMetricsDocs.map((d) => [d._id as string, d]));
  const budgetMap = new Map(budgetDocs.map((d) => [d._id as string, d]));
  const bondMap = new Map(bondCounts.map((d) => [d._id as string, d]));
  const corpMap = new Map(corpRevenues.map((d) => [d._id as string, d]));
  const sectorRevMap = new Map(sectorRevenues.map((d) => [d._id as string, d]));
  const gdpMap = new Map(stateGdps.map((d) => [d._id as string, d]));
  const fundMap = new Map(fundAggs.map((d) => [d._id as string, d]));

  const byCountry: EconomyStats["byCountry"] = {};

  // Walk NATIONAL_SCOPE plus every OTHER country that has a national budget.
  //
  // NATIONAL_SCOPE only lists countries with a national-scope metrics document —
  // the deep-simulated ones. The Eastern-bloc stubs (PL/HU/CS/RO/BG/YU) have a
  // federalBudget and states but no such document, so they produced no economy
  // row at all and could not be charted: `countryHistory` is an event log, and
  // there is no other per-turn economic series for them. Everything below already
  // degrades gracefully on a missing metrics doc (gdpGrowth/interestRate fall to
  // 0 and the figures come from the budget and states), so including them costs
  // nothing and makes the bloc visible per country instead of invisible.
  const scoped: Array<[string | null, string]> = Object.entries(NATIONAL_SCOPE).map(
    ([nationalId, countryId]) => [nationalId, countryId]
  );
  const alreadyScoped = new Set(Object.values(NATIONAL_SCOPE));
  for (const budgetDoc of budgetDocs) {
    const cid = (budgetDoc as { countryId?: string }).countryId;
    if (cid && !alreadyScoped.has(cid as CountryId)) {
      alreadyScoped.add(cid as CountryId);
      scoped.push([null, cid]);
    }
  }

  for (const [nationalId, countryId] of scoped) {
    const nationalMetrics = nationalId ? nationalMetricsMap.get(nationalId) : undefined;
    const gdpGrowth = nationalMetrics?.economic?.gdpGrowth?.value ?? 0;

    const bank = centralBankMap.get(countryId);
    const interestRate = (bank?.primeRate as number) ?? 0;

    const bondData = bondMap.get(countryId) ?? { total: 0, defaulted: 0 };
    const bondDefaultRate = bondData.total > 0 ? bondData.defaulted / bondData.total : 0;

    // Prefer the real `corporateSectors` figure; fall back to the legacy
    // embedded-array sum so a world predating the schema move still reports.
    const sectorData = sectorRevMap.get(countryId) as { totalRevenue?: number } | undefined;
    const corpData = corpMap.get(countryId) ?? { totalRevenue: 0 };
    // Normalise to the ₳ anchor. `corporateSectors.revenue` is stored in the
    // SECTOR'S HOST CURRENCY (sectorTurn writes it via writeCorpEconomicLocal),
    // so summing raw values gave every country a figure in its own unit and made
    // the field uncomparable: raw numbers said the USSR out-earned the UK
    // 14,300x, when in ₳ it is 837x — and Japan actually ranks BELOW the UK once
    // converted. Every cross-country revenue chart built on the raw field was
    // wrong.
    const rawRevenue = sectorData?.totalRevenue ?? corpData.totalRevenue ?? 0;
    const countryCurrency = COUNTRY_CURRENCY_MAP[countryId as CountryId];
    const fxRate = countryCurrency ? (fxByCurrency.get(countryCurrency) ?? 1) : 1;
    const totalCorporationRevenue = fxRate > 0 ? rawRevenue / fxRate : rawRevenue;
    const gdpLevel = (gdpMap.get(countryId) as { gdp?: number } | undefined)?.gdp ?? 0;

    const fundData = fundMap.get(countryId) ?? { avgFunds: 0, totalFunds: 0 };

    const budgetId = getNationalBudgetId(countryId as CountryId);
    const budget = budgetMap.get(budgetId as string);
    const inflationRate = budget?.economicFactors?.inflationRate ?? 0;

    byCountry[countryId as CountryId] = {
      gdpGrowth,
      gdp: gdpLevel,
      inflation: inflationRate,
      interestRate,
      bondDefaultRate,
      totalCorporationRevenue,
      averagePlayerFunds: fundData.avgFunds ?? 0,
      fundCirculation: fundData.totalFunds ?? 0,
    };
  }

  return { byCountry };
}
