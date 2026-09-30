/** Bounded fresh-world seeder/driver proof against the dedicated sandbox Mongo. */
import assert from "node:assert/strict";
import { MongoClient, ObjectId } from "mongodb";
import {
  seedColdWarFoundations,
  nuclearProgramBaselines,
} from "../../src/lib/admin/seed/seedColdWarFoundations";
import { allLivingConflictDefs } from "../../src/lib/livingConflict/registry";
import {
  AUTHORED_2027_FAMILIES,
  build2027ConflictOpening,
} from "../../src/lib/livingConflict/initialState2027";
import { driveConflictTurn } from "../../src/lib/livingConflict/driver";
import { materializeLivingConflictEvent } from "../../src/lib/livingConflict/processTurn";
import { resolveGlobalResponse } from "../../src/lib/livingConflict/globalResponse";
import {
  autoResolveCrisisInteraction,
  resolveCharacterRoles,
  submitCrisisDecision,
} from "../../src/lib/crises/interactionEngine";
import { resolveConflictParticipants } from "../../src/lib/livingConflict/rules/participants";
import { reconcileNorthernIrelandRatification } from "../../src/lib/livingConflict/northernIrelandRatification";
import type { LivingConflictState } from "../../src/lib/livingConflict/types";
import type { Crisis, CrisisInteraction } from "../../src/lib/db/types/crisis";
import type { NuclearProgram } from "../../src/lib/db/types/nuclearProgram";

async function main(): Promise<void> {
  const uri = process.env.SIM_MONGODB_URI;
  assert(
    uri && /^mongodb:\/\/(127\.0\.0\.1|localhost):27018\/?$/.test(uri),
    "Dedicated loopback sandbox Mongo on port 27018 required"
  );
  const dbName = `ahd_sim_issue2159_crisis2027_${Date.now()}`;
  Object.assign(process.env, {
    NODE_ENV: "test",
    MONGODB_URI: uri,
    MONGODB_DB: dbName,
  });
  const client = new MongoClient(uri);
  await client.connect();
  // Application helpers must use this same sandbox client and release it here.
  global._mongoClientPromise = Promise.resolve(client);
  try {
    const db = client.db(dbName);
    const countryIds = ["US", "UK", "IE", "FR", "DE", "RU", "CN", "UKR", "PL", "RO", "TR"];
    const backgroundIds = ["TN", "EG", "LY", "SY", "YE", "JO", "LB", "IQ"];
    await Promise.all([
      db.collection<{ _id: string; countryId: string; population: number }>("states").insertMany(
        countryIds.map((countryId) => ({
          _id: `${countryId}_region`,
          countryId,
          population: 1_000_000,
        }))
      ),
      db.collection("macroCountries").insertMany(
        backgroundIds.map((entityId) => ({
          entityId,
          population: 1_000_000,
          stability: 0.5,
          retiredAt: null,
        }))
      ),
      db
        .collection<NuclearProgram>("nuclearPrograms")
        .insertMany(
          nuclearProgramBaselines(2027).map((program) => ({ ...program, updatedAt: new Date() }))
        ),
      db
        .collection<{ _id: string; value: number }>("coldWarTension")
        .insertOne({ _id: "current", value: 1 }),
      db
        .collection<{
          _id: string;
          currentTurn: number;
          currentYear: number;
          startingYear: number;
        }>("gameState")
        .insertOne({ _id: "current", currentTurn: 1248, currentYear: 2027, startingYear: 2027 }),
    ]);
    const first = await seedColdWarFoundations(db, 2027, 1248, { presetId: "2027-default" });
    const collection = db.collection<LivingConflictState>("livingConflicts");
    const before = await collection.find({ defKey: { $in: AUTHORED_2027_FAMILIES } }).toArray();
    assert.equal(before.length, 7);
    const retry = await seedColdWarFoundations(db, 2027, 1248, { presetId: "2027-default" });
    assert.equal(retry.conflictsInserted, 0);
    assert.deepEqual(
      await collection.find({ defKey: { $in: AUTHORED_2027_FAMILIES } }).toArray(),
      before
    );

    const available = new Set([...countryIds, ...backgroundIds]);
    const rows: Array<Record<string, unknown>> = [];
    for (const def of allLivingConflictDefs().filter((item) =>
      AUTHORED_2027_FAMILIES.includes(item.key)
    )) {
      const participants = resolveConflictParticipants(def, available);
      const opening = before.find((item) => item.defKey === def.key)!;
      const firstTurn = await driveConflictTurn(db, def, participants, 1249, 2027);
      const reconciled =
        def.key === "northern_ireland"
          ? await reconcileNorthernIrelandRatification(db, def, firstTurn.state, 2027, 1249)
          : firstTurn.state;
      const replay = await driveConflictTurn(db, def, participants, 1249, 2027);
      assert.deepEqual(replay.events, []);
      assert.equal(reconciled.openingDisposition, opening.openingDisposition);
      assert(firstTurn.events.every((event) => event.fired.phaseKey !== def.phases[0].key));
      if (opening.status !== "closed") {
        assert.equal(reconciled.lastProcessedTurn, 1249);
        assert(reconciled.phaseLevel > 1);
      }
      rows.push({
        key: def.key,
        openingDisposition: opening.openingDisposition,
        openingStatus: opening.status,
        openingPhase: opening.phaseLevel,
        nextStatus: reconciled.status,
        nextPhase: reconciled.phaseLevel,
        lastProcessedTurn: reconciled.lastProcessedTurn ?? null,
        expiredOpeningEvents: firstTurn.events.filter(
          (event) => event.fired.phaseKey === def.phases[0].key
        ).length,
        firstTurnEvents: firstTurn.events.map((event) => event.fired.id),
        participantBelligerents: participants.belligerents,
        provenance: opening.openingProvenance,
      });
    }
    const continuation: Record<string, { opened: number; resolved: number; eventKeys: string[] }> =
      Object.fromEntries(
        AUTHORED_2027_FAMILIES.map((key) => [key, { opened: 0, resolved: 0, eventKeys: [] }])
      );
    const defs = allLivingConflictDefs().filter((item) =>
      AUTHORED_2027_FAMILIES.includes(item.key)
    );
    for (let turn = 1250; turn <= 1300; turn++) {
      const year = 2027 + Math.floor((turn - 1248) / 48);
      await db
        .collection("gameState")
        .updateOne(
          { _id: "current" as never },
          { $set: { currentTurn: turn, currentYear: year, crisisInteractionEnabled: true } }
        );
      const expiring = await db
        .collection<Crisis>("crises")
        .find({ status: "active", livingConflictEventId: { $exists: true } })
        .toArray();
      for (const crisis of expiring) {
        if (turn < crisis.startTurn + (crisis.durationTurns ?? 24)) continue;
        const key =
          crisis.globalResponse?.conflictKey ?? crisis.livingConflictEventId?.split(":")[0];
        assert(key && continuation[key]);
        const interaction = await db
          .collection<CrisisInteraction>("crisisInteractions")
          .findOne({ crisisId: crisis._id });
        assert(interaction, `Missing interaction for ${key}`);
        if (crisis.globalResponse) {
          const resolved = await resolveGlobalResponse(db, crisis._id);
          assert(resolved, `Missing response resolution for ${key}`);
          assert.deepEqual(await resolveGlobalResponse(db, crisis._id), resolved);
        } else {
          for (let node = 0; node < interaction.decisionTree.length + 1; node++) {
            const latest = await db
              .collection<CrisisInteraction>("crisisInteractions")
              .findOne({ _id: interaction._id });
            if (latest?.resolvedAt) break;
            await autoResolveCrisisInteraction(db, interaction._id);
          }
          assert(
            (
              await db.collection<CrisisInteraction>("crisisInteractions").findOne({
                _id: interaction._id,
              })
            )?.resolvedAt,
            `Unresolved default interaction for ${key}`
          );
        }
        await db
          .collection<Crisis>("crises")
          .updateOne(
            { _id: crisis._id },
            { $set: { status: "resolved", endTurn: turn, resolvedAt: new Date() } }
          );
        continuation[key].resolved++;
      }
      for (const def of defs) {
        const participants = resolveConflictParticipants(def, available);
        const result = await driveConflictTurn(db, def, participants, turn, year);
        assert.deepEqual((await driveConflictTurn(db, def, participants, turn, year)).events, []);
        for (const event of result.events) {
          const materialized = await materializeLivingConflictEvent(
            db,
            def,
            participants,
            event,
            turn
          );
          if (!materialized.opened) continue;
          assert.equal(
            (await materializeLivingConflictEvent(db, def, participants, event, turn)).opened,
            false
          );
          continuation[def.key].opened++;
          continuation[def.key].eventKeys.push(event.fired.phaseKey);
        }
      }
    }
    for (const key of [
      "northern_ireland",
      "transnational_terrorism",
      "pandemic",
      "arab_uprisings",
      "russia_ukraine_security",
    ]) {
      assert(continuation[key].opened > 0, `No inherited-phase window for ${key}`);
      assert(continuation[key].resolved > 0, `No inherited-phase resolution for ${key}`);
    }
    assert.equal(continuation.yugoslav_dissolution.opened, 0);
    assert.equal(continuation.global_financial_crisis.opened, 0);
    // The ordinary world lacks YU. Run the surviving federation in a separate
    // sandbox database at its actual 2027 start turn, without rewriting history.
    const counterfactualDb = client.db(`${dbName}_counterfactual`);
    process.env.MONGODB_DB = counterfactualDb.databaseName;
    await counterfactualDb.collection("gameState").insertOne({
      _id: "current" as never,
      currentTurn: 1249,
      currentYear: 2027,
      startingYear: 2027,
      crisisInteractionEnabled: true,
    });
    const usLeader = {
      _id: new ObjectId("000000000000000000002027"),
      countryId: "US",
      name: "Synthetic US executive",
      currentOffice: { type: "president" },
    };
    const plLeader = {
      _id: new ObjectId("000000000000000000002028"),
      countryId: "PL",
      name: "Synthetic PL executive",
      currentOffice: { type: "president" },
    };
    await counterfactualDb.collection("characters").insertMany([usLeader, plLeader]);
    await counterfactualDb.collection("electedOfficials").insertMany(
      [usLeader, plLeader].map((actor) => ({
        countryId: actor.countryId,
        officeType: actor.currentOffice.type,
        characterId: actor._id,
      }))
    );
    const survivingCountries = new Set([...available, "YU"]);
    const yugoslavDef = defs.find((def) => def.key === "yugoslav_dissolution")!;
    const yugoslavOpening = build2027ConflictOpening(yugoslavDef, {
      countries: survivingCountries,
      populations: { YU: 1_000_000 },
    });
    assert.equal(yugoslavOpening.openingDisposition, "counterfactual");
    await counterfactualDb
      .collection<LivingConflictState>("livingConflicts")
      .insertOne(yugoslavOpening);
    const yugoslavParticipants = resolveConflictParticipants(yugoslavDef, survivingCountries);
    const yugoslavTurn = await driveConflictTurn(
      counterfactualDb,
      yugoslavDef,
      yugoslavParticipants,
      1249,
      2027
    );
    assert.equal(yugoslavTurn.state.openedYear, 2027);
    assert.equal(yugoslavTurn.state.openingDisposition, "counterfactual");
    assert(yugoslavTurn.events.some((event) => event.fired.phaseKey === "federal_crisis"));
    const yugoslavEvent = yugoslavTurn.events.find(
      (event) => event.fired.phaseKey === "federal_crisis"
    )!;
    assert(
      (
        await materializeLivingConflictEvent(
          counterfactualDb,
          yugoslavDef,
          yugoslavParticipants,
          yugoslavEvent,
          1249
        )
      ).opened
    );
    const yugoslavCrisis = await counterfactualDb.collection<Crisis>("crises").findOne({
      livingConflictEventId: yugoslavEvent.fired.id,
    });
    assert(yugoslavCrisis);
    const yugoslavInteraction = await counterfactualDb
      .collection<CrisisInteraction>("crisisInteractions")
      .findOne({ crisisId: yugoslavCrisis._id });
    assert(yugoslavInteraction);
    const usRoles = await resolveCharacterRoles(counterfactualDb, usLeader);
    assert(usRoles.includes("headOfState"));
    await assert.rejects(
      submitCrisisDecision(
        counterfactualDb,
        yugoslavInteraction._id,
        "west_mediate",
        usLeader._id,
        "US",
        ["any"]
      ),
      /authorized/i
    );
    await submitCrisisDecision(
      counterfactualDb,
      yugoslavInteraction._id,
      "west_mediate",
      usLeader._id,
      "US",
      usRoles
    );
    await assert.rejects(
      submitCrisisDecision(
        counterfactualDb,
        yugoslavInteraction._id,
        "west_mediate",
        usLeader._id,
        "US",
        usRoles
      ),
      /already responded/i
    );

    // A present Russian primary actor retains its own role when Ukraine is
    // unavailable; the explicit fallback chooses Poland instead.
    const missingUkraineCountries = new Set([...available].filter((id) => id !== "UKR"));
    const securityDef = defs.find((def) => def.key === "russia_ukraine_security")!;
    const fallback = resolveConflictParticipants(securityDef, missingUkraineCountries);
    assert(fallback.belligerents.includes("PL"));
    assert(!fallback.belligerents.includes("RU"));
    await counterfactualDb.collection<LivingConflictState>("livingConflicts").insertOne(
      build2027ConflictOpening(securityDef, {
        countries: missingUkraineCountries,
        populations: {},
      })
    );
    const securityTurn = await driveConflictTurn(
      counterfactualDb,
      securityDef,
      fallback,
      1249,
      2027
    );
    assert.equal(securityTurn.state.representedActors?.[0]?.representsCountryId, "UKR");
    assert.equal(securityTurn.state.representedActors?.[0]?.countryId, "PL");
    let securityEvent = securityTurn.events[0];
    for (let turn = 1250; turn <= 1272 && !securityEvent; turn++) {
      await counterfactualDb
        .collection("gameState")
        .updateOne({ _id: "current" as never }, { $set: { currentTurn: turn, currentYear: 2027 } });
      securityEvent = (await driveConflictTurn(counterfactualDb, securityDef, fallback, turn, 2027))
        .events[0];
    }
    assert(securityEvent, "Missing inherited-phase security window with fallback actor");
    assert(
      (
        await materializeLivingConflictEvent(
          counterfactualDb,
          securityDef,
          fallback,
          securityEvent,
          securityEvent.fired.turn
        )
      ).opened
    );
    const securityCrisis = await counterfactualDb.collection<Crisis>("crises").findOne({
      livingConflictEventId: securityEvent.fired.id,
    });
    assert(securityCrisis);
    assert.equal(securityCrisis.globalResponse?.roleByCountry.PL, "belligerent");
    assert.equal(securityCrisis.globalResponse?.roleByCountry.RU, "backer_a");
    const securityInteraction = await counterfactualDb
      .collection<CrisisInteraction>("crisisInteractions")
      .findOne({ crisisId: securityCrisis._id });
    assert(securityInteraction);
    const plRoles = await resolveCharacterRoles(counterfactualDb, plLeader);
    assert(plRoles.includes("headOfState"));
    await submitCrisisDecision(
      counterfactualDb,
      securityInteraction._id,
      "uk_neutral",
      plLeader._id,
      "PL",
      plRoles
    );
    await assert.rejects(
      submitCrisisDecision(
        counterfactualDb,
        securityInteraction._id,
        "uk_neutral",
        plLeader._id,
        "PL",
        plRoles
      ),
      /already responded/i
    );
    const yugoslavExpiry = yugoslavCrisis.startTurn + (yugoslavCrisis.durationTurns ?? 24);
    await counterfactualDb
      .collection("gameState")
      .updateOne(
        { _id: "current" as never },
        { $set: { currentTurn: yugoslavExpiry, currentYear: 2027 } }
      );
    const yugoslavResolution = await resolveGlobalResponse(counterfactualDb, yugoslavCrisis._id);
    const securityExpiry = securityCrisis.startTurn + (securityCrisis.durationTurns ?? 24);
    await counterfactualDb
      .collection("gameState")
      .updateOne(
        { _id: "current" as never },
        { $set: { currentTurn: securityExpiry, currentYear: 2028 } }
      );
    const securityResolution = await resolveGlobalResponse(counterfactualDb, securityCrisis._id);
    assert(yugoslavResolution && securityResolution);
    assert.equal(yugoslavResolution.respondedCountries, 1);
    assert.equal(securityResolution.respondedCountries, 1);
    assert.deepEqual(
      await resolveGlobalResponse(counterfactualDb, yugoslavCrisis._id),
      yugoslavResolution
    );
    assert.deepEqual(
      await resolveGlobalResponse(counterfactualDb, securityCrisis._id),
      securityResolution
    );
    for (const [crisis, expiry] of [
      [yugoslavCrisis, yugoslavExpiry],
      [securityCrisis, securityExpiry],
    ] as const) {
      await counterfactualDb
        .collection<Crisis>("crises")
        .updateOne(
          { _id: crisis._id },
          { $set: { status: "resolved", endTurn: expiry, resolvedAt: new Date() } }
        );
      assert.equal(
        (await counterfactualDb.collection<Crisis>("crises").findOne({ _id: crisis._id }))?.status,
        "resolved"
      );
    }
    console.log(
      JSON.stringify(
        {
          dbName,
          sourceSha: process.env.SOURCE_SHA ?? null,
          first,
          retry,
          rows,
          continuation,
          counterfactual: {
            yugoslavOpeningYear: yugoslavTurn.state.openedYear,
            yugoslavEvents: yugoslavTurn.events.map((event) => event.fired.phaseKey),
            yugoslavPublicResponse: "US:west_mediate",
            yugoslavResolution: yugoslavResolution.outcomeId,
            missingUkraineBelligerents: fallback.belligerents,
            missingUkraineRepresentedActors: securityTurn.state.representedActors,
            missingUkrainePublicResponse: "PL:uk_neutral",
            missingUkraineResolution: securityResolution.outcomeId,
          },
        },
        null,
        2
      )
    );
  } finally {
    await client.close();
    global._mongoClientPromise = undefined;
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
