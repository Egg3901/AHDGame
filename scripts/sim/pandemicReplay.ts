/**
 * Continue retained economic and population cohorts with actual pandemic commands.
 * Synthetic leaders choose explicit policies; only an isolated sandbox is writable.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { BSON, MongoClient, ObjectId, type Document } from "mongodb";
import { PANDEMIC_DEF as def } from "../../src/lib/livingConflict/defs/pandemic";
import { driveConflictTurn, loadConflictState } from "../../src/lib/livingConflict/driver";
import { normalizeConflictState } from "../../src/lib/livingConflict/engine";
import {
  pandemicParticipants,
  pandemicMortality,
  pandemicVaccineReady,
} from "../../src/lib/livingConflict/rules/pandemic";
import { materializeLivingConflictEvent } from "../../src/lib/livingConflict/processTurn";
import {
  resolveCharacterRoles,
  submitCrisisDecision,
} from "../../src/lib/crises/interactionEngine";
import { resolveGlobalResponse } from "../../src/lib/livingConflict/globalResponse";
import { runDemographicFlows } from "../../src/lib/demographics/phase";
import { processPoliticalMetricsDynamics } from "../../src/lib/turn/politicalMetricsDynamics";
import { buildPoliticalBaseModifiers } from "../../src/lib/politicalLegislation/marginAdapter";
import type {
  Crisis,
  CrisisInteraction,
  CrisisDecisionNode,
  CrisisDecisionOption,
  GlobalResponseRole,
} from "../../src/lib/db/types/crisis";
import type { LivingConflictState } from "../../src/lib/livingConflict/types";
import type { PoliticalMetricsDoc } from "../../src/lib/db/types/politicalMetrics";
import type { FederalBudget } from "../../src/lib/db/types/budget";

const arg = (name: string) =>
  process.argv.find((s) => s.startsWith(`--${name}=`))?.slice(name.length + 3);
const countries = ["US", "UK", "DE", "JP", "IE"];
const strategies = [
  "legacy_recovery",
  "cooperation",
  "delay",
  "inaction",
  "nationalism",
  "relapse",
];
const offices = ["president", "primeMinister", "chancellor", "primeMinister", "taoiseach"];
const leaders = countries.map((countryId, i) => ({
  _id: new ObjectId((400 + i).toString(16).padStart(24, "0")),
  name: `Synthetic ${countryId} executive`,
  countryId,
  currentOffice: { type: offices[i] },
}));
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const population = (rows: Document[]) => rows.reduce((sum, row) => sum + row.population, 0);
async function main() {
  const uri = process.env.SIM_MONGODB_URI,
    sourceName = arg("source"),
    targetName = arg("target"),
    output = arg("out");
  assert(uri && /^mongodb:\/\/(127\.0\.0\.1|localhost):27018\/?$/.test(uri));
  assert(sourceName && targetName && sourceName !== targetName && output);
  for (const name of [sourceName, targetName]) assert(/^ahd_sim_[a-zA-Z0-9_-]{1,64}$/.test(name));
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = () =>
    Boolean(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim());
  const sourceDirty = dirty();
  assert(!sourceDirty || process.argv.includes("--development"));
  const client = await new MongoClient(uri, { monitorCommands: true }).connect();
  const source = client.db(sourceName),
    db = client.db(targetName);
  Object.assign(process.env, { NODE_ENV: "test", MONGODB_URI: uri, MONGODB_DB: targetName });
  global._mongoClientPromise = Promise.resolve(client);
  let phase = "",
    commands = 0,
    bytes = 0;
  const performance: Record<string, Array<{ commands: number; readBsonBytes: number }>> = {};
  client.on("commandStarted", (e) => {
    if (phase && e.databaseName === targetName) commands++;
  });
  client.on("commandSucceeded", (e) => {
    if (!phase) return;
    const reply = e.reply as { cursor?: { firstBatch?: Document[]; nextBatch?: Document[] } };
    for (const row of reply.cursor?.firstBatch ?? reply.cursor?.nextBatch ?? [])
      bytes += BSON.calculateObjectSize(row);
  });
  async function measure<T>(name: string, fn: () => Promise<T>): Promise<T> {
    phase = name;
    commands = 0;
    bytes = 0;
    try {
      return await fn();
    } finally {
      (performance[name] ??= []).push({ commands, readBsonBytes: bytes });
      phase = "";
    }
  }
  try {
    assert.equal((await db.listCollections().toArray()).length, 0, "Target must be empty");
    const run = await source.collection("simRuns").findOne({ status: "completed" });
    assert(run?.source?.executedCommit);
    const sourceRegions = await source
      .collection("regionDemographics")
      .find({ countryId: { $in: countries } })
      .sort({ _id: 1 })
      .toArray();
    const regionIds = countries.map(
      (country) => sourceRegions.find((r) => r.countryId === country)?._id
    );
    assert(regionIds.every(Boolean));
    const countryFilter = { countryId: { $in: countries } },
      regionFilter = { _id: { $in: regionIds } };
    const filters: Record<string, Document> = {
      gameState: { _id: "current" },
      states: regionFilter,
      regionDemographics: regionFilter,
      macroMetrics: regionFilter,
      politicalMetrics: regionFilter,
      federalBudget: countryFilter,
      statePolicies: countryFilter,
      enactedLaws: countryFilter,
      regionalBudgets: countryFilter,
      stateBudgets: countryFilter,
      governmentApprovals: { _id: { $in: countries } },
      livingConflicts: { defKey: def.key },
    };
    const saved = await Promise.all(
      Object.entries(filters).map(
        async ([name, filter]) =>
          [name, await source.collection(name).find(filter).sort({ _id: 1 }).toArray()] as const
      )
    );
    const retainedHash = hash(saved);
    const initialGame = saved.find(([name]) => name === "gameState")![1][0];
    const legacy = saved.find(([name]) => name === "livingConflicts")![1][0];
    assert.equal(legacy.phaseLevel, 2);
    assert.equal(legacy.tracks.transmission, 100);
    assert.equal(legacy.campaign.consequences.casualties, 0);
    const startTurn = Number(initialGame.currentTurn),
      length = Number(arg("turns") ?? 768);
    const selected = strategies.filter((s) => !arg("scenario") || arg("scenario") === s);
    assert(selected.length);
    const results: Document[] = [];
    for (const strategy of selected) {
      for (const { name } of await db.listCollections().toArray())
        await db.collection(name).deleteMany({});
      for (const [name, rows] of saved) if (rows.length) await db.collection(name).insertMany(rows);
      await db
        .collection("gameState")
        .updateOne(
          { _id: "current" as never },
          { $set: { livingConflictsEnabled: true, crisisInteractionEnabled: true } }
        );
      await db.collection("characters").insertMany(leaders);
      const roles = new Map(
        await Promise.all(
          leaders.map(async (a) => [a.countryId, await resolveCharacterRoles(db, a)] as const)
        )
      );
      const participants = pandemicParticipants(
        new Set(countries),
        initialGame.currentYear,
        legacy.pandemicOriginCountryId
      );
      if (strategy !== "legacy_recovery") {
        // Counterfactual fresh outbreak in the retained economy, not a retained historical trajectory.
        await db.collection<LivingConflictState>("livingConflicts").replaceOne(
          { defKey: def.key },
          normalizeConflictState(def, {
            defKey: def.key,
            hasOpened: true,
            phaseLevel: 1,
            openedYear: initialGame.currentYear,
            pandemicOriginCountryId: participants.belligerents[0],
          })
        );
      }
      let state = await loadConflictState(db, def.key),
        previousPhase = state.phaseLevel;
      let windows = 0,
        choices = 0,
        retries = 0,
        firstVaccine: number | null = null;
      const timeline: Document[] = [],
        snapshots: Document[] = [],
        policyCosts: Record<string, number> = {};
      const popBefore = population(await db.collection("states").find({}).toArray());
      async function snapshot(turn: number, baseline = false) {
        if (baseline)
          await db
            .collection("gameState")
            .updateOne({ _id: "current" as never }, { $set: { livingConflictsEnabled: false } });
        await measure(baseline ? "baselinePolitics" : "politicalDynamics", () =>
          processPoliticalMetricsDynamics(db, turn)
        );
        if (baseline)
          await db
            .collection("gameState")
            .updateOne({ _id: "current" as never }, { $set: { livingConflictsEnabled: true } });
        const boards = await db
          .collection<PoliticalMetricsDoc>("politicalMetrics")
          .find({})
          .toArray();
        snapshots.push({
          turn,
          phase: state.phaseLevel,
          tracks: state.tracks,
          casualties: state.campaign?.consequences.casualties,
          population: population(await db.collection("states").find({}).toArray()),
          annualExcessMortality: Object.fromEntries(
            countries.map((country) => [country, pandemicMortality(state, country)])
          ),
          boards: boards.map((b) => ({
            regionId: b._id,
            countryId: b.countryId,
            effects: b.livingConflictResiduals,
            values: b.values,
            marginSignals: Object.fromEntries(buildPoliticalBaseModifiers(b.values)),
          })),
        });
      }
      // Paired actual demographic phase isolates the disease mortality input.
      const restoreNames = ["states", "regionDemographics", "macroMetrics"];
      const beforeProbe = await Promise.all(
        restoreNames.map(
          async (name) => [name, await db.collection(name).find({}).toArray()] as const
        )
      );
      await db
        .collection("gameState")
        .updateOne({ _id: "current" as never }, { $set: { livingConflictsEnabled: false } });
      await measure("baselineDemographics", () => runDemographicFlows(db, startTurn));
      const controlPopulation = population(await db.collection("states").find({}).toArray());
      for (const [name, rows] of beforeProbe) {
        await db.collection(name).deleteMany({});
        await db.collection(name).insertMany(rows);
      }
      await db
        .collection("gameState")
        .updateOne({ _id: "current" as never }, { $set: { livingConflictsEnabled: true } });
      await measure("diseaseDemographics", () => runDemographicFlows(db, startTurn));
      const treatmentPopulation = population(await db.collection("states").find({}).toArray());
      assert(
        controlPopulation > treatmentPopulation,
        "Actual disease deaths reduce saved cohort population"
      );
      for (const [name, rows] of beforeProbe) {
        await db.collection(name).deleteMany({});
        await db.collection(name).insertMany(rows);
      }
      await snapshot(startTurn, true);
      for (let offset = 1; offset <= length; offset++) {
        const turn = startTurn + offset,
          year = initialGame.startingYear + Math.floor((turn - 1) / 48);
        await db
          .collection("gameState")
          .updateOne(
            { _id: "current" as never },
            { $set: { currentTurn: turn, currentYear: year } }
          );
        for (const crisis of await db
          .collection<Crisis>("crises")
          .find({ status: "active" })
          .toArray()) {
          if (turn < crisis.startTurn + (crisis.durationTurns ?? 12)) continue;
          const outcome = await measure("responseResolution", () =>
            resolveGlobalResponse(db, crisis._id)
          );
          assert(outcome);
          const after = JSON.stringify(await loadConflictState(db, def.key));
          assert.deepEqual(await resolveGlobalResponse(db, crisis._id), outcome);
          assert.equal(JSON.stringify(await loadConflictState(db, def.key)), after);
          retries++;
          await db
            .collection<Crisis>("crises")
            .updateOne(
              { _id: crisis._id },
              { $set: { status: "resolved", endTurn: turn, resolvedAt: new Date() } }
            );
        }
        const driven = await measure("conflictDriver", () =>
          driveConflictTurn(db, def, participants, turn, year)
        );
        state = driven.state;
        if (offset % 24 === 0 || driven.events.some((e) => e.fired.event.response)) {
          const before = JSON.stringify(await loadConflictState(db, def.key));
          assert.equal(
            (await driveConflictTurn(db, def, participants, turn, year)).events.length,
            0
          );
          assert.equal(JSON.stringify(await loadConflictState(db, def.key)), before);
          retries++;
        }
        for (const event of driven.events.filter((e) => e.fired.event.response)) {
          const materialized = await measure("materializeEvent", () =>
            materializeLivingConflictEvent(db, def, participants, event, turn)
          );
          if (!materialized.opened) continue;
          windows++;
          const crisis = await db
            .collection<Crisis>("crises")
            .findOne({ livingConflictEventId: event.fired.id });
          assert(crisis);
          const interaction = await db
            .collection<CrisisInteraction>("crisisInteractions")
            .findOne({ crisisId: crisis._id });
          assert(interaction);
          assert(
            !(await materializeLivingConflictEvent(db, def, participants, event, turn)).opened
          );
          retries++;
          let selection = [
            "restrict",
            "targeted_controls",
            "research_pool",
            "expand_manufacturing",
            "covax",
          ];
          if (offset > 144 || strategy === "legacy_recovery")
            selection = [
              "targeted_controls",
              "covax",
              "covax",
              "expand_manufacturing",
              "research_pool",
            ];
          if (
            strategy === "inaction" ||
            (strategy === "delay" && offset < 120) ||
            (strategy === "relapse" && offset > 288 && offset < 672)
          )
            selection = Array<string>(5).fill("defer");
          if (strategy === "nationalism")
            selection = [
              "targeted_controls",
              "domestic_priority",
              "domestic_priority",
              "research_pool",
              "expand_manufacturing",
            ];
          for (let i = 0; i < leaders.length; i++) {
            const actor = leaders[i],
              id = selection[i];
            const node: CrisisDecisionNode = interaction.decisionTree[0];
            const role: GlobalResponseRole = crisis.globalResponse!.roleByCountry[actor.countryId];
            const option: CrisisDecisionOption | undefined = node.optionsByRole?.[role]?.find(
              (o) => o.optionId === id
            );
            assert(option, `${actor.countryId}:${id}`);
            const before = await db
              .collection<FederalBudget>("federalBudget")
              .findOne({ countryId: actor.countryId as FederalBudget["countryId"] });
            assert(before);
            await measure("playerDecision", () =>
              submitCrisisDecision(
                db,
                interaction._id,
                id,
                actor._id,
                actor.countryId,
                roles.get(actor.countryId)
              )
            );
            const after = await db
              .collection<FederalBudget>("federalBudget")
              .findOne({ _id: before._id });
            assert(after);
            const cost = Math.round(
              (before.gdpSmoothed && before.gdpSmoothed > 0 ? before.gdpSmoothed : before.gdp) *
                (option.treasuryCostPctGdp ?? 0)
            );
            assert(Math.abs(before.treasuryBalance! - after.treasuryBalance! - cost) <= 1);
            policyCosts[actor.countryId] = (policyCosts[actor.countryId] ?? 0) + cost;
            if (windows === 1 || offset % 48 === 0) {
              await assert.rejects(
                submitCrisisDecision(
                  db,
                  interaction._id,
                  id,
                  actor._id,
                  actor.countryId,
                  roles.get(actor.countryId)
                ),
                /already/
              );
              assert.equal(
                (await db.collection<FederalBudget>("federalBudget").findOne({ _id: before._id }))!
                  .treasuryBalance,
                after.treasuryBalance
              );
              retries++;
            }
            choices++;
          }
        }
        await measure("demographics", () => runDemographicFlows(db, turn));
        if (firstVaccine === null && pandemicVaccineReady(state)) firstVaccine = offset;
        if (state.phaseLevel !== previousPhase) {
          timeline.push({
            offset,
            turn,
            year,
            from: previousPhase,
            to: state.phaseLevel,
            tracks: state.tracks,
          });
          previousPhase = state.phaseLevel;
          await snapshot(turn);
        } else if (offset % 48 === 0) {
          await snapshot(turn);
          console.log(JSON.stringify({ strategy, offset, phase: state.phaseLevel }));
        }
        for (const value of Object.values(state.tracks ?? {}))
          assert(Number.isFinite(value) && value >= 0 && value <= 100);
      }
      assert(state.campaign!.consequences.casualties > 0);
      if (strategy === "legacy_recovery")
        assert(timeline.some((e) => e.to === 3) && timeline.some((e) => e.to === 5));
      if (["cooperation", "delay"].includes(strategy)) assert.equal(state.phaseLevel, 5);
      if (strategy === "inaction") assert.equal(firstVaccine, null);
      if (strategy === "relapse") assert(timeline.some((e) => e.from === 5 && e.to === 3));
      const unchanged = await Promise.all(
        Object.entries(filters).map(
          async ([name, filter]) =>
            [name, await source.collection(name).find(filter).sort({ _id: 1 }).toArray()] as const
        )
      );
      assert.equal(hash(unchanged), retainedHash);
      const result = {
        strategy,
        startTurn,
        finalTurn: startTurn + length,
        windows,
        choices,
        retries,
        firstVaccine,
        timeline,
        snapshots,
        policyCosts,
        initialPopulation: popBefore,
        finalPopulation: population(await db.collection("states").find({}).toArray()),
        pairedDiseaseDeaths: controlPopulation - treatmentPopulation,
        finalState: state,
        sourcePreserved: true,
      };
      results.push(result);
      writeFileSync(`${output}.${strategy}.checkpoint.json`, JSON.stringify(result, null, 2));
    }
    assert(!dirty() || process.argv.includes("--development"));
    writeFileSync(
      output,
      JSON.stringify(
        {
          sourceCommit,
          sourceDirty,
          sourceDirtyAtEnd: dirty(),
          retainedRun: {
            id: run.runId,
            sourceCommit: run.source.executedCommit,
            savedTurn: startTurn,
          },
          retainedHash,
          retainedCollections: saved.map(([name, rows]) => ({ name, count: rows.length })),
          scope:
            "Five retained regional population/economic cohorts. Legacy recovery preserves saved disease; five counterfactual scenarios start a synthetic fresh outbreak in that retained economy. Synthetic executive choices use real commands. Demographics every turn, politics annually and at transitions. Other world phases held fixed.",
          performance,
          results,
        },
        null,
        2
      )
    );
  } finally {
    await client.close();
  }
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
