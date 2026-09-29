/**
 * Replay a saved sandbox crisis through the real conflict and macro-country phases.
 * Source collections are read only. Each scenario uses a new isolated sandbox DB.
 * Run with SIM_MONGODB_URI, --source=ahd_sim_*, and --target=ahd_sim_*.
 * This is a focused saved-world replay, not a fresh complete-world simulation.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { MongoClient, BSON } from "mongodb";
import { driveConflictTurn } from "../../src/lib/livingConflict/driver";
import { YUGOSLAVIA_DEF as def } from "../../src/lib/livingConflict/defs/yugoslavia";
import {
  applyConflictOutcome,
  normalizeConflictState,
  phaseFor,
} from "../../src/lib/livingConflict/engine";
import { resolveConflictParticipants } from "../../src/lib/livingConflict/rules/participants";
import { processMacroCountryTurn } from "../../src/lib/world/macro/macroCountryTurn";
import { computeMacroContribution } from "../../src/lib/world/macro/kernel";
import type { MacroCountryState } from "../../src/lib/world/macro/types";
import type { LivingConflictState } from "../../src/lib/livingConflict/types";

const flag = (name: string) => process.argv.find((v) => v.startsWith(`--${name}=`))?.split("=")[1];
const sourceName = flag("source");
const targetName = flag("target");
const uri = process.env.SIM_MONGODB_URI;
if (
  !uri ||
  !sourceName ||
  !targetName ||
  sourceName === targetName ||
  ![sourceName, targetName].every((name) => /^ahd_sim_[a-zA-Z0-9_-]{1,64}$/.test(name))
)
  throw new Error("Explicit distinct sandbox source and target are required");
const endpoint = new URL(uri);
if (
  endpoint.protocol !== "mongodb:" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname) ||
  endpoint.port !== "27018" ||
  endpoint.pathname !== "/"
)
  throw new Error("Only dedicated loopback sandbox MongoDB on port 27018 is allowed");

const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const sourceDirty =
  execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0;

async function main() {
  const client = await new MongoClient(uri!, { monitorCommands: true }).connect();
  let measuringMacro = false;
  let phaseCalls = 0;
  let phaseBytes = 0;
  let maxMacroRoundTrips = 0;
  let maxMacroReadBytes = 0;
  client.on("commandSucceeded", (event) => {
    if (!measuringMacro) return;
    phaseCalls++;
    for (const row of event.reply?.cursor?.firstBatch ?? event.reply?.cursor?.nextBatch ?? [])
      phaseBytes += BSON.calculateObjectSize(row);
  });
  try {
    const source = client.db(sourceName);
    const target = client.db(targetName);
    if ((await target.listCollections({}, { nameOnly: true }).toArray()).length)
      throw new Error("Target must be empty; refusing to overwrite existing evidence");
    const original = await source
      .collection<LivingConflictState>("livingConflicts")
      .findOne({ defKey: def.key });
    assert(original, "Saved world must contain Yugoslav crisis");
    const countries = await source
      .collection<MacroCountryState>("macroCountries")
      .find({ _id: { $in: ["YU", "BR", "AT"] } })
      .toArray();
    const control = await source
      .collection<MacroCountryState>("macroCountries")
      .findOne({ _id: { $nin: ["YU", "AT", "IT", "GR"] }, retiredAt: null });
    assert(control, "Saved unrelated macro economy required as control");
    if (!countries.some((country) => country._id === control._id)) countries.push(control);
    assert(
      countries.some((c) => c._id === "YU"),
      "Saved Yugoslav macro economy required"
    );
    const participants = resolveConflictParticipants(
      def,
      new Set(["US", "UK", "DE", "RU", "AT", "YU"])
    );
    const output = (country: MacroCountryState) =>
      Object.values(country.contribution.bySector).reduce(
        (sum, sector) => sum + (sector?.output ?? 0),
        0
      );
    const baseline = new Map(
      countries.map((country) => [
        country._id,
        output({ ...country, contribution: computeMacroContribution(country, 1) }),
      ])
    );
    const results = [];
    for (const scenario of [
      "saved recovery",
      "limited war",
      "broad war",
      "reconstruction relapse",
    ] as const) {
      await target
        .collection("gameState")
        .insertOne({ _id: "current" as never, livingConflictsEnabled: true });
      await target.collection<MacroCountryState>("macroCountries").insertMany(countries);
      let initial = normalizeConflictState(def, original);
      if (scenario !== "saved recovery") {
        initial = normalizeConflictState(def, {
          ...initial,
          status: "active",
          phaseLevel: scenario === "reconstruction relapse" ? 6 : 3,
          tracks: {
            ...initial.tracks,
            violence: scenario === "limited war" ? 35 : 90,
            displacement: scenario === "limited war" ? 20 : 100,
            infrastructureDamage: scenario === "limited war" ? 15 : 100,
            reconstruction: scenario === "reconstruction relapse" ? 100 : 0,
            settlementMomentum: 0,
          },
        });
      }
      await target.collection<LivingConflictState>("livingConflicts").insertOne(initial);
      const startTurn = initial.lastProcessedTurn ?? 240;
      let state = initial;
      let settledAt: number | null = null;
      let minimumOutputRatio = 1;
      let peakDisplacedShare = 0;
      let peakHostingShare = 0;
      let macroTicks = 0;
      const phases: number[] = [initial.phaseLevel];
      for (let offset = 1; offset <= 720; offset++) {
        if (offset % 24 === 0) {
          const response = phaseFor(def, state.phaseLevel)?.events[0].response;
          const peaceful = response?.outcomes.find(
            (outcome) => outcome.outcomeId === "negotiated_restructuring"
          );
          assert(peaceful);
          state = applyConflictOutcome(def, state, peaceful);
          const persisted = { ...state };
          Reflect.deleteProperty(persisted, "_id");
          await target
            .collection("livingConflicts")
            .updateOne({ defKey: def.key }, { $set: persisted });
        }
        const turn = startTurn + offset;
        state = (await driveConflictTurn(target, def, participants, turn, 1996)).state;
        if (state.status === "settled" && settledAt === null) settledAt = offset;
        if (phases.at(-1) !== state.phaseLevel) phases.push(state.phaseLevel);
        const beforeRetry = await target.collection("livingConflicts").findOne({ defKey: def.key });
        const retried = await driveConflictTurn(target, def, participants, turn, 1996);
        assert.equal(retried.events.length, 0);
        assert.deepEqual(
          await target.collection("livingConflicts").findOne({ defKey: def.key }),
          beforeRetry
        );
        phaseCalls = 0;
        phaseBytes = 0;
        measuringMacro = true;
        macroTicks += (await processMacroCountryTurn(target, turn)).countriesUpdated;
        measuringMacro = false;
        maxMacroRoundTrips = Math.max(maxMacroRoundTrips, phaseCalls);
        maxMacroReadBytes = Math.max(maxMacroReadBytes, phaseBytes);
        const current = await target
          .collection<MacroCountryState>("macroCountries")
          .find({})
          .toArray();
        for (const country of current) {
          const ratio = output(country) / baseline.get(country._id)!;
          assert(Number.isFinite(ratio) && ratio > 0 && ratio <= 1.000001);
          const exposure = country.livingConflictExposure;
          assert((exposure?.displacedShare ?? 0) <= 0.1 && (exposure?.hostingShare ?? 0) <= 0.005);
          if (country._id === "YU") {
            minimumOutputRatio = Math.min(minimumOutputRatio, ratio);
            peakDisplacedShare = Math.max(peakDisplacedShare, exposure?.displacedShare ?? 0);
          }
          if (country._id === control._id)
            assert.equal(ratio, 1, "Unrelated economy must be unchanged");
          peakHostingShare = Math.max(peakHostingShare, exposure?.hostingShare ?? 0);
        }
      }
      const final = await target
        .collection<MacroCountryState>("macroCountries")
        .findOne({ _id: "YU" });
      assert(final);
      const finalOutputRatio = output(final) / baseline.get("YU")!;
      assert(settledAt !== null && state.status === "settled");
      assert(finalOutputRatio > 0.99 && (final.livingConflictExposure?.displacedShare ?? 0) === 0);
      if (scenario !== "saved recovery")
        assert(minimumOutputRatio < 0.99 && peakDisplacedShare > 0);
      console.error(
        `Completed ${scenario}: settled at ${settledAt}, output recovery ${finalOutputRatio}`
      );
      results.push({
        scenario,
        passed: true,
        turns: 720,
        settledAt,
        phases,
        minimumOutputRatio,
        finalOutputRatio,
        peakDisplacedShare,
        peakHostingShare,
        macroTicks,
        retryChecks: 720,
      });
      await target.collection("gameState").deleteMany({});
      await target.collection("macroCountries").deleteMany({});
      await target.collection("livingConflicts").deleteMany({});
    }
    console.log(
      JSON.stringify(
        {
          scope:
            "saved sandbox state replay through real conflict and macro-country phases; peaceful choices every 24 turns; war branches explicitly perturbed",
          sourceCommit,
          sourceDirty,
          controlEntityId: control._id,
          originalTurn: original.lastProcessedTurn,
          maxMacroRoundTrips,
          maxMacroReadBytes,
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
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
