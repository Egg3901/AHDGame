/**
 * Continue a completed 1991 sandbox through Northern Ireland's actual subsystems.
 * Synthetic office holders, legislative votes and chosen player strategies are
 * explicit fixtures. Economy/political rows come from the saved world. This is
 * not a full-world simulation: unrelated economies and elections are held fixed.
 * SIM_MONGODB_URI must name the dedicated loopback sandbox, never a live database.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { BSON, MongoClient, ObjectId, type Db, type Document } from "mongodb";
import { NORTHERN_IRELAND_DEF as def } from "../../src/lib/livingConflict/defs/northernIreland";
import {
  driveConflictTurn,
  loadConflictState,
  saveConflictState,
  type DrivenEvent,
} from "../../src/lib/livingConflict/driver";
import {
  emptyConflictState,
  resolveConflictParticipants,
} from "../../src/lib/livingConflict/engine";
import { reconcileNorthernIrelandRatification } from "../../src/lib/livingConflict/northernIrelandRatification";
import { reconcileNorthernIrelandGovernance } from "../../src/lib/countries/uk/northernIreland/service";
import { createCrisisFromTemplate } from "../../src/lib/crises/createCrisisFromTemplate";
import {
  autoResolveCrisisInteraction,
  canCharacterInteract,
  resolveCharacterRoles,
  submitCrisisDecision,
} from "../../src/lib/crises/interactionEngine";
import { processReferendumLifecycle } from "../../src/lib/referendum/processReferendumLifecycle";
import { spendGroundGame } from "../../src/lib/referendum/groundGame";
import { runBillLifecycle } from "../../src/lib/turn/billLifecycle/engine";
import { UK_NATIONAL_CONFIG } from "../../src/lib/countries/uk/elections/billLifecycle";
import { IE_NATIONAL_CONFIG } from "../../src/lib/countries/ie/elections/billLifecycle";
import {
  ensureUKRegionalCouncilElections,
  ensureUKGovernorElections,
} from "../../src/lib/countries/uk/elections/perpetual";
import { calculateFederalSpending } from "../../src/lib/budget/spending";
import { processTreasuryTurn } from "../../src/lib/turn/treasuryTurn";
import { processPoliticalMetricsDynamics } from "../../src/lib/turn/politicalMetricsDynamics";
import { TURNS_PER_YEAR } from "../../src/lib/constants/turnTime";
import type { Bill, FederalBudget } from "../../src/lib/db/types";
import type { CrisisInteraction } from "../../src/lib/db/types/crisis";
import type { Referendum } from "../../src/lib/db/types/referendum";
import type { LivingConflictState } from "../../src/lib/livingConflict/types";

const arg = (name: string) =>
  process.argv.find((v) => v.startsWith(`--${name}=`))?.slice(name.length + 3);
const scenarios = [
  "historical",
  "delayed",
  "excluded_unionists",
  "public_rejection",
  "relapse",
] as const;
type Actor = {
  _id: ObjectId;
  countryId: string;
  name: string;
  currentOffice: { type: string; positionId?: string; state?: string } | null;
  roles?: string[];
};
const actors: Record<string, Actor> = Object.fromEntries(
  [
    ["uk", "UK", "primeMinister"],
    ["ie", "IE", "taoiseach"],
    ["unionist", "UK", "commons"],
    ["nationalist", "UK", "commons"],
    ["regional", "UK", "governor"],
    ["ni_secretary", "UK", "ukCabinet"],
    ["foreign_minister", "IE", "parliamentaryCabinet"],
    ["wrong_minister", "UK", "ukCabinet"],
  ].map(([key, countryId, type], i) => [
    key,
    {
      _id: new ObjectId((i + 1).toString(16).padStart(24, "0")),
      countryId,
      name: `Replay ${key}`,
      currentOffice: {
        type,
        ...(type === "governor" ? { state: "NIR" } : {}),
        ...(key === "ni_secretary" ? { positionId: "northern_ireland" } : {}),
        ...(key === "foreign_minister" ? { positionId: "minister_for_foreign_affairs" } : {}),
        ...(key === "wrong_minister" ? { positionId: "defence" } : {}),
      },
    },
  ])
);

async function main() {
  const uri = process.env.SIM_MONGODB_URI;
  const sourceName = arg("source"),
    targetName = arg("target"),
    out = arg("out");
  assert(
    uri && /^mongodb:\/\/(127\.0\.0\.1|localhost):27018\/?$/.test(uri),
    "Dedicated loopback sandbox URI required"
  );
  assert(
    sourceName && targetName && sourceName !== targetName && out,
    "Distinct source, target and report required"
  );
  for (const name of [sourceName, targetName]) assert(/^ahd_sim_[a-zA-Z0-9_-]{1,64}$/.test(name));
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = () => execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
  const sourceDirty = dirty();
  assert(
    !sourceDirty || process.argv.includes("--development"),
    "Commit source before evidence run"
  );
  const finalTurn = Number(arg("end-turn") ?? 37 * TURNS_PER_YEAR);
  const selected = scenarios.filter((s) => !arg("scenario") || arg("scenario") === s);
  assert(selected.length);
  const client = await new MongoClient(uri, { monitorCommands: true }).connect();
  const db = client.db(targetName),
    source = client.db(sourceName);
  Object.assign(process.env, { NODE_ENV: "test", MONGODB_URI: uri, MONGODB_DB: targetName });
  global._mongoClientPromise = Promise.resolve(client);
  let phase = "",
    calls = 0,
    bytes = 0;
  const measurements: Record<string, { calls: number[]; bytes: number[] }> = {};
  client.on("commandStarted", (e) => {
    if (phase && e.databaseName === targetName) calls++;
  });
  client.on("commandSucceeded", (e) => {
    if (!phase) return;
    const reply = e.reply as { cursor?: { firstBatch?: Document[]; nextBatch?: Document[] } };
    for (const doc of reply.cursor?.firstBatch ?? reply.cursor?.nextBatch ?? [])
      bytes += BSON.calculateObjectSize(doc);
  });
  const measure = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
    phase = label;
    calls = 0;
    bytes = 0;
    try {
      return await fn();
    } finally {
      (measurements[label] ??= { calls: [], bytes: [] }).calls.push(calls);
      measurements[label].bytes.push(bytes);
      phase = "";
    }
  };
  try {
    assert.equal(
      (await db.listCollections({}, { nameOnly: true }).toArray()).length,
      0,
      "Target must be empty"
    );
    const run = await source.collection("simRuns").findOne({ status: "completed" });
    assert(run?.source?.executedCommit, "Completed saved-world provenance required");
    const original = await source
      .collection<LivingConflictState>("livingConflicts")
      .findOne({ defKey: def.key });
    assert(
      original?.hasOpened && original.openedYear === 1991 && original.phaseLevel === 1,
      "Saved 1991 armed stalemate required"
    );
    const startTurn = original.lastProcessedTurn!;
    const countryFilter = { countryId: { $in: ["UK", "IE"] } };
    const filters: Record<string, Document> = {
      gameState: { _id: "current" },
      gameConfig: {},
      states: countryFilter,
      macroMetrics: countryFilter,
      politicalMetrics: { _id: { $in: ["NIR", "SCO"] } },
      stateDemographics: { _id: "NIR" },
      federalBudget: countryFilter,
      regionalBudgets: countryFilter,
      stateBudgets: countryFilter,
      statePolicies: countryFilter,
      enactedLaws: countryFilter,
      governmentApprovals: { _id: { $in: ["UK", "IE"] } },
      ukDevolution: { _id: "UK" },
      politicalParties: { countryId: "UK", abbreviation: { $in: ["UUP", "SF"] } },
      countryGameStates: { _id: { $in: ["UK", "IE"] } },
    };
    const saved = await Promise.all(
      Object.entries(filters).map(
        async ([name, filter]) =>
          [name, await source.collection(name).find(filter).sort({ _id: 1 }).toArray()] as const
      )
    );
    const retainedHash = createHash("sha256").update(JSON.stringify(saved)).digest("hex");
    const nir = saved.find(([name]) => name === "states")![1].find((row) => row._id === "NIR");
    assert(nir && typeof nir.gdp === "number" && nir.gdp > 0);
    const participants = resolveConflictParticipants(def, new Set(["UK", "IE", "US"]));
    const results: Document[] = [];
    for (const scenario of selected) {
      for (const { name } of await db.listCollections({}, { nameOnly: true }).toArray())
        await db.collection(name).deleteMany({});
      for (const [name, rows] of saved) if (rows.length) await db.collection(name).insertMany(rows);
      await db
        .collection("gameState")
        .updateOne(
          { _id: "current" as never },
          { $set: { livingConflictsEnabled: true, crisisInteractionEnabled: true } }
        );
      await saveConflictState(db, emptyConflictState(def.key));
      const opening = await driveConflictTurn(db, def, participants, 1, 1991);
      assert.equal(opening.state.phaseLevel, 1);
      assert(opening.state.hasOpened);
      await db.collection("livingConflicts").deleteMany({});
      await db.collection<LivingConflictState>("livingConflicts").insertOne(original);
      await db.collection("characters").insertMany(
        Object.values(actors)
          .filter((a) => a !== actors.regional)
          .map((a) => ({
            ...a,
            userId: `synthetic-${a._id}`,
            actions: 1000,
            currencyBalances: { campaign: 100_000_000 },
          }))
      );
      for (const [key, abbreviation] of [
        ["unionist", "UUP"],
        ["nationalist", "SF"],
      ])
        await db
          .collection("politicalParties")
          .updateOne({ abbreviation }, { $set: { chairId: actors[key]._id } });
      await db.collection("electedOfficials").insertMany([
        { countryId: "UK", officeType: "commons", characterId: actors.uk._id, seatsHeld: 400 },
        { countryId: "IE", officeType: "dail", characterId: actors.ie._id, seatsHeld: 100 },
      ]);
      for (const actor of Object.values(actors))
        actor.roles = await resolveCharacterRoles(db, actor);
      let state: LivingConflictState = original,
        settledTurn: number | null = null,
        suspendedTurn: number | null = null;
      let referendumRejectedTurn: number | null = null,
        windows = 0,
        decisions = 0,
        fallbacks = 0,
        retryChecks = 0,
        authChecks = 0;
      let nextWindowTurn = startTurn,
        lastPhase = state.phaseLevel,
        lastActive = false,
        noActions = 0;
      const decisionCounts: Record<string, number> = {},
        choices: Record<string, number> = {};
      const timeline: Document[] = [],
        snapshots: Document[] = [];
      const activeInteractions = new Map<string, { id: ObjectId; closeTurn: number }>();
      const treatedCampaigns = new Set<string>();
      const publicVoteHistory: Document[] = [];
      const institutionElections: Document[] = [];
      const yearlyLoad: Record<number, { windows: number; decisions: number }> = {};
      const snapshot = async (turn: number, reason: string) => {
        const budget = await db
          .collection<FederalBudget>("federalBudget")
          .findOne({ countryId: "UK" });
        assert(budget);
        const spending = await measure("federalSpending", () =>
          calculateFederalSpending(db, budget, budget.spending.debtInterest)
        );
        await db
          .collection<FederalBudget>("federalBudget")
          .updateOne({ _id: budget._id }, { $set: { spending } });
        await measure("politicalDynamics", () => processPoliticalMetricsDynamics(db, turn));
        const political = await db.collection("politicalMetrics").findOne({ _id: "NIR" as never });
        const control = await db.collection("politicalMetrics").findOne({ _id: "SCO" as never });
        const before = await db
          .collection<FederalBudget>("federalBudget")
          .findOne({ _id: budget._id });
        assert(before);
        await measure("treasury", () => processTreasuryTurn(turn));
        const after = await db
          .collection<FederalBudget>("federalBudget")
          .findOne({ _id: budget._id });
        assert(after);
        // Paired fiscal control: same opening budget, remove only NI's spending line.
        const security = spending.byCategory.northernIrelandSecurity ?? 0;
        assert(security >= 0 && security <= nir.gdp * 1_000_000 * 0.02 + 1);
        if ((state.tracks?.violence ?? 0) > 10)
          assert(security > nir.gdp, "Security spending uses whole local currency, not millions");
        assert.deepEqual(
          control?.livingConflictResiduals ?? {},
          {},
          "NI standing effects do not leak into Scotland"
        );
        await db
          .collection<FederalBudget>("federalBudget")
          .replaceOne(
            { _id: budget._id },
            { ...before, spending: { ...spending, total: spending.total - security } }
          );
        await processTreasuryTurn(turn);
        const controlBudget = await db
          .collection<FederalBudget>("federalBudget")
          .findOne({ _id: budget._id });
        assert(controlBudget);
        const cashDifference = controlBudget.treasuryBalance! - after.treasuryBalance!;
        assert(
          Math.abs(cashDifference - security / TURNS_PER_YEAR) <= 1,
          "Ordinary treasury books security cost within whole-unit rounding"
        );
        await db.collection<FederalBudget>("federalBudget").replaceOne({ _id: budget._id }, after);
        snapshots.push({
          turn,
          year: 1991 + Math.floor((turn - 1) / TURNS_PER_YEAR),
          reason,
          phase: state.phaseLevel,
          tracks: state.tracks,
          securityAnnual: security,
          securityCashDifference: cashDifference,
          politicalValues: political?.values,
          conflictResiduals: political?.livingConflictResiduals,
          controlConflictResiduals: control?.livingConflictResiduals,
        });
      };
      await snapshot(startTurn, "saved opening");
      for (let turn = startTurn + 1; turn <= finalTurn; turn++) {
        const year = 1991 + Math.floor((turn - 1) / TURNS_PER_YEAR);
        const load = (yearlyLoad[year] ??= { windows: 0, decisions: 0 });
        await db
          .collection("gameState")
          .updateOne(
            { _id: "current" as never },
            { $set: { currentTurn: turn, currentYear: year } }
          );
        for (const [key, active] of activeInteractions)
          if (turn >= active.closeTurn) {
            let interaction = await db
              .collection<CrisisInteraction>("crisisInteractions")
              .findOne({ _id: active.id });
            while (interaction && !interaction.resolvedAt) {
              await autoResolveCrisisInteraction(db, active.id);
              fallbacks++;
              interaction = await db
                .collection<CrisisInteraction>("crisisInteractions")
                .findOne({ _id: active.id });
            }
            await db
              .collection("crises")
              .updateOne(
                { livingConflictEventId: key },
                { $set: { status: "resolved", endTurn: turn } }
              );
            activeInteractions.delete(key);
          }
        const driven = await measure("conflictDriver", () =>
          driveConflictTurn(db, def, participants, turn, year)
        );
        state = driven.state;
        const beforeRetry = await loadConflictState(db, def.key);
        const retry = await driveConflictTurn(db, def, participants, turn, year);
        assert.equal(retry.events.length, 0);
        assert.deepEqual(await loadConflictState(db, def.key), beforeRetry);
        retryChecks++;
        for (const event of driven.events)
          if (event.fired.event.negotiation && turn >= nextWindowTurn) {
            // Same authored template and window floor as the turn phase, with other conflicts excluded.
            const crisisId = await createNegotiation(db, event, turn);
            const interaction = await db
              .collection<CrisisInteraction>("crisisInteractions")
              .findOne({ crisisId });
            assert(interaction);
            activeInteractions.set(event.fired.id, { id: interaction._id, closeTurn: turn + 24 });
            nextWindowTurn = turn + 24;
            windows++;
            load.windows++;
          }
        const regional = await db.collection("ukDevolution").findOne({ _id: "UK" as never });
        const regionalActive =
          regional?.regions?.NIR?.active === true &&
          turn >= (regional.regions.NIR.firstElectionEndTurn ?? Infinity);
        if (regionalActive && !lastActive) {
          await db.collection("characters").updateOne(
            { _id: actors.regional._id },
            {
              $set: {
                ...actors.regional,
                userId: "synthetic-regional",
                actions: 1000,
                currencyBalances: { campaign: 100_000_000 },
              },
            },
            { upsert: true }
          );
          await db.collection("electedOfficials").insertOne({
            countryId: "UK",
            state: "NIR",
            officeType: "governor",
            characterId: actors.regional._id,
            seatsHeld: 1,
          });
        }
        lastActive = regionalActive;
        for (const active of activeInteractions.values()) {
          let interaction = await db
            .collection<CrisisInteraction>("crisisInteractions")
            .findOne({ _id: active.id });
          while (interaction && !interaction.resolvedAt) {
            const node = interaction.decisionTree.find(
              (n) => n.nodeId === interaction!.currentNodeId
            );
            assert(node);
            const isRatification = node.nodeId.includes("ratification");
            if (
              isRatification &&
              (await db
                .collection("bills")
                .countDocuments({ category: "northern_ireland_peace" })) > 0
            )
              break;
            if (node.nodeId === "regional_executive_position" && !regionalActive) break;
            const key = node.nodeId.startsWith("uk_")
              ? "uk"
              : node.nodeId.startsWith("irish_")
                ? "ie"
                : node.nodeId.startsWith("unionist_")
                  ? "unionist"
                  : node.nodeId.startsWith("nationalist_")
                    ? "nationalist"
                    : "regional";
            const actor =
              key === "uk" && windows % 2 === 0
                ? actors.ni_secretary
                : key === "ie" && windows % 2 === 0
                  ? actors.foreign_minister
                  : actors[key];
            if (node.nodeId === "unionist_position") {
              const before = await loadConflictState(db, def.key);
              await assert.rejects(
                submitCrisisDecision(
                  db,
                  interaction._id,
                  "unionist_join",
                  actors.uk._id,
                  "UK",
                  actors.uk.roles
                )
              );
              assert.deepEqual(await loadConflictState(db, def.key), before);
              authChecks++;
            }
            if (node.nodeId === "uk_position") {
              assert(canCharacterInteract(node, actors.ni_secretary.roles!, "UK"));
              assert(!canCharacterInteract(node, actors.wrong_minister.roles!, "UK"));
              await assert.rejects(
                submitCrisisDecision(
                  db,
                  interaction._id,
                  "uk_backchannel",
                  actors.wrong_minister._id,
                  "UK",
                  actors.wrong_minister.roles
                )
              );
              assert(!canCharacterInteract(node, actors.ie.roles!, "IE"));
              authChecks += 3;
            }
            if (node.nodeId === "irish_position") {
              assert(canCharacterInteract(node, actors.foreign_minister.roles!, "IE"));
              authChecks++;
            }
            const hardline =
              scenario === "relapse" && settledTurn !== null && turn >= settledTurn + 96;
            let constructive = !hardline;
            if (
              key === "unionist" &&
              (scenario === "excluded_unionists" || (scenario === "delayed" && year < 2001))
            )
              constructive = false;
            if (key === "unionist" && scenario === "public_rejection")
              constructive = (state.tracks?.unionistConsent ?? 0) < 60;
            if (
              scenario === "public_rejection" &&
              referendumRejectedTurn !== null &&
              key === "unionist"
            )
              constructive = false;
            const option = node.options?.[constructive ? 1 : 0];
            assert(option);
            const result = await submitCrisisDecision(
              db,
              interaction._id,
              option.optionId,
              actor._id,
              actor.countryId,
              actor.roles,
              key === "regional" ? "NIR" : undefined
            );
            decisions++;
            load.decisions++;
            decisionCounts[key] = (decisionCounts[key] ?? 0) + 1;
            choices[option.optionId] = (choices[option.optionId] ?? 0) + 1;
            const after = await loadConflictState(db, def.key);
            await assert.rejects(
              submitCrisisDecision(
                db,
                interaction._id,
                option.optionId,
                actor._id,
                actor.countryId,
                actor.roles,
                key === "regional" ? "NIR" : undefined
              )
            );
            assert.deepEqual(await loadConflictState(db, def.key), after);
            retryChecks++;
            state = after;
            interaction = result.interaction;
          }
        }
        const bills = await db
          .collection<Bill>("bills")
          .find({ status: "active", category: "northern_ireland_peace" })
          .toArray();
        for (const bill of bills)
          if (!Object.keys(bill.votes ?? {}).length) {
            const voter = bill.countryId === "UK" ? actors.uk : actors.ie;
            // Explicit synthetic legislative vote, resolved by the real seat-scoped lifecycle.
            await db
              .collection<Bill>("bills")
              .updateOne(
                { _id: bill._id },
                { $set: { votes: { [voter._id.toHexString()]: "for" } } }
              );
          }
        if (
          bills.some((b) => (b.votingEndsOnTurn ?? Infinity) <= turn) ||
          (await db.collection("bills").countDocuments({ status: "enrolled" }))
        ) {
          await measure("bills", async () => {
            const originalRandom = Math.random;
            // Inject a fixed Lords revision roll into this isolated lifecycle only.
            Math.random = () => 0.5;
            try {
              await runBillLifecycle(
                db,
                UK_NATIONAL_CONFIG,
                new Date("2000-01-01T00:00:00Z"),
                turn
              );
              await runBillLifecycle(
                db,
                IE_NATIONAL_CONFIG,
                new Date("2000-01-01T00:00:00Z"),
                turn
              );
            } finally {
              Math.random = originalRandom;
            }
          });
        }
        state = await measure("ratification", () =>
          reconcileNorthernIrelandRatification(db, def, state, year, turn)
        );
        const lifecycle = await measure("referendumLifecycle", () =>
          processReferendumLifecycle(db, turn)
        );
        for (const transition of lifecycle?.transitions ?? [])
          publicVoteHistory.push({ turn, ...transition });
        const campaign = await db
          .collection<Referendum>("referendums")
          .findOne({ kind: "peace_agreement", status: "campaigning" });
        if (campaign && !treatedCampaigns.has(campaign._id.toHexString())) {
          const count = scenario === "public_rejection" ? 40 : 1;
          for (let i = 0; i < count; i++) {
            const action = await spendGroundGame(db, {
              referendumId: campaign._id.toHexString(),
              side: scenario === "public_rejection" ? "no" : "yes",
              presetId: "broadcast_ads",
              target: "whole",
              mode: "volunteer",
              characterId: actors.unionist._id,
              countryId: "UK",
              actorName: "Synthetic campaign fixture",
            });
            assert.equal(action.status, 200, JSON.stringify(action));
            if (scenario === "public_rejection") noActions++;
          }
          treatedCampaigns.add(campaign._id.toHexString());
        }
        state = await reconcileNorthernIrelandRatification(
          db,
          def,
          await loadConflictState(db, def.key),
          year,
          turn
        );
        const ratified = await loadConflictState(db, def.key);
        const ballotsBefore = await db.collection("referendums").countDocuments();
        state = await reconcileNorthernIrelandRatification(db, def, state, year, turn);
        assert.deepEqual(state, ratified);
        assert.equal(await db.collection("referendums").countDocuments(), ballotsBefore);
        retryChecks++;
        await measure("governance", () => reconcileNorthernIrelandGovernance(db, state, turn));
        const institutions = await db.collection("ukDevolution").findOne({ _id: "UK" as never });
        await reconcileNorthernIrelandGovernance(db, state, turn);
        assert.deepEqual(
          await db.collection("ukDevolution").findOne({ _id: "UK" as never }),
          institutions
        );
        retryChecks++;
        if (state.phaseLevel === 6 && settledTurn === null) {
          settledTurn = turn;
          assert(institutions?.regions?.NIR?.active);
          await ensureUKRegionalCouncilElections(new Date("2000-01-01T00:00:00Z"), turn);
          await ensureUKGovernorElections(new Date("2000-01-01T00:00:00Z"), turn);
          const elections = await db
            .collection("elections")
            .find({
              countryId: "UK",
              state: "NIR",
              electionType: { $in: ["governor", "regionalCouncil"] },
            })
            .toArray();
          assert(elections.some((e) => e.electionType === "governor" && e.endTurn === turn + 72));
          assert(
            elections.some((e) => e.electionType === "regionalCouncil" && e.endTurn === turn + 48)
          );
          institutionElections.push(
            ...elections.map((e) => ({
              type: e.electionType,
              endTurn: e.endTurn,
              cycle: e.cycle,
              status: e.status,
            }))
          );
        }
        if (settledTurn !== null && state.phaseLevel === 7 && suspendedTurn === null) {
          suspendedTurn = turn;
          assert.equal(institutions?.regions?.NIR?.active, false);
          const formerExecutive = await db
            .collection("characters")
            .findOne({ _id: actors.regional._id });
          assert(
            !formerExecutive?.currentOffice,
            "Suspension clears the seated synthetic executive's office"
          );
          assert.equal(
            await db
              .collection("electedOfficials")
              .countDocuments({ countryId: "UK", state: "NIR", officeType: "governor" }),
            0
          );
          assert.equal(
            await db.collection("elections").countDocuments({
              countryId: "UK",
              state: "NIR",
              status: { $in: ["active", "upcoming"] },
            }),
            0
          );
        }
        if (state.rejectedPeaceReferendumId && referendumRejectedTurn === null) {
          referendumRejectedTurn = turn;
          assert.equal(state.phaseLevel, 4);
          assert.equal(state.tracks?.ratificationAuthorization, 0);
        }
        const changed = lastPhase !== state.phaseLevel;
        if (changed) {
          timeline.push({
            turn,
            year,
            from: lastPhase,
            to: state.phaseLevel,
            tracks: state.tracks,
          });
          lastPhase = state.phaseLevel;
        }
        if (turn % TURNS_PER_YEAR === 0 || changed || turn === finalTurn)
          await snapshot(turn, changed ? "phase transition" : "annual");
      }
      const refs = await db.collection<Referendum>("referendums").find({}).toArray();
      const finalBills = await db.collection<Bill>("bills").find({}).toArray();
      if (!process.argv.includes("--development")) {
        if (["historical", "delayed", "relapse"].includes(scenario)) {
          assert(settledTurn);
          assert(refs.some((ref) => ref.result?.passed));
          assert(finalBills.filter((b) => b.status === "signed").length >= 2);
        }
        if (scenario === "delayed") assert(settledTurn! > (2001 - 1991) * TURNS_PER_YEAR);
        if (scenario === "excluded_unionists") {
          assert.equal(settledTurn, null);
          assert.equal(refs.length, 0);
          assert((state.tracks?.unionistConsent ?? 100) < 60);
        }
        if (scenario === "public_rejection") {
          assert(referendumRejectedTurn);
          assert.equal(settledTurn, null);
          assert(refs.some((ref) => ref.result?.passed === false));
        }
        if (scenario === "relapse") assert(suspendedTurn);
      }
      const result = {
        scenario,
        startTurn,
        finalTurn,
        continuationTurns: finalTurn - startTurn,
        finalYear: 1991 + Math.floor((finalTurn - 1) / TURNS_PER_YEAR),
        settledTurn,
        suspendedTurn,
        referendumRejectedTurn,
        windows,
        decisions,
        fallbacks,
        retryChecks,
        authChecks,
        decisionCounts,
        choices,
        yearlyLoad,
        noActions,
        timeline,
        snapshots,
        publicVoteHistory,
        institutionElections,
        ballots: refs.map((ref) => ({
          id: ref._id,
          kind: ref.kind,
          status: ref.status,
          campaignBaseYesShare: ref.campaignBaseYesShare,
          yesShare: ref.yesShare,
          result: ref.result,
          peaceAgreement: ref.peaceAgreement,
          westminsterBillId: ref.westminsterBillId,
          dailBillId: ref.dailBillId,
          cohortCount: ref.cohortBaseline?.length,
        })),
        bills: finalBills.map((b) => ({
          id: b._id,
          countryId: b.countryId,
          status: b.status,
          proposedTurn: b.proposedTurn,
          votesFor: b.votesFor,
          voteSnapshot: b.voteSnapshot,
        })),
        finalState: state,
      };
      results.push(result);
      console.error(
        JSON.stringify({
          scenario,
          settledTurn,
          suspendedTurn,
          referendumRejectedTurn,
          finalPhase: state.phaseLevel,
          windows,
          decisions,
        })
      );
    }
    assert.deepEqual(
      await source.collection<LivingConflictState>("livingConflicts").findOne({ defKey: def.key }),
      original,
      "Source remains unchanged"
    );
    const retainedAfter = await Promise.all(
      Object.entries(filters).map(
        async ([name, filter]) =>
          [name, await source.collection(name).find(filter).sort({ _id: 1 }).toArray()] as const
      )
    );
    assert.equal(
      createHash("sha256").update(JSON.stringify(retainedAfter)).digest("hex"),
      retainedHash,
      "Every copied source collection remains unchanged"
    );
    const summarize = (values: number[]) => ({
      samples: values.length,
      mean: values.reduce((s, n) => s + n, 0) / values.length,
      max: Math.max(...values),
      p95: [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1],
    });
    const report = {
      generatedAt: new Date().toISOString(),
      sourceCommit,
      sourceDirty: Boolean(sourceDirty),
      sourceDirtyAtEnd: Boolean(dirty()),
      retainedRun: {
        id: run._id,
        sourceCommit: run.source.executedCommit,
        savedTurn: original.lastProcessedTurn,
        preset: run.preset,
      },
      sourceDatabase: sourceName,
      targetDatabase: targetName,
      retainedCollections: Object.fromEntries(saved.map(([name, rows]) => [name, rows.length])),
      scope:
        "Isolated NI subsystem continuation; retained regional economy, policy and demographic rows; synthetic actors, votes and strategies; other economy, general elections and full world phases held fixed; annual political/fiscal samples, per-turn conflict/ratification/governance/referendum phases",
      retainedRegionalGdpMillions: nir.gdp,
      retainedCollectionsSha256: retainedHash,
      results,
      performance: Object.fromEntries(
        Object.entries(measurements).map(([name, values]) => [
          name,
          { commands: summarize(values.calls), readBsonBytes: summarize(values.bytes) },
        ])
      ),
    };
    writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    if (!process.argv.includes("--development"))
      assert(!report.sourceDirtyAtEnd, "Source changed during evidence run");
  } finally {
    await client.close();
    global._mongoClientPromise = undefined;
  }
}

async function createNegotiation(db: Db, driven: DrivenEvent, turn: number): Promise<ObjectId> {
  const event = driven.fired.event,
    negotiation = event.negotiation!;
  const countryIds = [
    ...new Set(negotiation.decisionTree.flatMap((node) => node.requiredCountryIds ?? [])),
  ];
  return createCrisisFromTemplate(db, {
    scope: "country",
    countryIds,
    regionIds: [],
    currentTurn: turn,
    autoSource: "condition",
    livingConflictEventId: driven.fired.id,
    template: {
      name: event.headline,
      description: event.body,
      scope: "country",
      countryIds,
      regionIds: [],
      durationTurns: negotiation.windowTurns,
      durationByScope: { country: negotiation.windowTurns },
      effects: [],
      wireMessageOnStart: event.headline,
      wireMessageOnEnd: "The negotiation window closed.",
      autoGenerated: true,
      interactionDefinition: { decisionTree: negotiation.decisionTree, autoResolveOnExpiry: true },
    },
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
