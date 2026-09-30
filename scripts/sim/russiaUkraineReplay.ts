/** Saved-world crisis continuation. Explicit synthetic policies; no live database access. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { MongoClient, ObjectId, BSON, type Document } from "mongodb";
import { RUSSIA_UKRAINE_DEF as def } from "../../src/lib/livingConflict/defs/russiaUkraine";
import { driveConflictTurn, loadConflictState } from "../../src/lib/livingConflict/driver";
import { resolveConflictParticipants } from "../../src/lib/livingConflict/rules/participants";
import { materializeLivingConflictEvent } from "../../src/lib/livingConflict/processTurn";
import {
  resolveCharacterRoles,
  submitCrisisDecision,
} from "../../src/lib/crises/interactionEngine";
import {
  resolveGlobalResponse,
  optionAvailabilityForGlobalResponder,
} from "../../src/lib/livingConflict/globalResponse";
import { processMacroCountryTurn } from "../../src/lib/world/macro/macroCountryTurn";
import { computeMacroContribution } from "../../src/lib/world/macro/kernel";
import type { MacroCountryState } from "../../src/lib/world/macro/types";
import type { Crisis, CrisisInteraction } from "../../src/lib/db/types/crisis";
import type { FederalBudget } from "../../src/lib/db/types/budget";

const arg = (key: string) =>
  process.argv.find((v) => v.startsWith(`--${key}=`))?.slice(key.length + 3);
const strategies = [
  "neutrality",
  "deterrence",
  "proxy",
  "frozen",
  "limited",
  "invasion_recovery",
  "prolonged",
  "counterfactual",
] as const;
type Strategy = (typeof strategies)[number];
const countries = ["UKR", "RU", "US", "PL", "DE", "UK", "IE", "FR"];
const offices = [
  "chairmanOfPresidium",
  "president",
  "president",
  "president",
  "chancellor",
  "primeMinister",
  "taoiseach",
  "president",
];
const leaders = countries.map((countryId, i) => ({
  _id: new ObjectId((i + 200).toString(16).padStart(24, "0")),
  countryId,
  name: `Synthetic ${countryId} executive`,
  currentOffice: { type: offices[i] },
}));

function choice(strategy: Strategy, country: string, role: string, offset: number): string {
  const peace =
    strategy === "neutrality" ||
    strategy === "counterfactual" ||
    (strategy === "limited" && offset > 24) ||
    ((strategy === "invasion_recovery" || strategy === "frozen") && offset > 240);
  if (role === "belligerent") return "uk_neutral";
  if (role === "backer_a")
    return peace
      ? "ru_bargain"
      : strategy === "proxy" || strategy === "frozen"
        ? "ru_proxy"
        : "ru_invade";
  if (role === "backer_b")
    return peace ? "us_talks" : strategy === "deterrence" ? "us_aid" : "us_sanctions";
  if (role === "neighbor")
    return strategy === "deterrence" ? "transit_aid" : peace ? "mediate" : "receive_refugees";
  if (role === "bloc")
    return strategy === "deterrence" && (country === "DE" || country === "UK")
      ? "eu_guarantees"
      : peace
        ? "eu_guarantees"
        : "eu_sanctions";
  return peace ? "un_mediation" : "relief";
}

async function main() {
  const uri = process.env.SIM_MONGODB_URI,
    sourceName = arg("source"),
    targetName = arg("target"),
    out = arg("out");
  assert(uri && /^mongodb:\/\/(127\.0\.0\.1|localhost):27018\/?$/.test(uri));
  assert(sourceName && targetName && sourceName !== targetName && out);
  for (const name of [sourceName, targetName]) assert(/^ahd_sim_[a-zA-Z0-9_-]{1,64}$/.test(name));
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = () => execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
  const development = !!dirty();
  assert(!development || process.argv.includes("--development"), "Commit before qualification");
  const client = await new MongoClient(uri, { monitorCommands: true }).connect();
  const source = client.db(sourceName),
    db = client.db(targetName);
  Object.assign(process.env, { NODE_ENV: "test", MONGODB_URI: uri, MONGODB_DB: targetName });
  global._mongoClientPromise = Promise.resolve(client);
  let measuring = "",
    commands = 0,
    readBytes = 0;
  const measurements: Record<string, { calls: number; maxCommands: number; maxReadBytes: number }> =
    {};
  client.on("commandStarted", (event) => {
    if (measuring && event.databaseName === targetName) commands++;
  });
  client.on("commandSucceeded", (event) => {
    if (!measuring) return;
    const reply = event.reply as { cursor?: { firstBatch?: Document[]; nextBatch?: Document[] } };
    for (const row of reply.cursor?.firstBatch ?? reply.cursor?.nextBatch ?? [])
      readBytes += BSON.calculateObjectSize(row);
  });
  async function measure<T>(name: string, fn: () => Promise<T>) {
    measuring = name;
    commands = 0;
    readBytes = 0;
    try {
      return await fn();
    } finally {
      const m = (measurements[name] ??= { calls: 0, maxCommands: 0, maxReadBytes: 0 });
      m.calls++;
      m.maxCommands = Math.max(m.maxCommands, commands);
      m.maxReadBytes = Math.max(m.maxReadBytes, readBytes);
      measuring = "";
    }
  }
  try {
    assert.equal((await db.listCollections().toArray()).length, 0, "Preserve existing evidence");
    const sourceRun = await source.collection("simRuns").findOne({ status: "completed" });
    assert(sourceRun?.source?.executedCommit);
    const filter = { countryId: { $in: countries } };
    const filters: Record<string, Document> = {
      gameState: { _id: "current" },
      states: filter,
      federalBudget: filter,
      macroMetrics: filter,
      stateMetrics: filter,
      politicalMetrics: filter,
      governmentApprovals: { _id: { $in: countries } },
      militaryUnits: filter,
      macroCountries: { _id: { $in: ["UKR", "PL", "CA", "YU"] } },
    };
    const snapshot = await Promise.all(
      Object.entries(filters).map(
        async ([name, query]) =>
          [name, await source.collection(name).find(query).sort({ _id: 1 }).toArray()] as const
      )
    );
    const hash = (value: unknown) =>
      createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const originalHash = hash(snapshot);
    const macro = snapshot.find(
      ([name]) => name === "macroCountries"
    )![1] as unknown as MacroCountryState[];
    assert(macro.some((row) => row.entityId === "UKR"));
    assert(macro.some((row) => row.entityId === "CA"));
    const output = (row: MacroCountryState) =>
      Object.values(row.contribution.bySector).reduce(
        (sum, sector) => sum + (sector?.output ?? 0),
        0
      );
    const baseline = new Map(
      macro.map((row) => [
        row.entityId,
        output({ ...row, contribution: computeMacroContribution(row, 1057) }),
      ])
    );
    const results: Document[] = [];
    const selected = strategies.filter((s) => !arg("scenario") || arg("scenario") === s);
    assert(selected.length);
    for (const strategy of selected) {
      for (const { name } of await db.listCollections().toArray())
        await db.collection(name).deleteMany({});
      for (const [name, rows] of snapshot)
        if (rows.length) await db.collection(name).insertMany(rows);
      const active =
        strategy === "counterfactual" ? countries.filter((c) => c !== "UKR") : countries;
      const participants = resolveConflictParticipants(def, new Set(active));
      await db
        .collection("characters")
        .insertMany(leaders.filter((actor) => active.includes(actor.countryId)));
      // The background sovereign has no player office in the retained world.
      // A disclosed synthetic office row exercises its actual authority lookup.
      await db.collection("electedOfficials").insertMany(
        leaders
          .filter((actor) => active.includes(actor.countryId))
          .map((actor) => ({
            countryId: actor.countryId,
            officeType: actor.currentOffice.type,
            characterId: actor._id,
          }))
      );
      await db.collection("gameState").updateOne(
        { _id: "current" as never },
        {
          $set: {
            livingConflictsEnabled: true,
            crisisInteractionEnabled: true,
            currentYear: 2013,
            currentTurn: 1056,
          },
        }
      );
      const roles = new Map(
        await Promise.all(
          leaders.map(
            async (actor) => [actor.countryId, await resolveCharacterRoles(db, actor)] as const
          )
        )
      );
      const outcomes: Document[] = [],
        timeline: Document[] = [];
      let windows = 0,
        decisions = 0,
        retries = 0,
        totalPaid = 0,
        lastPhase = 0,
        minimumOutput = 1,
        peakDisplacement = 0,
        peakHosting = 0;
      for (let offset = 1; offset <= Number(arg("turns") ?? 720); offset++) {
        const turn = 1056 + offset,
          year = 1991 + Math.floor((turn - 1) / 48);
        await db
          .collection("gameState")
          .updateOne(
            { _id: "current" as never },
            { $set: { currentTurn: turn, currentYear: year } }
          );
        const pending = await db.collection<Crisis>("crises").find({ status: "active" }).toArray();
        for (const crisis of pending) {
          if (crisis.startTurn + (crisis.durationTurns ?? 24) > turn) continue;
          const result = await measure("resolve", () => resolveGlobalResponse(db, crisis._id));
          assert(result);
          const state = await loadConflictState(db, def.key);
          outcomes.push({ turn, outcome: result.outcomeId, tracks: state.tracks });
          assert.deepEqual(await resolveGlobalResponse(db, crisis._id), result);
          assert.deepEqual(await loadConflictState(db, def.key), state);
          retries++;
          await db
            .collection<Crisis>("crises")
            .updateOne({ _id: crisis._id }, { $set: { status: "resolved" } });
        }
        const driven = await measure("driver", () =>
          driveConflictTurn(db, def, participants, turn, year)
        );
        const state = driven.state;
        if (state.phaseLevel !== lastPhase) {
          timeline.push({ turn, year, phase: state.phaseLevel, status: state.status });
          lastPhase = state.phaseLevel;
        }
        if (offset % 24 === 0) {
          const persisted = await loadConflictState(db, def.key);
          assert.equal(
            (await driveConflictTurn(db, def, participants, turn, year)).events.length,
            0
          );
          assert.deepEqual(await loadConflictState(db, def.key), persisted);
          retries++;
        }
        for (const event of driven.events) {
          const opened = await measure("materialize", () =>
            materializeLivingConflictEvent(db, def, participants, event, turn)
          );
          if (!opened.opened) continue;
          windows++;
          const crisis = await db
            .collection<Crisis>("crises")
            .findOne({ livingConflictEventId: event.fired.id });
          assert(crisis?.globalResponse);
          const interaction = await db
            .collection<CrisisInteraction>("crisisInteractions")
            .findOne({ crisisId: crisis._id });
          assert(interaction);
          for (const actor of leaders.filter((a) => active.includes(a.countryId))) {
            const role = crisis.globalResponse.roleByCountry[actor.countryId];
            if (!role) continue;
            const options = interaction.decisionTree[0].optionsByRole?.[role] ?? [];
            let optionId = choice(strategy, actor.countryId, role, offset);
            const availability = await optionAvailabilityForGlobalResponder(
              db,
              crisis,
              actor.countryId,
              options
            );
            if (optionId === "us_aid" && !availability?.[optionId].eligible) {
              // This retained army cannot support the requested logistics.
              // Exercise refusal, then let the government fund a different policy.
              await assert.rejects(
                submitCrisisDecision(
                  db,
                  interaction._id,
                  optionId,
                  actor._id,
                  actor.countryId,
                  roles.get(actor.countryId)
                ),
                /capacity is insufficient/
              );
              optionId = "us_sanctions";
            }
            const option = options.find((o) => o.optionId === optionId);
            assert(option);
            assert(
              availability?.[optionId].eligible,
              `${actor.countryId} ${optionId}: ${JSON.stringify(availability?.[optionId])}`
            );
            const before = await db
              .collection<FederalBudget>("federalBudget")
              .findOne({ countryId: actor.countryId as FederalBudget["countryId"] });
            assert(
              before || !(option.treasuryCostPctGdp! > 0),
              "Paid actions need actual budget backing"
            );
            await measure("command", () =>
              submitCrisisDecision(
                db,
                interaction._id,
                optionId,
                actor._id,
                actor.countryId,
                roles.get(actor.countryId)
              )
            );
            if (before) {
              const after = await db
                .collection<FederalBudget>("federalBudget")
                .findOne({ _id: before._id });
              assert(after);
              const cost = Math.round(
                (before.gdpSmoothed || before.gdp) * (option.treasuryCostPctGdp ?? 0)
              );
              assert(Math.abs(before.treasuryBalance! - after.treasuryBalance! - cost) <= 1);
              totalPaid += cost;
            }
            await assert.rejects(
              submitCrisisDecision(
                db,
                interaction._id,
                optionId,
                actor._id,
                actor.countryId,
                roles.get(actor.countryId)
              ),
              /already/
            );
            retries++;
            decisions++;
          }
        }
        await measure("macro", () => processMacroCountryTurn(db, turn));
        for (const row of await db
          .collection<MacroCountryState>("macroCountries")
          .find({})
          .toArray()) {
          const ratio = output(row) / baseline.get(row.entityId)!;
          if (row.entityId === "CA" && row.lastMacroTickTurn! >= 1057)
            assert(Math.abs(ratio - 1) < 1e-12, "Unrelated control changes");
          if (row.entityId === (strategy === "counterfactual" ? "PL" : "UKR"))
            minimumOutput = Math.min(minimumOutput, ratio);
          peakDisplacement = Math.max(
            peakDisplacement,
            row.livingConflictExposure?.displacedShare ?? 0
          );
          peakHosting = Math.max(peakHosting, row.livingConflictExposure?.hostingShare ?? 0);
        }
      }
      const final = await loadConflictState(db, def.key);
      const embargoes = await db.collection("tradeEmbargoes").countDocuments();
      if (Number(arg("turns") ?? 720) >= 720) {
        assert(outcomes.length > 0, "Response windows must actually resolve");
        if (["neutrality", "limited", "invasion_recovery", "counterfactual"].includes(strategy)) {
          assert.equal(final.phaseLevel, 6, `${strategy}: recovery phase`);
          assert.equal(final.status, "settled", `${strategy}: durable settlement`);
        }
        if (strategy === "deterrence" || strategy === "frozen") {
          assert.equal(final.phaseLevel, 6);
          assert.equal(final.status, "ceasefire");
        }
        if (strategy === "proxy") assert.equal(final.phaseLevel, 3);
        if (strategy === "prolonged") assert.equal(final.phaseLevel, 5);
        if (strategy === "invasion_recovery" || strategy === "prolonged")
          assert(outcomes.some((row) => row.outcome === "broad_invasion"));
        if (["limited", "proxy", "frozen", "invasion_recovery", "prolonged"].includes(strategy)) {
          assert(
            minimumOutput < 1 && peakDisplacement > 0,
            "War must affect the real origin economy"
          );
          assert(embargoes > 0 && totalPaid > 0, "Actual sanctions and paid commitments required");
        }
      }
      const result = {
        strategy,
        windows,
        decisions,
        retries,
        totalPaid,
        outcomes,
        timeline,
        final,
        embargoes,
        minimumOutput,
        peakDisplacement,
        peakHosting,
      };
      results.push(result);
      writeFileSync(`${out}.${strategy}.json`, JSON.stringify(result, null, 2));
      console.log(
        JSON.stringify({
          strategy,
          windows,
          decisions,
          phase: final.phaseLevel,
          status: final.status,
          embargoes,
          minimumOutput,
          peakDisplacement,
          peakHosting,
        })
      );
    }
    const after = await Promise.all(
      Object.entries(filters).map(
        async ([name, query]) =>
          [name, await source.collection(name).find(query).sort({ _id: 1 }).toArray()] as const
      )
    );
    assert.equal(hash(after), originalHash, "Saved source changed");
    writeFileSync(
      out,
      JSON.stringify(
        {
          sourceCommit: revision,
          development,
          sourceRun: sourceRun.runId ?? sourceRun._id,
          retainedSourceCommit: sourceRun.source.executedCommit,
          sourceWrites: 0,
          originalHash,
          results,
          measurements,
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
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
