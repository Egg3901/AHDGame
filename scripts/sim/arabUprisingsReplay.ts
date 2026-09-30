import type { LivingConflictState } from "../../src/lib/livingConflict/types";
/** Retained-world subsystem continuation; explicit shocks, no whole-world claim. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { MongoClient, ObjectId, type Db } from "mongodb";
import type { Character } from "../../src/lib/db/types/character";
import type { Crisis, CrisisInteraction } from "../../src/lib/db/types/crisis";
import type { FederalBudget } from "../../src/lib/db/types/budget";
import type { MacroCountryState } from "../../src/lib/world/macro/types";
import { ARAB_UPRISINGS_DEF as def } from "../../src/lib/livingConflict/defs/arabUprisings";
import { driveConflictTurn, loadConflictState } from "../../src/lib/livingConflict/driver";
import { materializeLivingConflictEvent } from "../../src/lib/livingConflict/processTurn";
import { resolveConflictParticipants } from "../../src/lib/livingConflict/rules/participants";
import { ARAB_HOSTS } from "../../src/lib/livingConflict/rules/arabRegional";
import { ARAB_ORIGINS } from "../../src/lib/livingConflict/rules/arabOrigins";
import {
  resolveCharacterRoles,
  submitCrisisDecision,
  autoResolveCrisisInteraction,
} from "../../src/lib/crises/interactionEngine";
import { processMacroCountryTurn } from "../../src/lib/world/macro/macroCountryTurn";
import { computeMacroContribution } from "../../src/lib/world/macro/kernel";
import { reconcileArabTerrorismSpillover } from "../../src/lib/livingConflict/arabRegional";
import { emptyConflictState } from "../../src/lib/livingConflict/engine";
import { loadCampaignCapability } from "../../src/lib/livingConflict/globalResponse";

const arg = (name: string) =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const outputSum = (country: MacroCountryState) =>
  Object.values(country.contribution.bySector).reduce(
    (sum, sector) => sum + (sector?.output ?? 0),
    0
  );
const names = [
  "gameState",
  "gameConfig",
  "countryGameStates",
  "states",
  "macroMetrics",
  "politicalMetrics",
  "governmentApprovals",
  "federalBudget",
  "stateBudgets",
  "statePolicies",
  "centralBanks",
  "exchangeRates",
  "militaryUnits",
  "countryMilitary",
  "politicalParties",
  "electedOfficials",
  "coldWarTension",
];
const cases = [
  "capacity_refusal",
  "retained_neutral",
  "reform",
  "transition",
  "authoritarian",
  "civil_war_recovery",
] as const;
type CaseName = (typeof cases)[number];

async function runCase(db: Db, scenario: CaseName, baseTurn: number) {
  const signalsBefore = await db
    .collection<MacroCountryState>("macroCountries")
    .find({ entityId: { $in: [...ARAB_ORIGINS] } })
    .toArray();
  const sourceSyria = signalsBefore.find((row) => row.entityId === "SY");
  assert(sourceSyria?.sectors.agriculture, "Retained Syrian background production is required");
  // Only observed political stability and agriculture demand are shocked. No
  // conflict readiness, displacement, consent, outcomes, GDP or cash is patched.
  const stability =
    scenario === "reform"
      ? 0.7
      : scenario === "transition"
        ? 0.1
        : scenario === "authoritarian"
          ? 0.5
          : 0.35;
  if (!["retained_neutral", "capacity_refusal"].includes(scenario)) {
    await db.collection<MacroCountryState>("macroCountries").updateOne(
      { entityId: "SY" },
      {
        $set: {
          stability,
          "sectors.agriculture.domesticDemand": sourceSyria.sectors.agriculture.capacity * 3,
        },
      }
    );
  }
  const foreignActors = [
    { countryId: "US", type: "president" },
    { countryId: "UK", type: "primeMinister" },
    { countryId: "DE", type: "chancellor" },
    { countryId: "TR", type: "president" },
  ].map((row, i) => ({
    _id: new ObjectId((90000 + i).toString(16).padStart(24, "0")),
    countryId: row.countryId,
    name: `Qualification ${row.countryId} executive`,
    currentOffice: { type: row.type },
  }));
  await db.collection("characters").insertMany(foreignActors);
  const countries = new Set([
    ...(await db.collection("states").distinct("countryId")),
    ...(await db.collection("macroCountries").distinct("entityId")),
  ]);
  const participants = resolveConflictParticipants(def, countries);
  assert(!participants.belligerents.includes("TR"), "Turkey cannot impersonate Syria");
  const budgetsBefore = await db.collection<FederalBudget>("federalBudget").find({}).toArray();
  const treasuryBefore = Object.fromEntries(
    budgetsBefore.map((row) => [row.countryId, row.treasuryBalance])
  );
  const snapshots: unknown[] = [];
  let windows = 0,
    decisions = 0,
    duplicateRejected = 0,
    capabilityRejected = 0;
  let warSeen = false,
    frozenSeen = false,
    domesticPolicySeen = false,
    shockRemoved = false;
  const trajectories = new Set<string>();
  let maxDisplacement = 0,
    maxOriginLoss = 0,
    maxHostExposure = 0,
    maxSpillover = 0;
  if (scenario === "capacity_refusal")
    await db
      .collection("militaryUnits")
      .updateMany({ countryId: "US" }, { $set: { readiness: 0, "equipment.support": 0 } });
  const capacity = await loadCampaignCapability(db, "US");
  const spending: Record<string, number> = {};
  let terrorism: LivingConflictState = {
    ...emptyConflictState("transnational_terrorism"),
    hasOpened: true,
    tracks: { threatCapability: 42 },
  };
  let maxTerrorismSpillover = 0,
    maxOriginExposure = 0;
  const outputBefore = outputSum({
    ...sourceSyria,
    contribution: computeMacroContribution(sourceSyria, baseTurn),
  });
  for (let step = 0; step < (scenario === "capacity_refusal" ? 1 : 216); step++) {
    const turn = baseTurn + step;
    await db.collection("gameState").updateOne(
      { _id: "current" as never },
      {
        $set: {
          currentTurn: turn,
          currentYear: 2011 + step / 48,
          livingConflictsEnabled: true,
          crisisInteractionEnabled: true,
        },
      }
    );
    const driven = await driveConflictTurn(db, def, participants, turn, 2011 + step / 48);
    const retry = await driveConflictTurn(db, def, participants, turn, 2011 + step / 48);
    assert.equal(retry.events.length, 0);
    assert.equal(digest(retry.state.arabRegional), digest(driven.state.arabRegional));
    for (const event of driven.events) {
      const result = await materializeLivingConflictEvent(db, def, participants, event, turn);
      if (result.opened) windows++;
    }
    const crises = await db
      .collection<Crisis>("crises")
      .find({ "globalResponse.conflictKey": def.key, status: "active" })
      .toArray();
    for (const crisis of crises) {
      const interaction = await db
        .collection<CrisisInteraction>("crisisInteractions")
        .findOne({ crisisId: crisis._id });
      if (!interaction || interaction.globalResponseOutcome) continue;
      const state = await loadConflictState(db, def.key);
      const syria = state.arabRegional?.origins.SY;
      const war = syria?.trajectory === "civil_war";
      if (scenario === "capacity_refusal") {
        const actor = foreignActors[0];
        const roles = await resolveCharacterRoles(db, actor as unknown as Character);
        await assert.rejects(
          submitCrisisDecision(db, interaction._id, "protect", actor._id, actor.countryId, roles),
          /readiness|logistics/i
        );
        capabilityRejected++;
      }
      if (scenario === "civil_war_recovery") {
        for (const actor of foreignActors) {
          if (
            !crisis.globalResponse?.roleByCountry[actor.countryId] ||
            interaction.leaderResponses?.some((response) => response.countryId === actor.countryId)
          )
            continue;
          const option =
            actor.countryId === "US"
              ? warSeen
                ? "mediate_west"
                : (syria?.repression ?? 0) >= 55
                  ? "protect"
                  : "no_new_commitment"
              : actor.countryId === "TR"
                ? warSeen
                  ? "host_refugees"
                  : (syria?.repression ?? 0) >= 55
                    ? "arm_opposition"
                    : "no_new_commitment"
                : actor.countryId === "DE"
                  ? "share_refugees"
                  : "bloc_sanctions";
          if (option === "no_new_commitment") continue;
          const roles = await resolveCharacterRoles(db, actor as unknown as Character);
          const budgetBefore = await db
            .collection<FederalBudget>("federalBudget")
            .findOne({ countryId: actor.countryId as FederalBudget["countryId"] });
          try {
            await submitCrisisDecision(
              db,
              interaction._id,
              option,
              actor._id,
              actor.countryId,
              roles
            );
            decisions++;
            await assert.rejects(
              submitCrisisDecision(db, interaction._id, option, actor._id, actor.countryId, roles)
            );
            duplicateRejected++;
            const budgetAfter = await db
              .collection<FederalBudget>("federalBudget")
              .findOne({ countryId: actor.countryId as FederalBudget["countryId"] });
            assert(budgetBefore && budgetAfter);
            const role = crisis.globalResponse!.roleByCountry[actor.countryId];
            const authored = def.phases[0].events[0].response!.decisionTrees[role]!.options!.find(
              (candidate) => candidate.optionId === option
            )!;
            const gdp =
              budgetBefore.gdpSmoothed && budgetBefore.gdpSmoothed > 0
                ? budgetBefore.gdpSmoothed
                : budgetBefore.gdp;
            const charge = Math.round(gdp * (authored.treasuryCostPctGdp ?? 0));
            assert(
              Math.abs(budgetBefore.treasuryBalance - budgetAfter.treasuryBalance - charge) < 0.01,
              "Accepted cost and duplicate retry reconcile exactly"
            );
            spending[actor.countryId] = (spending[actor.countryId] ?? 0) + charge;
          } catch (error) {
            if (
              String(error).includes("readiness") ||
              String(error).includes("logistics") ||
              String(error).includes("intelligence")
            )
              capabilityRejected++;
            else throw error;
          }
        }
      }
      if (turn >= (crisis.endTurn ?? crisis.startTurn + 24))
        await autoResolveCrisisInteraction(db, interaction._id);
      if (war) warSeen = true;
    }
    await processMacroCountryTurn(db, turn);
    const state = await loadConflictState(db, def.key);
    const syria = state.arabRegional?.origins.SY;
    assert(syria, "Actual saved Syrian macro sovereign must be represented");
    trajectories.add(syria.trajectory);
    if (syria.npcPolicyReceipt) domesticPolicySeen = true;
    if (syria.trajectory === "civil_war") warSeen = true;
    if (syria.trajectory === "frozen") frozenSeen = true;
    maxDisplacement = Math.max(maxDisplacement, syria.displacement);
    maxSpillover = Math.max(maxSpillover, syria.extremistSpace);
    if (
      (!shockRemoved &&
        (scenario === "reform" || scenario === "transition") &&
        domesticPolicySeen) ||
      (!shockRemoved && scenario === "civil_war_recovery" && warSeen)
    ) {
      await db.collection<MacroCountryState>("macroCountries").updateOne(
        { entityId: "SY" },
        {
          $set: {
            "sectors.agriculture.domesticDemand": sourceSyria.sectors.agriculture.domesticDemand,
          },
        }
      );
      shockRemoved = true;
    }
    const macro = await db
      .collection<MacroCountryState>("macroCountries")
      .find({ entityId: { $in: ["SY", "TR", "JO", "LB", "DE"] } })
      .toArray();
    const currentSyria = macro.find((row) => row.entityId === "SY");
    assert(currentSyria);
    const noCrisis = outputSum({
      ...currentSyria,
      contribution: computeMacroContribution(currentSyria, turn),
    });
    if (currentSyria.lastMacroTickTurn === turn)
      maxOriginLoss = Math.max(maxOriginLoss, noCrisis - outputSum(currentSyria));
    maxOriginExposure = Math.max(
      maxOriginExposure,
      currentSyria.livingConflictExposure?.displacedShare ?? 0
    );
    if (turn % 12 === 0) {
      terrorism = await reconcileArabTerrorismSpillover(db, terrorism, turn);
      maxTerrorismSpillover = Math.max(
        maxTerrorismSpillover,
        terrorism.tracks?.arabRegionalSpillover ?? 0
      );
    }
    for (const country of macro)
      maxHostExposure = Math.max(
        maxHostExposure,
        country.livingConflictExposure?.hostingShare ?? 0
      );
    const refugees = Object.values(state.arabRegional!.origins).reduce(
      (sum, origin) =>
        sum + (origin ? ((origin.population * origin.displacement) / 1000) * 0.5 : 0),
      0
    );
    const hosts = Object.values(state.arabRegional!.hosts).reduce(
      (sum, host) => sum + host.refugeePeople,
      0
    );
    assert(
      Math.abs(refugees - hosts) < 0.001,
      "All cross-border exposure must be allocated exactly once"
    );
    if (step % 24 === 0 || step === 215)
      snapshots.push({
        turn,
        regionalPhase: state.phaseLevel,
        syria,
        refugees,
        hosts,
        output: outputSum(currentSyria),
        exposure: currentSyria.livingConflictExposure,
      });
  }
  const final = await loadConflictState(db, def.key);
  const finalTreasuries = Object.fromEntries(
    (await db.collection<FederalBudget>("federalBudget").find({}).toArray()).map((row) => [
      row.countryId,
      row.treasuryBalance,
    ])
  );
  if (scenario === "retained_neutral" || scenario === "capacity_refusal") {
    assert.equal(decisions, 0);
    assert.deepEqual(finalTreasuries, treasuryBefore);
    assert.equal(maxDisplacement, 0);
  }
  if (scenario === "reform") assert(trajectories.has("reform"));
  if (scenario === "transition") assert(trajectories.has("transition"));
  if (scenario === "authoritarian") assert(trajectories.has("authoritarian"));
  if (scenario === "civil_war_recovery") {
    assert(warSeen);
    assert(frozenSeen);
    assert(maxDisplacement > 0);
    assert(maxOriginLoss > 0);
    assert(maxOriginExposure > 0);
    assert(maxTerrorismSpillover > 0);
    assert(maxHostExposure > 0);
    assert(decisions > 0);
  }
  for (const [countryId, spent] of Object.entries(spending))
    assert(Math.abs(treasuryBefore[countryId] - finalTreasuries[countryId] - spent) < 0.01);
  if (scenario === "capacity_refusal") assert(capabilityRejected > 0);
  assert(windows <= 10, "Single regional windows bound decision volume");
  return {
    scenario,
    observedOrigins: signalsBefore.map((row) => row.entityId),
    originalSyria: {
      population: sourceSyria.population,
      stability: sourceSyria.stability,
      agriculture: sourceSyria.sectors.agriculture,
    },
    setup:
      scenario === "retained_neutral"
        ? null
        : scenario === "capacity_refusal"
          ? { USReadinessAndSupport: 0 }
          : { stability, foodDemandMultiplier: 3 },
    capacity,
    outputBefore,
    windows,
    decisions,
    duplicateRejected,
    capabilityRejected,
    trajectories: [...trajectories],
    maxDisplacement,
    maxOriginLoss,
    maxOriginExposure,
    maxTerrorismSpillover,
    spending,
    maxHostExposure,
    maxSpillover,
    treasuryBefore,
    finalTreasuries,
    finalRegional: final.arabRegional,
    snapshots,
  };
}

async function main() {
  const uri = process.env.SIM_MONGODB_URI,
    sourceName = arg("source"),
    target = arg("target"),
    out = arg("out");
  assert(uri && /^mongodb:\/\/(127\.0\.0\.1|localhost):27018\/?$/.test(uri));
  assert(sourceName && target && out && sourceName !== target);
  assert([sourceName, target].every((name) => /^ahd_sim_[a-zA-Z0-9_-]+$/.test(name)));
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = !!execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
  assert(!dirty || arg("development") === "true", "Acceptance requires clean source");
  Object.assign(process.env, { NODE_ENV: "test", MONGODB_URI: uri });
  const client = await MongoClient.connect(uri);
  global._mongoClientPromise = Promise.resolve(client);
  try {
    const source = client.db(sourceName);
    const run = await source.collection("simRuns").findOne({ status: "completed" });
    assert(run?.source?.executedCommit);
    const summaries = [];
    for (const scenario of cases.filter((name) => !arg("scenario") || name === arg("scenario"))) {
      const name = `${target}_${scenario}`;
      Object.assign(process.env, { MONGODB_DB: name, MONGO_DB_NAME: name });
      const db = client.db(name);
      assert.equal(
        (await db.listCollections({}, { nameOnly: true }).toArray()).length,
        0,
        "New isolated target required"
      );
      for (const collection of names) {
        const rows = await source.collection(collection).find({}).toArray();
        if (rows.length) await db.collection(collection).insertMany(rows);
      }
      const macro = await source
        .collection("macroCountries")
        .find({ entityId: { $in: [...ARAB_ORIGINS, ...ARAB_HOSTS] } })
        .toArray();
      await db.collection("macroCountries").insertMany(macro);
      console.log(`Arab qualification: ${scenario}`);
      summaries.push(await runCase(db, scenario, 60));
    }
    writeFileSync(
      out,
      JSON.stringify(
        {
          replayCommit: commit,
          dirty,
          sourceCommit: run.source.executedCommit,
          sourceRun: run._id,
          scope:
            "Isolated 216-turn subsystem continuations of saved world stock; not a new full-world historical simulation",
          actorSetup:
            "Four synthetic foreign executives authorize public API choices; no origin offices or elected consents are created",
          summaries,
        },
        null,
        2
      ) + "\n"
    );
    console.log(JSON.stringify({ ok: true, scenarios: summaries.length, out }));
  } finally {
    await client.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
