/**
 * Mode A — seed conformance checks.
 * Epsilon-level tolerances; nothing has run yet at post-reset turn 1.
 */

import {
  STARTING_POLITICAL_COLLECTIONS,
  STARTING_POLITICAL_OFFICIAL_FILTER,
  startingPoliticalCountries,
  startingCountryFilter,
  startingArtifactFilters,
} from "../startingParties";
import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { getCountryStateCollection } from "@/lib/db/collections/countryState";
import { NATIONAL_SCOPE_IDS } from "@/lib/constants/nationalScope";
import { buildCountryReadinessReport } from "@/lib/admin/countryReadinessReport";
import { getRuntimeCollectionNames } from "@/lib/admin/seed/seedManifest";
import { normalizeMaintenanceMode } from "@/lib/maintenanceStatus";
import { getNationalBudgetSeedConfigsForPreset } from "@/lib/seeds/reference/budgets";
import {
  COMMAND_CEILING,
  commandEconomySoeSectors,
  scheduledMarketizationLevel,
} from "@/lib/constants/commandEconomy";
import { sectorRevenueDistribution } from "./rules/sectorDistribution";
import { DEFAULT_STRATEGIC_SECTORS } from "@/lib/seeds/reference/strategicSectors";
import { COUNTRY_ELECTION_PHASES } from "@/lib/turn/countryPhases";
import {
  buildSeedExpectations,
  expectedRegionCount,
  readinessCountryIds,
  type SeedExpectations,
} from "./expectations";
import {
  CONFORMANCE_POP_STRUCTURAL_BREAK,
  CONFORMANCE_POP_TOL,
  CONFORMANCE_SECTOR_MAX_SHARE,
} from "./tolerance";
import type { SeedDiagnosticCheck, SeedDiagnosticSeverity } from "./types";
import { check, ok, warn, critical } from "./checkFactory";
import { wrongEraDefaultParties } from "./rules/partyEra";
import { partySeedsForPreset } from "@/lib/seeds/partySeedRegistry";
import {
  checkNationalBudgets,
  checkStaleCostFractions,
  checkMonetary,
  checkForex,
} from "./conformanceMacro";
import { checkEconomicOpening } from "./economicOpening";
import { checkRegionDerivedCoverage } from "./regionDerivedCoverage";
import { regionalMetricCoverage, seedTurnoutScopeFilter } from "./regionalCoverage";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { getScotusPresetSeed } from "@/lib/scotus/presetData";
import type { ScotusPresetSeed } from "@/lib/scotus/presetData/types";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

/** Readiness check names that are expected-empty pre-founding / pre-seat. */
const PRE_FOUNDING_READINESS = new Set(["NPPs", "ElectedOfficials", "GovernmentFormation"]);

/** Runtime history/log collections that must be empty at turn 1. */
const EMPTY_AT_TURN1: readonly string[] = [
  "turnLogs",
  "commodityPriceHistory",
  "stateApprovalHistory",
  "stateMetricHistory",
  "parliamentSeatsHistory",
  "corporationHistory",
  "marketCapHistory",
  "shareTradeHistory",
  "bondHistory",
  "tradeHistory",
  "portfolioHistory",
  "partyHistory",
  "influenceHistory",
  "countryHistory",
  "wealthListHistory",
  "corporationCountryHistory",
  "corporationPortfolioHistory",
];

/**
 * Classify Σ region population vs national budget seed population.
 * Dual-authored sources are not reconciled (unlike GDP) — ordinary drift is WARN.
 * CRITICAL only for structural breaks: no regions, non-positive sum, or >25% drift.
 */
export function classifyPopulationSumCheck(
  countryId: string,
  expectedNationalPop: number,
  regionCount: number,
  summedPopulation: number
): SeedDiagnosticCheck {
  const id = `regions.${countryId}.populationSum`;
  const metric = "Σ region population";

  if (regionCount === 0) {
    return critical(id, countryId, metric, expectedNationalPop, summedPopulation, "no regions");
  }
  if (!(summedPopulation > 0) || !Number.isFinite(summedPopulation)) {
    return critical(
      id,
      countryId,
      metric,
      expectedNationalPop,
      summedPopulation,
      "summed population ≤ 0"
    );
  }
  if (!(expectedNationalPop > 0) || !Number.isFinite(expectedNationalPop)) {
    return warn(
      id,
      countryId,
      metric,
      expectedNationalPop,
      summedPopulation,
      "national budget population missing/invalid"
    );
  }

  const drift = Math.abs(summedPopulation - expectedNationalPop) / expectedNationalPop;
  const driftNote = `drift ${(drift * 100).toFixed(2)}% (budget vs Σ regions; not reconciled)`;

  if (drift > CONFORMANCE_POP_STRUCTURAL_BREAK) {
    return critical(
      id,
      countryId,
      metric,
      expectedNationalPop,
      summedPopulation,
      `${driftNote} — structural break (>${(CONFORMANCE_POP_STRUCTURAL_BREAK * 100).toFixed(0)}%)`
    );
  }
  if (drift > CONFORMANCE_POP_TOL) {
    return warn(id, countryId, metric, expectedNationalPop, summedPopulation, driftNote);
  }
  return ok(
    id,
    countryId,
    metric,
    expectedNationalPop,
    summedPopulation,
    drift === 0 ? "exact population reconciliation" : driftNote
  );
}

async function checkGameStateClock(
  db: Db,
  expect: SeedExpectations,
  worldsimBootstrap: boolean
): Promise<SeedDiagnosticCheck[]> {
  const gs = await db.collection("gameState").findOne({ _id: "current" as never });
  const checks: SeedDiagnosticCheck[] = [];
  if (!gs) {
    return [
      critical("gameState.exists", "global", "gameState", "present", null, "missing gameState"),
    ];
  }

  const preset = typeof gs.preset === "string" ? gs.preset : null;
  checks.push(
    expect.knownPreset && preset === expect.preset
      ? ok("gameState.preset", "global", "preset", expect.preset, preset)
      : critical(
          "gameState.preset",
          "global",
          "preset",
          expect.preset,
          preset,
          expect.knownPreset ? "preset mismatch" : "unknown preset"
        )
  );

  const startingYear = typeof gs.startingYear === "number" ? gs.startingYear : null;
  checks.push(
    startingYear === expect.startingYear
      ? ok("gameState.startingYear", "global", "startingYear", expect.startingYear, startingYear)
      : critical(
          "gameState.startingYear",
          "global",
          "startingYear",
          expect.startingYear,
          startingYear
        )
  );

  const currentTurn = typeof gs.currentTurn === "number" ? gs.currentTurn : null;
  const resetYear = gs.resetStartDate?.year ?? expect.startingYear;
  const resetWeek = gs.resetStartDate?.week ?? 1;
  const expectedResetTurn = (resetYear - expect.startingYear) * TURNS_PER_YEAR + resetWeek;
  checks.push(
    currentTurn === expectedResetTurn
      ? ok("gameState.currentTurn", "global", "currentTurn", expectedResetTurn, currentTurn)
      : critical("gameState.currentTurn", "global", "currentTurn", expectedResetTurn, currentTurn)
  );

  const currentYear = typeof gs.currentYear === "number" ? gs.currentYear : null;
  const preIterActive = gs.preIteration?.active === true;
  if (preIterActive) {
    checks.push(
      currentYear === expect.startingYear
        ? ok(
            "gameState.currentYear",
            "global",
            "currentYear",
            expect.startingYear,
            currentYear,
            "preIteration.active pins currentYear to startingYear"
          )
        : critical(
            "gameState.currentYear",
            "global",
            "currentYear",
            expect.startingYear,
            currentYear,
            "preIteration.active but currentYear drifted"
          )
    );
  } else {
    checks.push(
      currentYear === resetYear
        ? ok("gameState.currentYear", "global", "currentYear", resetYear, currentYear)
        : critical("gameState.currentYear", "global", "currentYear", resetYear, currentYear)
    );
  }

  checks.push(
    gs.iteration != null
      ? ok(
          "gameState.iteration",
          "global",
          "iteration",
          "stamped",
          typeof gs.iteration === "object" ? JSON.stringify(gs.iteration) : String(gs.iteration)
        )
      : worldsimBootstrap
        ? ok("gameState.iteration", "global", "iteration", "optional before first turn", null)
        : warn("gameState.iteration", "global", "iteration", "stamped", null, "iteration not set")
  );

  return checks;
}

function checkBundleFallbacks(expect: SeedExpectations): SeedDiagnosticCheck[] {
  if (expect.bundleFallbacks.length === 0) {
    return [
      ok(
        "preset.bundles",
        "global",
        "bundleCoverage",
        "explicit",
        "explicit",
        "all core domains have explicit bundles"
      ),
    ];
  }
  return expect.bundleFallbacks.map((f) =>
    critical(`preset.bundle.${f.domain}`, "global", f.domain, "explicit", "2019-fallback", f.note)
  );
}

export async function checkSectors(
  db: Db,
  expect: SeedExpectations
): Promise<SeedDiagnosticCheck[]> {
  const checks: SeedDiagnosticCheck[] = [];
  const countries = expect.seededCountryIds;
  const config = await db
    .collection<{ _id: string; commandEconomyEnabled?: boolean }>("gameConfig")
    .findOne({ _id: "default" }, { projection: { commandEconomyEnabled: 1 } });
  const budgetYears = new Map<string, number>(
    getNationalBudgetSeedConfigsForPreset(expect.preset).map((budget) => [
      budget.countryId,
      budget.fiscalYear,
    ])
  );

  for (const countryId of countries) {
    // The command-band seed moves production into country-owned SOEs. Its
    // residual unowned pool may be empty or only extraction, and is not the
    // country's productive-sector distribution. Match the same authored era
    // and command flag used by the SOE seeder, then require actual SOE rows.
    const budgetYear = budgetYears.get(countryId);
    const commandSoeSeed =
      config?.commandEconomyEnabled === true &&
      budgetYear !== undefined &&
      commandEconomySoeSectors(countryId).length > 0 &&
      scheduledMarketizationLevel(countryId, budgetYear) < COMMAND_CEILING;
    const unownedCount = await db.collection("unownedSectors").countDocuments({ countryId });
    checks.push(
      commandSoeSeed
        ? ok(
            `sectors.${countryId}.unowned`,
            countryId,
            "unownedSectors.count",
            "optional with country-owned SOE production",
            unownedCount,
            "command-band production is validated in the country-owned SOE pool"
          )
        : unownedCount > 0
          ? ok(
              `sectors.${countryId}.unowned`,
              countryId,
              "unownedSectors.count",
              ">0",
              unownedCount
            )
          : critical(
              `sectors.${countryId}.unowned`,
              countryId,
              "unownedSectors.count",
              ">0",
              unownedCount
            )
    );

    const strategicCount = await db
      .collection("strategicSectorDesignations")
      .countDocuments({ countryId });
    const expectedStrategic = DEFAULT_STRATEGIC_SECTORS[countryId as CountryId]?.length ?? 0;
    checks.push(
      strategicCount >= expectedStrategic
        ? ok(
            `sectors.${countryId}.strategic`,
            countryId,
            "strategicSectorDesignations.count",
            `>=${expectedStrategic}`,
            strategicCount
          )
        : warn(
            `sectors.${countryId}.strategic`,
            countryId,
            "strategicSectorDesignations.count",
            `>=${expectedStrategic}`,
            strategicCount,
            "missing configured strategic designations"
          )
    );

    // Sanity: revenue shares must sum to ~1 and no single sector dominate.
    // Exact weight-table match is unreliable once MIN_UNOWNED floors apply.
    const rows = await db
      .collection<{ sectorType?: string; revenue?: number }>("unownedSectors")
      .find({ countryId })
      .project({ sectorType: 1, revenue: 1 })
      .toArray();
    let productiveRows = rows;
    if (commandSoeSeed) {
      const owners = await db
        .collection<{ _id: ObjectId }>("corporations")
        .find({ countryOwnerId: countryId }, { projection: { _id: 1 } })
        .toArray();
      const owned = owners.length
        ? await db
            .collection<{ sectorType?: string; revenue?: number }>("corporateSectors")
            .find(
              { countryId, corporationId: { $in: owners.map((owner) => owner._id) } },
              { projection: { sectorType: 1, revenue: 1 } }
            )
            .toArray()
        : [];
      const producingOwned = owned.filter((row) => Number(row.revenue) > 0);
      checks.push(
        producingOwned.length > 0
          ? ok(
              `sectors.${countryId}.commandSoe`,
              countryId,
              "producing country-owned corporateSectors.count",
              ">0",
              producingOwned.length
            )
          : critical(
              `sectors.${countryId}.commandSoe`,
              countryId,
              "producing country-owned corporateSectors.count",
              ">0",
              producingOwned.length
            )
      );
      productiveRows = [...rows, ...owned];
    }
    const distribution = sectorRevenueDistribution(productiveRows);
    if (distribution) {
      const { shareSum, maxShare, maxType } = distribution;
      const sumOk = Math.abs(shareSum - 1) <= 0.02;
      const maxOk = maxShare <= CONFORMANCE_SECTOR_MAX_SHARE;
      if (sumOk && maxOk) {
        checks.push(
          ok(
            `sectors.${countryId}.weightDist`,
            countryId,
            "sector share sanity",
            `sum≈1, max≤${CONFORMANCE_SECTOR_MAX_SHARE}`,
            `sum=${shareSum.toFixed(3)}, max=${maxType}:${maxShare.toFixed(3)}`
          )
        );
      } else {
        checks.push(
          critical(
            `sectors.${countryId}.weightDist`,
            countryId,
            "sector share sanity",
            `sum≈1, max≤${CONFORMANCE_SECTOR_MAX_SHARE}`,
            `sum=${shareSum.toFixed(3)}, max=${maxType}:${maxShare.toFixed(3)}`,
            !sumOk ? "shares do not sum to ~1" : `sector ${maxType} implausibly dominant`
          )
        );
      }
    }
  }
  return checks;
}

async function checkRegions(db: Db, expect: SeedExpectations): Promise<SeedDiagnosticCheck[]> {
  const checks: SeedDiagnosticCheck[] = [];
  // Structural region checks for every seeded country (not just readiness set).
  for (const countryId of expect.seededCountryIds) {
    const regionCount = await db.collection("states").countDocuments({ countryId });
    const expectedCount = expectedRegionCount(countryId, expect.preset);

    if (expectedCount != null) {
      checks.push(
        regionCount === expectedCount
          ? ok(
              `regions.${countryId}.count`,
              countryId,
              "states.count",
              expectedCount,
              regionCount,
              "era-authored region bundle"
            )
          : critical(
              `regions.${countryId}.count`,
              countryId,
              "states.count",
              expectedCount,
              regionCount,
              "era-authored region bundle"
            )
      );
    } else {
      checks.push(
        regionCount > 0
          ? ok(
              `regions.${countryId}.count`,
              countryId,
              "states.count",
              ">0",
              regionCount,
              "presence (no dedicated era count registered)"
            )
          : critical(
              `regions.${countryId}.count`,
              countryId,
              "states.count",
              ">0",
              regionCount,
              "no regions seeded"
            )
      );
    }

    const states = await db
      .collection<{ _id: string; population?: number }>("states")
      .find({ countryId })
      .project({ _id: 1, population: 1 })
      .toArray();
    const regionIds = states
      .filter((state) => !NATIONAL_SCOPE_IDS.has(String(state._id)))
      .map((state) => String(state._id));
    if (regionIds.length > 0) {
      const metrics = await db
        .collection<{ _id: string }>("macroMetrics")
        .find({ countryId })
        .project({ _id: 1 })
        .toArray();
      checks.push(
        regionalMetricCoverage(
          countryId,
          regionIds,
          metrics.map((row) => String(row._id))
        )
      );
    }

    const cfg = expect.nationalBudgets.find((b) => b.countryId === countryId);
    if (cfg) {
      const sum = states
        .filter((s) => !NATIONAL_SCOPE_IDS.has(String(s._id)))
        .reduce((acc, s) => acc + (Number(s.population) || 0), 0);
      checks.push(classifyPopulationSumCheck(countryId, cfg.population, regionCount, sum));
    }
  }
  return checks;
}

async function checkPolitical(
  db: Db,
  expect: SeedExpectations,
  emptyCountries: ReadonlySet<string> | null = new Set()
): Promise<SeedDiagnosticCheck[]> {
  const checks: SeedDiagnosticCheck[] = [];
  if (expect.preset === "1991-default") {
    for (const prefix of ["pl", "cs", "hu", "ro", "bg", "yu"] as const) {
      const stateId = `${prefix}_national`;
      const policyCount = await db.collection("statePolicies").countDocuments({
        stateId,
        scope: "national",
      });
      checks.push(
        policyCount === 16
          ? ok(
              `policies.${prefix}.national`,
              prefix.toUpperCase(),
              "1991 national policies",
              16,
              policyCount
            )
          : critical(
              `policies.${prefix}.national`,
              prefix.toUpperCase(),
              "1991 national policies",
              16,
              policyCount
            )
      );
      const democracy = await db.collection("statePolicies").findOne({
        stateId,
        legislationTypeId: `${prefix}_political_system`,
      });
      const optionIndex = democracy?.policyOptionIndex;
      checks.push(
        optionIndex === 1
          ? ok(
              `policies.${prefix}.politicalSystem`,
              prefix.toUpperCase(),
              "1991 multiparty policy",
              1,
              optionIndex
            )
          : critical(
              `policies.${prefix}.politicalSystem`,
              prefix.toUpperCase(),
              "1991 multiparty policy",
              1,
              optionIndex ?? null
            )
      );
    }
  }
  for (const countryId of readinessCountryIds(expect.preset)) {
    const report = await buildCountryReadinessReport(db, countryId, expect.preset);
    if (!report) {
      checks.push(
        warn(
          `readiness.${countryId}`,
          countryId,
          "countryReadiness",
          "report",
          null,
          "no expectations entry"
        )
      );
      continue;
    }
    for (const c of report.checks) {
      if (
        (emptyCountries === null || emptyCountries.has(countryId)) &&
        ["Parties", "StatePartyOrg", "NPPs", "ElectedOfficials", "GovernmentFormation"].includes(
          c.name
        )
      ) {
        continue; // Explicit empty-start checks below validate these intentional absences.
      }
      let severity: SeedDiagnosticSeverity =
        c.status === "ok" ? "ok" : c.status === "warning" ? "warn" : "critical";
      let note = c.detail;
      // Pre-founding: officials / NPPs / government formation are not seated yet
      // on a plain historical seed — keep the detail but do not critical.
      if (severity === "critical" && PRE_FOUNDING_READINESS.has(c.name)) {
        severity = "warn";
        note = `${c.detail ?? c.name} (expected pre-founding)`;
      }
      checks.push(
        check(
          `readiness.${countryId}.${c.name}`,
          countryId,
          c.name,
          c.detail ?? null,
          c.count ?? c.status,
          severity,
          note
        )
      );
    }
  }
  return checks;
}

/**
 * Every country registered in {@link COUNTRY_ELECTION_PHASES} spawns
 * founding/perpetual elections regardless of preset — the registry is not
 * itself preset-gated, only the seat maps behind each `ensureXXElections`
 * call are. A country that spawns races but was seeded with zero political
 * parties for the active preset can never field a candidate: no NPP, no
 * `challengerSupply` floor, no player — the chamber resolves empty in every
 * world, forever. This was the root cause of #3875 (FR/IT/ES/SE/TR/GR/FI/AT
 * under 1991-default, NG under 1979-default): 4,552 + 1,466 seats stranded
 * because the country was in the election-phase registry but had no
 * `validForPresets`-gated roster authored for that era.
 *
 * `validForPresets` itself is stripped before a party seed is written to
 * `politicalParties` (see `ensureDefaultParties`/`seedXXParties`), so a
 * plain `countDocuments({ countryId })` after seeding is the correct
 * post-hoc signal: it is zero if and only if nothing in that country's
 * roster was valid for the active preset.
 */
async function checkPartyRosters(
  db: Db,
  expect: SeedExpectations,
  emptyCountries: ReadonlySet<string> | null = new Set()
): Promise<SeedDiagnosticCheck[]> {
  const checks: SeedDiagnosticCheck[] = [];
  const seeded = new Set(expect.seededCountryIds);
  const electionCountries = Object.keys(COUNTRY_ELECTION_PHASES) as CountryId[];

  for (const countryId of electionCountries) {
    if (!seeded.has(countryId)) continue; // not part of this preset's world
    const count = await db.collection("politicalParties").countDocuments({ countryId });
    checks.push(
      emptyCountries === null || emptyCountries.has(countryId)
        ? check(
            `parties.${countryId}.roster`,
            countryId,
            "politicalParties.count",
            0,
            count,
            count === 0 ? "ok" : "critical",
            "Explicit no-starting-parties reset in player countries"
          )
        : count > 0
          ? ok(`parties.${countryId}.roster`, countryId, "politicalParties.count", ">0", count)
          : critical(
              `parties.${countryId}.roster`,
              countryId,
              "politicalParties.count",
              ">0",
              count,
              "spawns founding/perpetual elections (COUNTRY_ELECTION_PHASES) but has zero " +
                "seeded parties for this preset — every chamber resolves empty forever (#3875)"
            )
    );
  }
  if (expect.preset === "2027-default") checks.push(...(await checkPartyEra(db, expect)));
  return checks;
}

/** Rejects persisted default parties outside the 2027 effective roster (#2294). */
async function checkPartyEra(db: Db, expect: SeedExpectations): Promise<SeedDiagnosticCheck[]> {
  const rosters = new Map<string, Set<string>>();
  for (const countryId of expect.seededCountryIds) {
    const seeds = partySeedsForPreset(countryId, expect.preset);
    if (seeds.length > 0) rosters.set(countryId, new Set(seeds.map((seed) => seed.name)));
  }
  const persisted = await db
    .collection<{ countryId: string; name: string }>("politicalParties")
    .find({ isDefault: true, countryId: { $in: [...rosters.keys()] } })
    .project<{ countryId: string; name: string }>({ countryId: 1, name: 1 })
    .toArray();
  const wrong = wrongEraDefaultParties(persisted, rosters);
  if (wrong.length === 0) {
    return [ok("parties.eraRoster", "global", "wrongEraDefaultParties", 0, 0)];
  }
  return [
    critical(
      "parties.eraRoster",
      "global",
      "wrongEraDefaultParties",
      0,
      wrong.length,
      `parties outside the ${expect.preset} roster: ` +
        wrong.map((party) => `${party.countryId}:${party.name}`).join("; ")
    ),
  ];
}

async function checkDemographics(db: Db, expect: SeedExpectations): Promise<SeedDiagnosticCheck[]> {
  const checks: SeedDiagnosticCheck[] = [];
  checks.push(
    expect.eraCompositionOk
      ? ok(
          "demographics.eraComposition",
          "global",
          "ERA_COMPOSITIONS",
          expect.era,
          expect.era,
          "era composition resolved"
        )
      : critical(
          "demographics.eraComposition",
          "global",
          "ERA_COMPOSITIONS",
          expect.era,
          null,
          "era composition missing — would fall back"
        )
  );

  for (const countryId of expect.seededCountryIds) {
    const regionCount = await db.collection("states").countDocuments({ countryId });
    const expectedDemo = expectedRegionCount(countryId, expect.preset) ?? regionCount;
    const demoCount = await db.collection("stateDemographics").countDocuments({ countryId });

    if (expectedDemo > 0) {
      checks.push(
        demoCount === expectedDemo
          ? ok(
              `demographics.${countryId}.stateDemographics`,
              countryId,
              "stateDemographics.count",
              expectedDemo,
              demoCount
            )
          : demoCount > 0
            ? warn(
                `demographics.${countryId}.stateDemographics`,
                countryId,
                "stateDemographics.count",
                expectedDemo,
                demoCount,
                "count ≠ era region count"
              )
            : critical(
                `demographics.${countryId}.stateDemographics`,
                countryId,
                "stateDemographics.count",
                expectedDemo,
                demoCount
              )
      );
    }

    const defaultsCount = await db.collection("demographicDefaults").countDocuments({ countryId });
    checks.push(
      defaultsCount > 0
        ? ok(
            `demographics.${countryId}.defaults`,
            countryId,
            "demographicDefaults.count",
            ">0",
            defaultsCount
          )
        : warn(
            `demographics.${countryId}.defaults`,
            countryId,
            "demographicDefaults.count",
            ">0",
            defaultsCount
          )
    );
    const turnoutCount = await db
      .collection<{ _id: string; countryId?: string | null }>("stateDemographicTurnout")
      .countDocuments(seedTurnoutScopeFilter(countryId));
    checks.push(
      turnoutCount > 0
        ? ok(
            `demographics.${countryId}.turnout`,
            countryId,
            "stateDemographicTurnout.count",
            ">0",
            turnoutCount
          )
        : warn(
            `demographics.${countryId}.turnout`,
            countryId,
            "stateDemographicTurnout.count",
            ">0",
            turnoutCount
          )
    );
  }
  return checks;
}

async function checkRuntimeCleanliness(db: Db): Promise<SeedDiagnosticCheck[]> {
  const checks: SeedDiagnosticCheck[] = [];
  const runtime = new Set(getRuntimeCollectionNames());
  const owned = new Set(["seedDiagnostics", "seedDiagnosticBaselines", "gameState"]);

  for (const name of EMPTY_AT_TURN1) {
    if (!runtime.has(name) || owned.has(name)) continue;
    try {
      const count = await db.collection(name).countDocuments({});
      checks.push(
        count === 0
          ? ok(`runtime.${name}`, "global", `${name}.count`, 0, count)
          : warn(
              `runtime.${name}`,
              "global",
              `${name}.count`,
              0,
              count,
              "append-only/history collection not empty at turn 1"
            )
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      checks.push(
        warn(`runtime.${name}`, "global", `${name}.count`, 0, null, `query failed: ${message}`)
      );
    }
  }
  return checks;
}

async function checkConfig(db: Db, worldsimBootstrap: boolean): Promise<SeedDiagnosticCheck[]> {
  const checks: SeedDiagnosticCheck[] = [];
  const config = await db.collection("gameConfig").findOne({ _id: "default" as never });
  checks.push(
    config
      ? ok("config.gameConfig", "global", "gameConfig", "present", "present")
      : critical("config.gameConfig", "global", "gameConfig", "present", null)
  );

  // Maintenance mode should be "full" mid-reset (Phase 4 runs after
  // enableMaintenanceMode, which always writes "full"). Normalize first so a
  // legacy boolean `true` doc (pre-tri-state) still reads as sealed.
  const maintMode = normalizeMaintenanceMode(
    config?.maintenanceMode as boolean | "off" | "partial" | "full" | undefined
  );
  const expectedMode = worldsimBootstrap ? "off" : "full";
  const maintSealed = maintMode === expectedMode;
  checks.push(
    maintSealed
      ? ok(
          "config.maintenanceMode",
          "global",
          "maintenanceMode",
          expectedMode,
          maintMode,
          worldsimBootstrap ? "worldsim runs with maintenance off" : "sealed post-reset"
        )
      : warn(
          "config.maintenanceMode",
          "global",
          "maintenanceMode",
          expectedMode,
          maintMode,
          `expected maintenance mode '${expectedMode}'`
        )
  );

  // commandEconomyEnabled is admin-gated; absent/false is fine for fresh seeds.
  const cmd = config?.commandEconomyEnabled === true;
  checks.push(
    ok(
      "config.commandEconomyEnabled",
      "global",
      "commandEconomyEnabled",
      "optional",
      cmd ? "true" : "false",
      cmd ? "enabled" : "disabled (default)"
    )
  );

  return checks;
}

/**
 * Verify that the active preset owns an explicit Supreme Court seed contract
 * and that bootstrap persisted exactly that turn-one court. In particular, an
 * empty curated docket is valid only when the preset records the reviewed
 * procedural-only fallback; an omitted preset can never look equivalent to
 * that deliberate choice.
 */
export function checkMissingScotusSeedDefinition(
  preset: string,
  seed: ScotusPresetSeed | undefined
): SeedDiagnosticCheck[] | null {
  if (!seed) {
    // Court content is required only for presets supported by the SCOTUS
    // subsystem. Do not turn older unsupported shipping eras into new reset
    // blockers as a side effect of checking the 2027 reset candidate.
    const required = new Set([
      "1953-default",
      "1979-default",
      "1991-default",
      "2019-default",
      "2027-default",
    ]).has(preset);
    if (!required) return [];
    return [
      critical(
        "institutions.US.scotus.definition",
        "US",
        "SCOTUS preset seed",
        "explicit roster and docket policy",
        null,
        `no Supreme Court content registered for preset "${preset}"`
      ),
    ];
  }
  return null;
}

export async function checkScotusSeed(db: Db, preset: string): Promise<SeedDiagnosticCheck[]> {
  const seed = getScotusPresetSeed(preset);
  const missingDefinition = checkMissingScotusSeedDefinition(preset, seed);
  if (missingDefinition) return missingDefinition;

  // The guard above proves this for TypeScript and runtime readers alike.
  if (!seed) return [];
  const seatNumbers = seed.seats.map((seat) => seat.seatNumber);
  const structurallyComplete =
    seed.seats.length === 9 &&
    new Set(seatNumbers).size === 9 &&
    seatNumbers.every(
      (seatNumber) => Number.isInteger(seatNumber) && seatNumber >= 1 && seatNumber <= 9
    );
  const expectedVacancies = seed.seats.filter(
    (seat) => seat.historicalOccupants.length === 0
  ).length;
  const persistedSeats = await db
    .collection("supremeCourtSeats")
    .countDocuments({ countryId: "US" });
  const persistedVacancies = await db.collection("supremeCourtSeats").countDocuments({
    countryId: "US",
    justiceMode: null,
    justiceCharacterId: null,
    justiceNppId: null,
  });
  const persistedDocket = await db
    .collection("docketCases")
    .countDocuments({ countryId: "US", preset });

  const proceduralFallback =
    seed.provenance?.docket.mode === "procedural-only-fallback"
      ? seed.provenance.docket
      : undefined;
  const explicitProceduralFallback = proceduralFallback !== undefined;
  const docketPolicyValid = seed.docket.length > 0 || explicitProceduralFallback;
  const provenanceValid =
    preset !== "2027-default" ||
    (seed.provenance?.roster.mode === "reviewed-current-roster-fallback" &&
      explicitProceduralFallback);

  return [
    structurallyComplete && provenanceValid
      ? ok(
          "institutions.US.scotus.definition",
          "US",
          "SCOTUS preset seed",
          "9 unique seats numbered 1-9",
          "complete"
        )
      : critical(
          "institutions.US.scotus.definition",
          "US",
          "SCOTUS preset seed",
          "9 unique seats numbered 1-9",
          `${seed.seats.length} seat definitions`,
          structurallyComplete
            ? "2027 roster/docket fallback provenance is absent or invalid"
            : "roster definition is incomplete or has duplicate/invalid seat numbers"
        ),
    persistedSeats === seed.seats.length
      ? ok(
          "institutions.US.scotus.roster",
          "US",
          "supremeCourtSeats.count",
          seed.seats.length,
          persistedSeats
        )
      : critical(
          "institutions.US.scotus.roster",
          "US",
          "supremeCourtSeats.count",
          seed.seats.length,
          persistedSeats,
          "persisted court does not match the preset roster"
        ),
    persistedVacancies === expectedVacancies
      ? ok(
          "institutions.US.scotus.vacancies",
          "US",
          "vacant Supreme Court seats",
          expectedVacancies,
          persistedVacancies
        )
      : critical(
          "institutions.US.scotus.vacancies",
          "US",
          "vacant Supreme Court seats",
          expectedVacancies,
          persistedVacancies,
          "turn-one vacancies do not match the authored roster"
        ),
    docketPolicyValid && persistedDocket === seed.docket.length
      ? ok(
          "institutions.US.scotus.docket",
          "US",
          "curated docket cases",
          explicitProceduralFallback ? "explicit procedural-only fallback" : seed.docket.length,
          persistedDocket,
          explicitProceduralFallback
            ? proceduralFallback.limitation
            : "matches authored historical docket"
        )
      : critical(
          "institutions.US.scotus.docket",
          "US",
          "curated docket cases",
          docketPolicyValid ? seed.docket.length : "authored cases or explicit fallback",
          persistedDocket,
          docketPolicyValid
            ? "persisted docket does not match the preset"
            : "empty curated docket has no reviewed fallback provenance"
        ),
  ];
}

/**
 * Run all Mode A conformance checks against the live DB for the active preset.
 */
export async function runConformanceChecks(
  db: Db,
  opts?: { preset?: string; trigger?: string }
): Promise<{ checks: SeedDiagnosticCheck[]; expect: SeedExpectations }> {
  const gs = await db.collection("gameState").findOne({ _id: "current" as never });
  const preset =
    opts?.preset ?? (typeof gs?.preset === "string" ? gs.preset : null) ?? DEFAULT_SEED_PRESET;
  const expect = buildSeedExpectations(preset);
  const worldsimBootstrap = opts?.trigger === "worldsim-post-bootstrap";
  const noStartingParties =
    preset === "2019-no-parties" ||
    (preset === "1991-default" && gs?.preset === preset && gs?.startingPartiesMode === "none");

  const countries = noStartingParties ? await startingPoliticalCountries(db, preset) : [];
  const emptyCountries = countries === null ? null : new Set(countries);

  // Every group below is READ-ONLY (no write of any kind in this module), and
  // none reads another's output, so they overlap instead of queueing 12 round
  // trips end to end. This was the run's largest single phase gap.
  //
  // ⚠️ `Promise.all` preserves INPUT order in its result, and the groups are
  // flattened in that order, so the emitted check sequence is byte-identical to
  // the sequential version. That matters beyond tidiness: `formatDiagnosticSummary`
  // names only the first five criticals, so a reordering would silently change
  // which failures a reader is told about.
  const groups = await Promise.all([
    checkGameStateClock(db, expect, worldsimBootstrap),
    Promise.resolve(checkBundleFallbacks(expect)),
    checkNationalBudgets(db, expect),
    checkStaleCostFractions(db, preset),
    checkMonetary(db, expect),
    checkForex(db, expect),
    checkSectors(db, expect),
    checkRegions(db, expect),
    checkPolitical(db, expect, emptyCountries),
    checkPartyRosters(db, expect, emptyCountries),
    noStartingParties ? checkEmptyPoliticalStart(db, countries) : Promise.resolve([]),
    checkDemographics(db, expect),
    checkRuntimeCleanliness(db),
    checkConfig(db, worldsimBootstrap),
    checkRegionDerivedCoverage(db, expect),
    checkScotusSeed(db, preset),
    checkEconomicOpening(db, preset),
  ]);
  const checks: SeedDiagnosticCheck[] = groups.flat();

  return { checks, expect };
}

/** Intentional absence must not conceal a partial cleanup or occupied office. */
async function checkEmptyPoliticalStart(
  db: Db,
  countries: CountryId[] | null
): Promise<SeedDiagnosticCheck[]> {
  const checks: SeedDiagnosticCheck[] = [];
  const countryFilter = startingCountryFilter(countries, true);
  const npps = await db
    .collection("npps")
    .find(countryFilter)
    .project<{ _id: ObjectId }>({ _id: 1 })
    .toArray();
  const nppIds = npps.map((row) => row._id);
  const artifactFilters = await startingArtifactFilters(db, countries, nppIds);
  for (const collection of STARTING_POLITICAL_COLLECTIONS) {
    const count = await db.collection(collection).countDocuments(artifactFilters[collection]);
    checks.push(
      check(
        `startingParties.${collection}`,
        "global",
        collection,
        0,
        count,
        count === 0 ? "ok" : "critical",
        "Explicit no-starting-parties reset in player countries"
      )
    );
  }
  const occupiedFilters: Array<[string, Record<string, unknown>]> = [
    ["electedOfficials", STARTING_POLITICAL_OFFICIAL_FILTER],
    ["countryState", { rulingPartyId: { $exists: true, $ne: null } }],
    [
      "npps",
      { $or: [{ party: { $ne: "independent" } }, { currentOffice: { $exists: true, $ne: null } }] },
    ],
  ];
  for (const [collection, filter] of occupiedFilters) {
    const count =
      collection === "countryState"
        ? await getCountryStateCollection(db).countDocuments({
            ...(countries === null ? {} : { _id: { $in: countries } }),
            rulingPartyId: { $exists: true, $ne: null },
          })
        : await db.collection(collection).countDocuments({ $and: [countryFilter, filter] });
    checks.push(
      check(
        `startingParties.${collection}`,
        "global",
        collection,
        0,
        count,
        count === 0 ? "ok" : "critical",
        "No affiliated politicians or occupied political offices"
      )
    );
  }
  return checks;
}
