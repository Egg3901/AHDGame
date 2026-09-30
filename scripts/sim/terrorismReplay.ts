/**
 * Continue a retained sandbox world's terrorism subsystem through 2027.
 * National leaders and strategy policies are synthetic; economy and political
 * boards are copied unchanged from the completed world. No live database access.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { BSON, MongoClient, ObjectId, type Document } from "mongodb";
import { TRANSNATIONAL_TERRORISM_DEF as def } from "../../src/lib/livingConflict/defs/transnationalTerrorism";
import { driveConflictTurn, loadConflictState } from "../../src/lib/livingConflict/driver";
import { resolveConflictParticipants } from "../../src/lib/livingConflict/engine";
import { materializeLivingConflictEvent } from "../../src/lib/livingConflict/processTurn";
import {
  resolveCharacterRoles,
  submitCrisisDecision,
} from "../../src/lib/crises/interactionEngine";
import {
  resolveGlobalResponse,
  optionAvailabilityForGlobalResponder,
} from "../../src/lib/livingConflict/globalResponse";
import { calculateFederalSpending } from "../../src/lib/budget/spending";
import { processTreasuryTurn } from "../../src/lib/turn/treasuryTurn";
import { processPoliticalMetricsDynamics } from "../../src/lib/turn/politicalMetricsDynamics";
import type { Crisis, CrisisInteraction } from "../../src/lib/db/types/crisis";
import type { FederalBudget } from "../../src/lib/db/types";

const arg = (name: string) =>
  process.argv.find((v) => v.startsWith(`--${name}=`))?.slice(name.length + 3);
const strategies = ["prevention", "limited", "policing", "intervention", "inaction"] as const;
const countries = ["US", "UK", "DE", "RU", "IE"];
const offices = ["president", "primeMinister", "chancellor", "president", "taoiseach"];
const leaders = countries.map((countryId, i) => ({
  _id: new ObjectId((i + 100).toString(16).padStart(24, "0")),
  countryId,
  name: `Synthetic ${countryId} executive`,
  currentOffice: { type: offices[i] },
}));

async function main() {
  const uri = process.env.SIM_MONGODB_URI,
    sourceName = arg("source"),
    targetName = arg("target"),
    out = arg("out");
  assert(
    uri && /^mongodb:\/\/(127\.0\.0\.1|localhost):27018\/?$/.test(uri),
    "Dedicated sandbox required"
  );
  assert(sourceName && targetName && sourceName !== targetName && out);
  for (const n of [sourceName, targetName]) assert(/^ahd_sim_[a-zA-Z0-9_-]{1,64}$/.test(n));
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = () => execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
  const sourceDirty = !!dirty();
  assert(!sourceDirty || process.argv.includes("--development"), "Commit before evidence run");
  const selected = strategies.filter((s) => !arg("scenario") || arg("scenario") === s);
  assert(selected.length);
  const client = await new MongoClient(uri, { monitorCommands: true }).connect();
  const source = client.db(sourceName),
    db = client.db(targetName);
  Object.assign(process.env, { NODE_ENV: "test", MONGODB_URI: uri, MONGODB_DB: targetName });
  global._mongoClientPromise = Promise.resolve(client);
  let phase = "",
    commands = 0,
    bytes = 0;
  const performance: Record<string, { commands: number[]; readBsonBytes: number[] }> = {};
  client.on("commandStarted", (e) => {
    if (phase && e.databaseName === targetName) commands++;
  });
  client.on("commandSucceeded", (e) => {
    if (!phase) return;
    const reply = e.reply as { cursor?: { firstBatch?: Document[]; nextBatch?: Document[] } };
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
      const p = (performance[name] ??= { commands: [], readBsonBytes: [] });
      p.commands.push(commands);
      p.readBsonBytes.push(bytes);
      phase = "";
    }
  }
  try {
    assert.equal(
      await db
        .listCollections()
        .toArray()
        .then((a) => a.length),
      0,
      "Target must be empty"
    );
    const run = await source.collection("simRuns").findOne({ status: "completed" });
    assert(run?.source?.executedCommit);
    const filter = { countryId: { $in: countries } };
    const regions = await source.collection("states").find(filter).sort({ _id: 1 }).toArray();
    const regionIds = countries.map((c) => regions.find((r) => r.countryId === c)?._id);
    assert(regionIds.every(Boolean));
    const filters: Record<string, Document> = {
      gameState: { _id: "current" },
      states: filter,
      federalBudget: filter,
      macroMetrics: filter,
      politicalMetrics: { _id: { $in: regionIds } },
      statePolicies: filter,
      enactedLaws: filter,
      regionalBudgets: filter,
      stateBudgets: filter,
      governmentApprovals: { _id: { $in: countries } },
      countryGameStates: { _id: { $in: countries } },
      militaryUnits: filter,
    };
    const saved = await Promise.all(
      Object.entries(filters).map(
        async ([name, q]) =>
          [name, await source.collection(name).find(q).sort({ _id: 1 }).toArray()] as const
      )
    );
    const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
    const retainedHash = hash(saved);
    const initialGame = saved.find(([name]) => name === "gameState")![1][0];
    assert(initialGame.startingYear === 1991);
    const startTurn = initialGame.currentTurn as number,
      finalTurn = Number(arg("end-turn") ?? 1776);
    const participants = resolveConflictParticipants(def, new Set(countries));
    const results: Document[] = [];
    for (const strategy of selected) {
      for (const { name } of await db.listCollections().toArray())
        await db.collection(name).deleteMany({});
      for (const [name, rows] of saved) if (rows.length) await db.collection(name).insertMany(rows);
      // No copied gameConfig, outbound endpoints, users or real player identities.
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
      let windows = 0,
        decisions = 0,
        retries = 0,
        authorityChecks = 0,
        resolvedWindows = 0;
      const outcomes: Document[] = [],
        timeline: Document[] = [],
        snapshots: Document[] = [],
        yearlyLoad: Record<string, { windows: number; decisions: number }> = {};
      let lastPhase = 0,
        state = await loadConflictState(db, def.key),
        peakThreat = 0,
        peakInsurgency = 0;
      async function snapshot(turn: number, baseline = false) {
        const before = await db
          .collection<FederalBudget>("federalBudget")
          .findOne({ countryId: "US" });
        assert(before);
        const spending = await measure(baseline ? "baselineSpending" : "federalSpending", () =>
          calculateFederalSpending(db, before, before.spending.debtInterest)
        );
        const annual = spending.byCategory.counterterrorism ?? 0;
        assert(annual >= 0 && annual <= (before.gdpSmoothed ?? before.gdp) * 0.012 + 1);
        await db
          .collection<FederalBudget>("federalBudget")
          .updateOne({ _id: before._id }, { $set: { spending } });
        await measure(baseline ? "baselinePolitics" : "politicalDynamics", () =>
          processPoliticalMetricsDynamics(db, turn)
        );
        const boards = await db.collection("politicalMetrics").find({}).toArray();
        const treatmentOpening = await db
          .collection<FederalBudget>("federalBudget")
          .findOne({ _id: before._id });
        assert(treatmentOpening);
        await measure("treasury", () => processTreasuryTurn(turn));
        const treatment = await db
          .collection<FederalBudget>("federalBudget")
          .findOne({ _id: before._id });
        assert(treatment);
        await db
          .collection<FederalBudget>("federalBudget")
          .replaceOne(
            { _id: before._id },
            { ...treatmentOpening, spending: { ...spending, total: spending.total - annual } }
          );
        await processTreasuryTurn(turn);
        const control = await db
          .collection<FederalBudget>("federalBudget")
          .findOne({ _id: before._id });
        assert(control);
        const cashDifference = control.treasuryBalance! - treatment.treasuryBalance!;
        assert(Math.abs(cashDifference - annual / 48) <= 1, "Ordinary treasury cost reaches cash");
        await db
          .collection<FederalBudget>("federalBudget")
          .replaceOne({ _id: before._id }, treatment);
        snapshots.push({
          turn,
          phase: state.phaseLevel,
          tracks: state.tracks,
          annualUSCost: annual,
          cashDifference,
          countryMemory: state.campaign?.countryMemory,
          boards: boards.map((b) => ({
            countryId: b.countryId,
            regionId: b._id,
            effects: b.livingConflictResiduals,
            values: {
              "order.dueProcess": b.values?.["order.dueProcess"],
              "order.safety": b.values?.["order.safety"],
            },
          })),
        });
      }
      await snapshot(startTurn, true);
      for (let turn = startTurn + 1; turn <= finalTurn; turn++) {
        const year = 1991 + Math.floor((turn - 1) / 48);
        await db
          .collection("gameState")
          .updateOne(
            { _id: "current" as never },
            { $set: { currentTurn: turn, currentYear: year } }
          );
        const active = await db.collection<Crisis>("crises").find({ status: "active" }).toArray();
        for (const crisis of active)
          if (turn >= crisis.startTurn + (crisis.durationTurns ?? 24)) {
            const approvalBefore = await db.collection("governmentApprovals").find({}).toArray();
            const result = await measure("responseResolution", () =>
              resolveGlobalResponse(db, crisis._id)
            );
            assert(result);
            if (["limited_attack", "attack_breakthrough"].includes(result.outcomeId)) {
              const target = /Affected country: ([A-Z]+)\./.exec(result.description)?.[1];
              assert(target);
              const opening = approvalBefore.find((a) => String(a._id) === target);
              const after = await db
                .collection("governmentApprovals")
                .findOne({ _id: target as never });
              assert(opening && after);
              assert(
                Math.abs(
                  opening.approvalRating -
                    after.approvalRating -
                    (result.outcomeId === "limited_attack" ? 0.5 : 2.5)
                ) < 0.0001,
                "Attack affects actual government approval"
              );
            }
            state = await loadConflictState(db, def.key);
            const before = JSON.stringify(state);
            assert.deepEqual(await resolveGlobalResponse(db, crisis._id), result);
            assert.equal(JSON.stringify(await loadConflictState(db, def.key)), before);
            retries++;
            outcomes.push({
              turn,
              ...result,
              resolvedAt: undefined,
              tracks: state.tracks,
              consequences: state.campaign?.consequences,
            });
            resolvedWindows++;
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
        if (turn % 24 === 0 || driven.events.length) {
          const prior = JSON.stringify(await loadConflictState(db, def.key));
          assert.equal(
            (await driveConflictTurn(db, def, participants, turn, year)).events.length,
            0
          );
          assert.equal(JSON.stringify(await loadConflictState(db, def.key)), prior);
          retries++;
        }
        for (const event of driven.events) {
          const opened = await measure("materializeEvent", () =>
            materializeLivingConflictEvent(db, def, participants, event, turn)
          );
          if (!opened.opened) continue;
          windows++;
          (yearlyLoad[year] ??= { windows: 0, decisions: 0 }).windows++;
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
          for (const actor of leaders) {
            const node = interaction.decisionTree[0],
              role = crisis.globalResponse!.roleByCountry[actor.countryId];
            const options = node.optionsByRole?.[role] ?? [];
            let id = "defer_response";
            const attackSeen = outcomes.some((o) =>
              ["limited_attack", "attack_breakthrough"].includes(o.outcomeId)
            );
            const prevent =
              (strategy === "prevention" && !(year >= 2012 && year < 2017)) ||
              (strategy === "limited" && resolvedWindows < 3);
            const police = (strategy === "limited" || strategy === "policing") && attackSeen;
            if (prevent)
              id =
                actor.countryId === "US"
                  ? "integrated_intelligence"
                  : actor.countryId === "UK"
                    ? "share_intelligence"
                    : actor.countryId === "DE"
                      ? "bloc_policing"
                      : "defer_response";
            if (police)
              id =
                actor.countryId === "US"
                  ? "integrated_intelligence"
                  : actor.countryId === "UK"
                    ? "lawful_support"
                    : actor.countryId === "DE"
                      ? "bloc_policing"
                      : "defer_response";
            if (strategy === "intervention") {
              if (actor.countryId === "US" && resolvedWindows < 2) id = "emergency_powers";
              else if (year < 2010 && (state.tracks?.attributionConfidence ?? 0) >= 45)
                id =
                  actor.countryId === "US"
                    ? "military_response"
                    : actor.countryId === "UK"
                      ? "join_coalition"
                      : "defer_response";
              else if (year >= 2010)
                id =
                  (state.campaign?.countryMemory[actor.countryId]?.militaryCommitment ?? 0) > 0
                    ? "draw_down"
                    : "restore_law";
            }
            const option = options.find((o) => o.optionId === id);
            assert(option, `${actor.countryId}: ${id}`);
            if (actor.countryId === "US" && windows === 1) {
              const military = options.find((o) => o.optionId === "military_response")!;
              const availability = await optionAvailabilityForGlobalResponder(
                db,
                crisis,
                "US",
                options
              );
              assert.equal(availability?.[military.optionId].eligible, false);
              await assert.rejects(
                submitCrisisDecision(
                  db,
                  interaction._id,
                  military.optionId,
                  actor._id,
                  "US",
                  roles.get("US")
                ),
                /attribution/
              );
              authorityChecks++;
              await assert.rejects(
                submitCrisisDecision(db, interaction._id, id, actor._id, "US", ["any"]),
                /authorized/
              );
              authorityChecks++;
            }
            const budgetBefore = await db
              .collection<FederalBudget>("federalBudget")
              .findOne({ countryId: actor.countryId as FederalBudget["countryId"] });
            assert(budgetBefore);
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
            const budgetAfter = await db
              .collection<FederalBudget>("federalBudget")
              .findOne({ _id: budgetBefore._id });
            assert(budgetAfter);
            const gdp =
              budgetBefore.gdpSmoothed && budgetBefore.gdpSmoothed > 0
                ? budgetBefore.gdpSmoothed
                : budgetBefore.gdp;
            const cost = Math.round(gdp * (option.treasuryCostPctGdp ?? 0));
            assert(
              Math.abs(budgetBefore.treasuryBalance! - budgetAfter.treasuryBalance! - cost) <= 1,
              "Choice debits real treasury"
            );
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
            retries++;
            assert.equal(
              (await db
                .collection<FederalBudget>("federalBudget")
                .findOne({ _id: budgetBefore._id }))!.treasuryBalance,
              budgetAfter.treasuryBalance
            );
            decisions++;
            yearlyLoad[year].decisions++;
          }
        }
        state = await loadConflictState(db, def.key);
        peakThreat = Math.max(peakThreat, state.tracks?.threatCapability ?? 0);
        peakInsurgency = Math.max(peakInsurgency, state.tracks?.insurgency ?? 0);
        if (state.phaseLevel !== lastPhase) {
          timeline.push({
            turn,
            year,
            from: lastPhase,
            to: state.phaseLevel,
            tracks: state.tracks,
          });
          lastPhase = state.phaseLevel;
          await snapshot(turn);
        } else if (turn % 48 === 0) await snapshot(turn);
        if (turn === 817 && strategy !== "inaction") {
          if (strategy === "prevention")
            assert(
              timeline.some((t) => t.to === 7),
              "Preparedness normalizes before the later lapse"
            );
          assert(
            outcomes.some((o) =>
              strategy === "prevention"
                ? o.outcomeId === "plot_disrupted"
                : strategy === "limited"
                  ? o.outcomeId === "limited_attack"
                  : strategy === "intervention"
                    ? o.outcomeId === "military_intervention"
                    : o.outcomeId === "attack_breakthrough"
            ),
            `Early acceptance checkpoint failed: ${strategy}`
          );
        }
      }
      if (finalTurn >= 1776) {
        if (strategy !== "inaction") {
          assert.equal(state.phaseLevel, 7, `${strategy}: final normalization`);
          assert.equal(state.status, "settled", `${strategy}: durable normalization`);
        } else assert((state.tracks?.threatCapability ?? 0) > 40, "Unanswered threat persists");
        if (strategy === "limited") assert(outcomes.some((o) => o.outcomeId === "limited_attack"));
        if (strategy === "policing")
          assert(
            outcomes.some((o) => o.outcomeId === "attack_breakthrough") &&
              outcomes.some((o) => o.outcomeId === "policing_campaign")
          );
        if (strategy === "intervention") {
          assert(peakInsurgency >= 55);
          assert(timeline.some((t) => t.to === 5));
          assert(snapshots.some((s) => s.annualUSCost > 0));
          assert.equal(state.campaign?.countryMemory.DE?.militaryCommitment ?? 0, 0);
          assert.equal(state.tracks?.["emergencyPowers:US"], 0);
          assert.equal(state.campaign?.countryMemory.US?.militaryCommitment, 0);
          assert.equal(state.tracks?.interventionCommitment, 0);
          assert.equal(snapshots.at(-1)!.annualUSCost, 0);
        }
      }
      const reread = await Promise.all(
        Object.entries(filters).map(
          async ([name, q]) =>
            [name, await source.collection(name).find(q).sort({ _id: 1 }).toArray()] as const
        )
      );
      assert.equal(hash(reread), retainedHash);
      const result = {
        strategy,
        startTurn,
        finalTurn,
        windows,
        decisions,
        retries,
        authorityChecks,
        peakThreat,
        peakInsurgency,
        finalState: state,
        timeline,
        outcomes,
        snapshots,
        yearlyLoad,
        sourcePreserved: true,
      };
      results.push(result);
      writeFileSync(
        `${out}.${strategy}.checkpoint.json`,
        JSON.stringify(
          { sourceCommit, sourceDirty, sourceDirtyAtCheckpoint: !!dirty(), retainedHash, result },
          null,
          2
        )
      );
      console.log(
        JSON.stringify({
          strategy,
          finalPhase: state.phaseLevel,
          windows,
          decisions,
          peakThreat,
          peakInsurgency,
        })
      );
    }
    const stats = (v: number[]) => ({
      samples: v.length,
      mean: v.reduce((a, b) => a + b, 0) / v.length,
      p95: [...v].sort((a, b) => a - b)[Math.floor(v.length * 0.95)],
      max: Math.max(...v),
    });
    const sourceDirtyAtEnd = !!dirty();
    assert(!sourceDirtyAtEnd || process.argv.includes("--development"));
    writeFileSync(
      out,
      JSON.stringify(
        {
          generatedAt: new Date(),
          sourceCommit,
          sourceDirty,
          sourceDirtyAtEnd,
          retainedRun: {
            id: run.id ?? String(run._id),
            sourceCommit: run.source.executedCommit,
            savedTurn: startTurn,
          },
          retainedCollections: saved.map(([name, rows]) => ({ name, count: rows.length })),
          retainedHash,
          scope:
            "Five-country saved economy; synthetic executives and chosen strategies; actual driver, event shell, response command, budget, political and treasury functions. Other world phases held fixed. Annual and transition fiscal/political samples.",
          performance: Object.fromEntries(
            Object.entries(performance).map(([k, v]) => [
              k,
              { commands: stats(v.commands), readBsonBytes: stats(v.readBsonBytes) },
            ])
          ),
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
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
