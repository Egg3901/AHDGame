/** Seven concurrent crisis families, isolated retained-world subsystem qualification. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { BSON, MongoClient, type Db, type Document } from "mongodb";
import { prepareOverlap, MODERN_KEYS, digest } from "./crisisOverlapSetup";
import { processLivingConflictsTurn } from "../../src/lib/livingConflict/processTurn";
import { autoResolveCrisisInteraction } from "../../src/lib/crises/interactionEngine";
import { runMetricEngine } from "../../src/lib/metricEngine/phase";
import { runDemographicFlows } from "../../src/lib/demographics/phase";
import { processMacroCountryTurn } from "../../src/lib/world/macro/macroCountryTurn";
import { computeMacroContribution } from "../../src/lib/world/macro/kernel";
import { processCommodityPriceTurn } from "../../src/lib/turn/commodityPriceTurn";
import { loadFinancialCrisisDemand } from "../../src/lib/livingConflict/financialDemand";
import { computeHouseholdConsumption } from "../../src/lib/turn/householdConsumption";
import { pandemicMortality } from "../../src/lib/livingConflict/rules/pandemic";
import { crisisMacroOutputMultiplier } from "../../src/lib/livingConflict/rules/economicExposure";
import type { Crisis, CrisisInteraction } from "../../src/lib/db/types/crisis";
import type { Corporation, FederalBudget } from "../../src/lib/db/types";
import type { LivingConflictState } from "../../src/lib/livingConflict/types";
import type { MacroCountryState } from "../../src/lib/world/macro/types";

const arg = (key: string) =>
  process.argv.find((value) => value.startsWith(`--${key}=`))?.slice(key.length + 3);
const output = (country: MacroCountryState) =>
  Object.values(country.contribution.bySector).reduce(
    (sum, sector) => sum + (sector?.output ?? 0),
    0
  );
const near = (a: number, b: number) =>
  assert(Math.abs(a - b) <= Math.max(0.000001, Math.abs(b) * 1e-9), `${a} != ${b}`);
async function stocks(db: Db) {
  const rows = await db
    .collection<{
      _id: string;
      countryId: string;
      gdp: number;
      population: number;
      workingAgePopulation?: number;
    }>("states")
    .find({})
    .toArray();
  const metrics = await db.collection("macroMetrics").find({}).toArray();
  for (const row of rows) assert(Number.isFinite(row.gdp) && row.gdp > 0 && row.population > 0);
  const unemployment = metrics
    .map((row) => row.economic?.unemploymentRate?.value)
    .filter((v): v is number => typeof v === "number");
  assert(
    unemployment.length > 0 && unemployment.every((v) => Number.isFinite(v) && v >= 0 && v <= 100)
  );
  return {
    population: rows.reduce((s, r) => s + r.population, 0),
    workingAge: rows.reduce((s, r) => s + (r.workingAgePopulation ?? 0), 0),
    unemploymentMin: Math.min(...unemployment),
    unemploymentMax: Math.max(...unemployment),
    regions: rows.map((row) => ({
      id: row._id,
      countryId: row.countryId,
      population: row.population,
      workingAge: row.workingAgePopulation,
      gdp: row.gdp,
    })),
  };
}
async function main() {
  const uri = process.env.SIM_MONGODB_URI,
    source = arg("source"),
    finance = arg("finance"),
    arab = arg("arab"),
    target = arg("target"),
    out = arg("out");
  assert(uri && /^mongodb:\/\/(127\.0\.0\.1|localhost):27018\/?$/.test(uri));
  assert(source && finance && arab && target && out);
  for (const name of [source, finance, arab, target])
    assert(/^ahd_sim_[a-zA-Z0-9_-]{1,55}$/.test(name));
  assert(
    [source, finance, arab].every(
      (name) => ![`${target}_control`, `${target}_combined`].includes(name)
    )
  );
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = () => !!execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
  assert(!dirty() || process.argv.includes("--development"), "Clean source required");
  const client = await new MongoClient(uri, { monitorCommands: true }).connect();
  Object.assign(process.env, { NODE_ENV: "test", MONGODB_URI: uri });
  global._mongoClientPromise = Promise.resolve(client);
  let sourceWrites = 0;
  let phase = "",
    dbName = "",
    commands = 0,
    bytes = 0;
  const performance: Record<string, { calls: number; maxCommands: number; maxReadBytes: number }> =
    {};
  client.on("commandStarted", (event) => {
    if (
      [source, finance, arab].includes(event.databaseName) &&
      ["insert", "update", "delete", "findAndModify", "drop", "dropDatabase"].includes(
        event.commandName
      )
    )
      sourceWrites++;
    if (phase && event.databaseName === dbName) commands++;
  });
  client.on("commandSucceeded", (event) => {
    if (!phase) return;
    const reply = event.reply as { cursor?: { firstBatch?: Document[]; nextBatch?: Document[] } };
    for (const row of reply.cursor?.firstBatch ?? reply.cursor?.nextBatch ?? [])
      bytes += BSON.calculateObjectSize(row);
  });
  async function measure<T>(name: string, fn: () => Promise<T>) {
    phase = name;
    commands = 0;
    bytes = 0;
    try {
      return await fn();
    } finally {
      const p = (performance[name] ??= { calls: 0, maxCommands: 0, maxReadBytes: 0 });
      p.calls++;
      p.maxCommands = Math.max(p.maxCommands, commands);
      p.maxReadBytes = Math.max(p.maxReadBytes, bytes);
      phase = "";
    }
  }
  try {
    const setup = await prepareOverlap(client, source, finance, arab);
    const results: Document[] = [];
    const turns = Number(arg("turns") ?? 48);
    assert(Number.isInteger(turns) && turns >= 24 && turns <= 144);
    for (const scenario of ["control", "combined"]) {
      dbName = `${target}_${scenario}`;
      process.env.MONGODB_DB = dbName;
      const db = client.db(dbName),
        combined = scenario === "combined";
      assert.equal((await db.listCollections().toArray()).length, 0, "Target must be empty");
      for (const [name, rows] of setup.saved)
        if (rows.length) await db.collection(name).insertMany(rows);
      // Native BSON IDs are preserved by Mongo inserts; conflict IDs are omitted
      // because the source reports also contain stringified snapshot IDs.
      for (const original of setup.states) {
        const state = { ...original };
        delete (state as LivingConflictState & { _id?: unknown })._id;
        if (!combined) {
          state.hasOpened = false;
          state.status = "closed";
        }
        await db.collection<LivingConflictState>("livingConflicts").insertOne(state);
      }
      await db.collection("gameState").updateOne(
        { _id: "current" as never },
        {
          $set: {
            livingConflictsEnabled: combined,
            crisisInteractionEnabled: true,
            currentTurn: 2000,
            currentYear: 2027,
            householdConsumptionEnabled: true,
          },
        }
      );
      const banks = await db
        .collection<Corporation>("corporations")
        .find({ bankCharter: { $exists: true } })
        .toArray();
      const budgets = await db.collection<FederalBudget>("federalBudget").find({}).toArray();
      const credit = banks
        .filter((b) => b.countryId === "DE" && b.bankCharter?.status === "active")
        .reduce((sum, b) => sum + (b.bankCharter?.totalLoans ?? 0), 0);
      // Re-anchor the documented, already executed 6M default as a recent credit
      // observation. This is a stress-fixture history, not a new loan/default.
      await db.collection("financialCrisisCreditHistory").insertOne({
        _id: "DE" as never,
        observations: [{ turn: 1999, credit: credit + setup.failedPrincipal }],
      });
      const initial = await stocks(db);
      const fiscalHash = digest(
        await db.collection("federalBudget").find({}).sort({ _id: 1 }).toArray()
      );
      const samples: Document[] = [],
        windows: Record<string, number> = {},
        peakByCountry: Record<string, number> = {};
      let peakConcurrent = 0,
        maxPerFamily = 0,
        resolutions = 0,
        retries = 0,
        peakDisease = 0,
        minimumMacroRatio = 1,
        peakHosting = 0,
        peakDisplaced = 0,
        minDemand = 1,
        maxDemand = 1;
      for (let offset = 0; offset < turns; offset++) {
        const turn = 2000 + offset;
        await db
          .collection("gameState")
          .updateOne(
            { _id: "current" as never },
            { $set: { currentTurn: turn, currentYear: 2027 + offset / 48 } }
          );
        if (combined) {
          const open = await db.collection<Crisis>("crises").find({ status: "active" }).toArray();
          for (const crisis of open)
            if (crisis.startTurn + (crisis.durationTurns ?? 24) <= turn) {
              const interaction = await db
                .collection<CrisisInteraction>("crisisInteractions")
                .findOne({ crisisId: crisis._id });
              if (interaction) {
                await measure("expiry", () => autoResolveCrisisInteraction(db, interaction._id));
                resolutions++;
              }
              await db
                .collection<Crisis>("crises")
                .updateOne({ _id: crisis._id }, { $set: { status: "resolved" } });
            }
          await measure("sevenFamilyDriver", () =>
            processLivingConflictsTurn(db, turn, 2027 + offset / 48, true)
          );
          const before = digest(
            await db.collection("livingConflicts").find({}).sort({ defKey: 1 }).toArray()
          );
          await processLivingConflictsTurn(db, turn, 2027 + offset / 48, true);
          assert.equal(
            digest(await db.collection("livingConflicts").find({}).sort({ defKey: 1 }).toArray()),
            before,
            "Same-turn driver retry changed state"
          );
          retries++;
          const openNow = await db
            .collection<Crisis>("crises")
            .find({ status: "active" })
            .toArray();
          const familyCount: Record<string, number> = {},
            countryCount: Record<string, number> = {};
          for (const crisis of openNow) {
            const key =
              crisis.globalResponse?.conflictKey ?? crisis.livingConflictEventId?.split(":")[0];
            assert(key && MODERN_KEYS.includes(key));
            familyCount[key] = (familyCount[key] ?? 0) + 1;
            for (const country of crisis.countryIds ?? [])
              countryCount[country] = (countryCount[country] ?? 0) + 1;
            if (crisis.startTurn === turn) windows[key] = (windows[key] ?? 0) + 1;
          }
          maxPerFamily = Math.max(maxPerFamily, ...Object.values(familyCount));
          peakConcurrent = Math.max(peakConcurrent, openNow.length);
          for (const [id, count] of Object.entries(countryCount))
            peakByCountry[id] = Math.max(peakByCountry[id] ?? 0, count);
          assert(maxPerFamily <= 1, "A family has duplicate active windows");
          assert(peakConcurrent <= 7);
        }
        const financialDemand = await measure("creditDemand", () =>
          loadFinancialCrisisDemand(db, turn, banks, budgets)
        );
        for (const value of financialDemand.values()) {
          assert(value >= 0.8 && value <= 1.2);
          minDemand = Math.min(minDemand, value);
          maxDemand = Math.max(maxDemand, value);
        }
        if (offset % 12 === 0) await measure("commodity", () => processCommodityPriceTurn(turn));
        // Match ordinary phase order: demographic stock changes feed next turn's metrics.
        await measure("metrics", () => runMetricEngine(db, turn));
        await measure("demographics", () => runDemographicFlows(db, turn));
        await measure("macro", () => processMacroCountryTurn(db, turn));
        const conflicts = await db
          .collection<LivingConflictState>("livingConflicts")
          .find({ defKey: { $in: MODERN_KEYS } })
          .toArray();
        const disease = conflicts.find((row) => row.defKey === "pandemic");
        for (const country of ["US", "UK", "DE", "IE", "PL", "TR"]) {
          const value = pandemicMortality(disease, country);
          assert(value >= 0 && value <= 0.012);
          peakDisease = Math.max(peakDisease, value);
        }
        const macro = await db.collection<MacroCountryState>("macroCountries").find({}).toArray();
        const macroRows = [];
        for (const country of macro)
          if (country.lastMacroTickTurn === turn) {
            const exposure = country.livingConflictExposure;
            if (exposure) {
              assert(
                exposure.displacedShare <= 0.1 &&
                  exposure.hostingShare <= 0.005 &&
                  exposure.infrastructureDamage <= 1
              );
              assert(crisisMacroOutputMultiplier(exposure) >= 0.716 - 1e-9);
              peakHosting = Math.max(peakHosting, exposure.hostingShare);
              peakDisplaced = Math.max(peakDisplaced, exposure.displacedShare);
            }
            const baseline = output({
              ...country,
              contribution: computeMacroContribution(country, turn),
            });
            const ratio = baseline > 0 ? output(country) / baseline : 1;
            assert(ratio >= 0.6802 - 1e-9 && ratio <= 1 + 1e-9);
            minimumMacroRatio = Math.min(minimumMacroRatio, ratio);
            macroRows.push({ country: country.entityId, ratio, exposure });
          }
        const arabState = conflicts.find((row) => row.defKey === "arab_uprisings")?.arabRegional;
        if (combined && arabState)
          near(
            Object.values(arabState.hosts).reduce((sum, host) => sum + host.refugeePeople, 0),
            Object.values(arabState.origins).reduce(
              (sum, origin) =>
                sum + (origin ? (origin.population * origin.displacement) / 2000 : 0),
              0
            )
          );
        if (offset % 6 === 0 || offset === turns - 1) {
          const boundary = await stocks(db);
          const states = boundary.regions.map((row) => ({
            stateId: row.id,
            countryId: row.countryId,
            gdp: row.gdp,
            population: row.population,
          }));
          const household = computeHouseholdConsumption({
            states,
            metricsByState: new Map(),
            financialDemandByCountry: financialDemand,
          });
          const noCredit = computeHouseholdConsumption({ states, metricsByState: new Map() });
          samples.push({
            turn,
            ...boundary,
            demand: Object.fromEntries(financialDemand),
            foodDemand: household.global.get("food"),
            foodWithoutCreditShock: noCredit.global.get("food"),
            macroRows,
          });
        }
      }
      if (combined) {
        assert(
          MODERN_KEYS.every((key) => (windows[key] ?? 0) > 0),
          `Missing family windows: ${JSON.stringify(windows)}`
        );
        assert(peakDisease > 0 && peakDisplaced > 0 && minimumMacroRatio < 1 && minDemand < 1);
        assert.equal(samples.at(-1)!.demand.DE, 1);
      }
      const interactions = await db
        .collection<CrisisInteraction>("crisisInteractions")
        .find({})
        .toArray();
      assert(
        interactions.every((row) => (row.leaderResponses?.length ?? 0) === 0),
        "No player consent supplied"
      );
      results.push({
        scenario,
        initial,
        final: await stocks(db),
        windows,
        peakConcurrent,
        maxPerFamily,
        peakByCountry,
        resolutions,
        retries,
        actualPlayerDecisions: 0,
        peakDisease,
        minimumMacroRatio,
        peakHosting,
        peakDisplaced,
        minDemand,
        maxDemand,
        samples,
        fiscalUnchanged:
          fiscalHash ===
          digest(await db.collection("federalBudget").find({}).sort({ _id: 1 }).toArray()),
      });
      console.log(
        JSON.stringify({ scenario, windows, peakConcurrent, minimumMacroRatio, minDemand })
      );
    }
    const control = results[0],
      combined = results[1];
    assert(
      combined.final.population < control.final.population,
      "Disease must change actual population"
    );
    assert(
      combined.final.workingAge < control.final.workingAge,
      "Disease must change actual workforce stock"
    );
    await setup.assertPreserved();
    assert.equal(sourceWrites, 0);
    assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), commit);
    assert(!dirty() || process.argv.includes("--development"));
    writeFileSync(
      out,
      JSON.stringify(
        {
          sourceCommit: commit,
          sourceDirty: dirty(),
          scope:
            "Synthetic simultaneous composition of qualified subsystem states; not a historical or full-world simulation",
          turns,
          provenance: setup.provenance,
          sourcePreserved: true,
          sourceWrites,
          results,
          performance,
          paired: {
            additionalPopulationLoss: control.final.population - combined.final.population,
            additionalWorkingAgeLoss: control.final.workingAge - combined.final.workingAge,
            gdpRatiosByRegion: combined.final.regions.map(
              (row: { id: string; countryId: string; gdp: number }) => ({
                regionId: row.id,
                countryId: row.countryId,
                ratio:
                  row.gdp /
                  control.final.regions.find(
                    (other: { id: string; gdp: number }) => other.id === row.id
                  ).gdp,
              })
            ),
          },
        },
        null,
        2
      ) + "\n"
    );
    console.log(JSON.stringify({ ok: true, out }));
  } finally {
    await client.close();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
