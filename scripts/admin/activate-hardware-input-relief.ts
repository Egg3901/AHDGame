/** Dry-run by default. Bind activation to an explicitly reviewed idle world and turn. */
import { strict as assert } from "node:assert";
import { ObjectId } from "mongodb";
import { getDb, getMongoClient } from "../../src/lib/mongodb";
import { runRequiredTransaction } from "../../src/lib/db/runRequiredTransaction";
import type { GameState } from "../../src/lib/db/types/gameState";
import type { ActionAuditRecord } from "../../src/lib/db/types/actionAuditLog";

async function main() {
  const args = process.argv.slice(2);
  const value = (key: string) => args[args.indexOf(key) + 1];
  const apply = args.includes("--apply");
  const epoch = args.includes("--world-epoch") ? value("--world-epoch") : undefined;
  const expectedTurn = args.includes("--turn") ? Number(value("--turn")) : NaN;
  const actor = args.includes("--actor") ? value("--actor") : "operator";
  assert(
    epoch && Number.isInteger(expectedTurn) && expectedTurn >= 0,
    "Required: --world-epoch <reviewed epoch> --turn <reviewed current turn>"
  );
  const db = await getDb();
  const client = await getMongoClient();
  const now = new Date();
  const auditId = new ObjectId();
  try {
    const preview = await db.collection<GameState>("gameState").findOne(
      { _id: "current" },
      {
        projection: {
          worldEpochId: 1,
          currentTurn: 1,
          isProcessing: 1,
          processingKind: 1,
          hardwareInputReliefStartTurn: 1,
        },
      }
    );
    assert(preview?.worldEpochId === epoch, "World epoch changed");
    assert(preview.currentTurn === expectedTurn, "Turn changed; refresh the preview");
    assert(!preview.isProcessing && !preview.processingKind, "World is processing");
    console.log(
      JSON.stringify({
        apply,
        worldEpochId: epoch,
        currentTurn: expectedTurn,
        startTurn: preview.hardwareInputReliefStartTurn ?? expectedTurn,
        alreadyActivated: preview.hardwareInputReliefStartTurn !== undefined,
      })
    );
    if (!apply || preview.hardwareInputReliefStartTurn !== undefined) return;
    await runRequiredTransaction(
      async (session) => {
        const changed = await db.collection<GameState>("gameState").updateOne(
          {
            _id: "current",
            worldEpochId: epoch,
            currentTurn: expectedTurn,
            isProcessing: { $ne: true },
            processingKind: null,
            hardwareInputReliefStartTurn: { $exists: false },
          },
          { $set: { hardwareInputReliefStartTurn: expectedTurn } },
          { session }
        );
        assert(changed.modifiedCount === 1, "World changed or activation already exists");
        await db.collection<ActionAuditRecord>("actionAuditLog").insertOne(
          {
            _id: auditId,
            ts: now,
            turn: expectedTurn,
            traceId: auditId.toHexString(),
            source: "admin",
            category: "admin",
            action: "admin.hardware_input_relief.activate",
            actor: { kind: "admin", name: actor },
            subject: { type: "world", id: epoch },
            delta: [{ field: "hardwareInputReliefStartTurn", before: null, after: expectedTurn }],
            outcome: "ok",
            meta: { reduction: 0.15, phaseTurns: 12 },
            expiresAt: new Date(now.getTime() + 336 * 60 * 60 * 1000),
          },
          { session }
        );
      },
      { client }
    );
    console.log(
      JSON.stringify({ committed: true, auditId: auditId.toHexString(), startTurn: expectedTurn })
    );
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Activation failed");
  process.exitCode = 1;
});
