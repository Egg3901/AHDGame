/** Read-only crisis timing and decision evidence from an existing sandbox run. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { MongoClient } from "mongodb";
import { execFileSync } from "node:child_process";

const arg = (name) =>
  process.argv
    .find((item) => item.startsWith(`--${name}=`))
    ?.split("=")
    .slice(1)
    .join("=");
const dbName = arg("db");
const runId = arg("run-id");
const uri = process.env.SIM_MONGODB_URI;
if (!dbName?.startsWith("ahd_sim_") || !runId || !uri)
  throw new Error("Explicit sandbox db, run-id and SIM_MONGODB_URI required");
const endpoint = new URL(uri);
if (
  endpoint.protocol !== "mongodb:" ||
  !["127.0.0.1", "localhost"].includes(endpoint.hostname) ||
  endpoint.port !== "27018"
)
  throw new Error("Dedicated loopback sandbox required");
const client = new MongoClient(uri);
await client.connect();
try {
  const db = client.db(dbName);
  const run = await db.collection("simRuns").findOne({ runId });
  if (!run || run.status !== "completed") throw new Error("Completed run required");
  const [states, windows] = await Promise.all([
    db
      .collection("livingConflicts")
      .find(
        {},
        {
          projection: {
            defKey: 1,
            hasOpened: 1,
            openedYear: 1,
            phaseLevel: 1,
            totalTurns: 1,
            status: 1,
            tracks: 1,
            "campaign.consequences": 1,
          },
        }
      )
      .toArray(),
    db
      .collection("crises")
      .find(
        {
          $or: [
            { livingConflictEventId: { $type: "string" } },
            { "globalResponse.conflictKey": { $type: "string" } },
          ],
        },
        {
          projection: {
            livingConflictEventId: 1,
            "globalResponse.conflictKey": 1,
            startTurn: 1,
            durationTurns: 1,
            status: 1,
          },
        }
      )
      .toArray(),
  ]);
  const interactions = await db
    .collection("crisisInteractions")
    .find(
      { crisisId: { $in: windows.map((row) => row._id) } },
      {
        projection: {
          crisisId: 1,
          resolvedAt: 1,
          resolutionPath: 1,
          "leaderResponses.countryId": 1,
          "globalResponseOutcome.outcomeId": 1,
        },
      }
    )
    .toArray();
  const byId = new Map(interactions.map((row) => [row.crisisId.toString(), row]));
  const keyOf = (row) =>
    row.globalResponse?.conflictKey ?? row.livingConflictEventId?.split(":")[0];
  const timeline = windows
    .map((row) => {
      const interaction = byId.get(row._id.toString());
      return {
        conflict: keyOf(row),
        openedTurn: row.startTurn,
        authoredEndTurn: row.durationTurns == null ? null : row.startTurn + row.durationTurns,
        status: row.status,
        interactionPresent: !!interaction,
        resolved: interaction ? !!interaction.resolvedAt : null,
        outcome: interaction?.globalResponseOutcome?.outcomeId ?? null,
        recordedChoices: interaction
          ? (interaction.resolutionPath?.length ?? 0) + (interaction.leaderResponses?.length ?? 0)
          : null,
      };
    })
    .sort((a, b) => a.openedTurn - b.openedTurn || a.conflict.localeCompare(b.conflict));
  let peakAuthoredWindowOverlap = 0;
  for (let turn = 1; turn <= run.currentTurn; turn += 1) {
    peakAuthoredWindowOverlap = Math.max(
      peakAuthoredWindowOverlap,
      timeline.filter(
        (row) =>
          row.openedTurn <= turn && (row.authoredEndTurn === null || turn < row.authoredEndTurn)
      ).length
    );
  }
  const source = run.source?.executedCommit;
  if (!source) throw new Error("Missing executed source provenance");
  console.log(
    JSON.stringify(
      {
        schemaVersion: 1,
        collectorSha256: createHash("sha256")
          .update(readFileSync(new URL(import.meta.url)))
          .digest("hex"),
        collectorCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
        collectorDirty:
          execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
            encoding: "utf8",
          }).trim().length > 0,
        runId,
        sourceCommit: source,
        preset: run.preset,
        seed: run.seed,
        actorMode: run.actorMode,
        status: run.status,
        completedTurn: run.currentTurn,
        effectiveFlags: Object.fromEntries(
          ["livingConflictsEnabled", "crisisInteractionEnabled", "crisisAidBillsEnabled"].map(
            (key) => [key, run.effectiveConfigInitial?.gameState?.[key] ?? null]
          )
        ),
        peakAuthoredWindowOverlap,
        caveats: [
          "Overlap uses authored response-window intervals, not reconstructed early resolution turns.",
          "Consequences and tracks are endpoint observations, not a retained recovery trajectory.",
          "Missing interactions remain null and are counted explicitly.",
          "This is subsystem telemetry from a completed world, not reset qualification.",
        ],
        missingInteractions: timeline.filter((row) => !row.interactionPresent).length,
        states: states
          .map((row) => ({
            key: row.defKey,
            opened: row.hasOpened,
            openedYear: row.openedYear ?? null,
            status: row.status ?? null,
            phase: row.phaseLevel,
            durationTurns: row.totalTurns,
            tracks: row.tracks ?? null,
            consequences: row.campaign?.consequences ?? null,
          }))
          .sort((a, b) => a.key.localeCompare(b.key)),
        timeline,
      },
      null,
      2
    )
  );
} finally {
  await client.close();
}
