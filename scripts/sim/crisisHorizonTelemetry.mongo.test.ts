import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { expect, it } from "vitest";
import { buildCrisisHorizonReport } from "./crisisHorizonReport";
import {
  captureCrisisHorizonTurn,
  HORIZON_CRISIS_KEYS,
  type CrisisHorizonPoint,
} from "./crisisHorizonTelemetry";

it.skipIf(process.env.AHD_CRISIS_HORIZON_REAL_MONGO !== "1")(
  "captures all seven families once per completed sandbox turn and rejects report gaps",
  async () => {
    const client = new MongoClient("mongodb://127.0.0.1:27018");
    const db = client.db(`ahd_sim_crisis_horizon_${randomUUID().replaceAll("-", "")}`);
    const runId = "horizon-replay";
    const codeVersion = "a".repeat(40);
    const input = { runId, seed: "horizon-seed", codeVersion };
    try {
      await client.connect();
      await db
        .collection<{ _id: string; currentTurn: number; currentYear: number }>("gameState")
        .insertOne({ _id: "current", currentTurn: 2, currentYear: 1991 });
      await db.collection("livingConflicts").insertOne({
        defKey: "northern_ireland",
        hasOpened: true,
        status: "active",
        phaseLevel: 1,
        intensity: 35,
        pressure: { a: 2 },
        tracks: { talks: 1 },
        campaign: {
          stage: "posture",
          cycle: 1,
          consequences: { refugees: 2, infrastructureDamage: 3 },
        },
      });
      await captureCrisisHorizonTurn(db, { ...input, turn: 2 });
      expect(await db.collection("simCrisisHorizon").countDocuments()).toBe(
        HORIZON_CRISIS_KEYS.length
      );
      await db
        .collection("livingConflicts")
        .updateOne({ defKey: "northern_ireland" }, { $set: { intensity: 90 } });
      await captureCrisisHorizonTurn(db, { ...input, turn: 2 });
      expect(
        (
          await db.collection("simCrisisHorizon").findOne({
            runId,
            turn: 2,
            defKey: "northern_ireland",
          })
        )?.intensity
      ).toBe(35);
      await db
        .collection<{ _id: string; currentTurn: number; currentYear: number }>("gameState")
        .updateOne({ _id: "current" }, { $set: { currentTurn: 3, currentYear: 1991 } });
      const event = await db.collection("crises").insertOne({
        livingConflictEventId: "northern_ireland:talks:3:response",
        startTurn: 3,
      });
      await db.collection("crisisInteractions").insertOne({
        crisisId: event.insertedId,
        resolutionPath: ["negotiate", "done"],
        decisionTree: [
          {
            nodeId: "choice",
            title: "Talks",
            options: [{ optionId: "negotiate", label: "Negotiate" }],
          },
          { nodeId: "done", type: "terminal" },
        ],
        resolutionOutcome: "auto",
        resolvedAt: new Date("1991-01-01T00:00:00Z"),
      });
      await captureCrisisHorizonTurn(db, { ...input, turn: 3 });
      const points = await db
        .collection<CrisisHorizonPoint>("simCrisisHorizon")
        .find({ runId })
        .toArray();
      expect(points).toHaveLength(14);
      const manifest = {
        runId,
        seed: input.seed,
        status: "completed",
        source: { executedCommit: codeVersion },
        crisisHorizonTelemetry: { expectedFirstTurn: 2, expectedLastTurn: 3, families: 7 },
      };
      const complete = buildCrisisHorizonReport(manifest, points);
      expect(complete.qualification).toBe("complete");
      expect(complete.families.northern_ireland?.maximumIntensity).toBe(90);
      expect(complete.families.northern_ireland?.eventCount).toBe(1);
      expect(complete.families.northern_ireland?.responseCount).toBe(1);
      expect(complete.families.northern_ireland?.automaticResolutionCount).toBe(1);
      expect(complete.overlap.peakNewResponsesPerTurn).toBe(1);
      expect(complete.families.pandemic?.missingStateTurns).toBe(2);
      expect(buildCrisisHorizonReport(manifest, points.slice(1)).reasons).toContain(
        `missing ${points[0]!.turn}/${points[0]!.defKey}`
      );
      expect(
        buildCrisisHorizonReport(manifest, [
          { ...points[0]!, codeVersion: "wrong" },
          ...points.slice(1),
        ]).qualification
      ).toBe("incomplete");
      await expect(
        captureCrisisHorizonTurn(client.db("game"), { ...input, turn: 2 })
      ).rejects.toThrow(/sandbox-only/);
    } finally {
      await db.dropDatabase();
      await client.close();
    }
  }
);
