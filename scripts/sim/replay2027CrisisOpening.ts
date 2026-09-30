/** Bounded fresh-world seeder/driver proof against the dedicated sandbox Mongo. */
import assert from "node:assert/strict";
import { MongoClient } from "mongodb";
import {
  seedColdWarFoundations,
  nuclearProgramBaselines,
} from "../../src/lib/admin/seed/seedColdWarFoundations";
import { allLivingConflictDefs } from "../../src/lib/livingConflict/registry";
import { AUTHORED_2027_FAMILIES } from "../../src/lib/livingConflict/initialState2027";
import { driveConflictTurn } from "../../src/lib/livingConflict/driver";
import { resolveConflictParticipants } from "../../src/lib/livingConflict/rules/participants";
import { reconcileNorthernIrelandRatification } from "../../src/lib/livingConflict/northernIrelandRatification";
import type { LivingConflictState } from "../../src/lib/livingConflict/types";
import type { NuclearProgram } from "../../src/lib/db/types/nuclearProgram";

const uri = process.env.SIM_MONGODB_URI;
assert(
  uri && /^mongodb:\/\/(127\.0\.0\.1|localhost):27018\/?$/.test(uri),
  "Dedicated loopback sandbox Mongo on port 27018 required"
);
const dbName = `ahd_sim_issue2159_crisis2027_${Date.now()}`;
const client = new MongoClient(uri);
await client.connect();
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
      .collection<{ _id: string; currentTurn: number; currentYear: number; startingYear: number }>(
        "gameState"
      )
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
  console.log(
    JSON.stringify(
      { dbName, sourceSha: process.env.SOURCE_SHA ?? null, first, retry, rows },
      null,
      2
    )
  );
} finally {
  await client.close();
}
