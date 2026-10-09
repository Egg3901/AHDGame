/**
 * Recover a failed 1991 build after teardown without resetting the world again.
 * Only an empty, sealed turn-1 no-party world is eligible. Recaps, retired
 * characters and accounts are preserved by running build and finalize only.
 */
import { ObjectId, type Db } from "mongodb";
import { bootstrapGameWorld } from "./bootstrapGameWorld";
import { finalizeResetGameWorld } from "./finalizeResetGameWorld";
import { createResetRunRecord } from "./resetRunRecord";
import { captureSeedBaseline, formatDiagnosticSummary, runSeedDiagnostic } from "./seedDiagnostic";
import { seedPartylessFoundingCandidates } from "@/lib/npp/seedPartylessFoundingCandidates";
import { invalidateGameTimeCache } from "@/lib/time/gameTime";

const EMPTY_COLLECTIONS = [
  "characters",
  "elections",
  "npps",
  "electedOfficials",
  "corporations",
  "corporateSectors",
  "unions",
  "indexFunds",
  "indexFundPositions",
] as const;

export class BootstrapRecoveryConflict extends Error {}

export async function preview1991BootstrapRecovery(db: Db, runId: string) {
  const [state, config, audit, counts] = await Promise.all([
    db.collection("gameState").findOne({ _id: "current" as never }),
    db.collection("gameConfig").findOne({ _id: "default" as never }),
    db.collection("adminLogs").findOne({ "resetRun.runId": runId }),
    Promise.all(
      EMPTY_COLLECTIONS.map(
        async (name) => [name, await db.collection(name).countDocuments()] as const
      )
    ),
  ]);
  if (
    config?.lastReset?.runId !== runId ||
    config.lastReset.status !== "failed" ||
    config.lastReset.phaseReached !== "build" ||
    audit?.resetRun?.runId !== runId ||
    audit.resetRun.status !== "failed" ||
    audit.resetRun.phaseReached !== "build" ||
    audit.resetRun.preset !== "1991-default" ||
    audit.resetRun.mode !== "historical" ||
    !Array.isArray(audit.resetRun.logTail) ||
    !audit.resetRun.logTail.some(
      (line: unknown) =>
        typeof line === "string" &&
        line.startsWith(
          "Reset ABORTED in build: Fresh vehicle-model seed preflight requires empty economic collections:"
        )
    )
  ) {
    throw new BootstrapRecoveryConflict(
      "Recovery requires the current failed 1991 historical vehicle-preflight run"
    );
  }
  if (
    state?.preset !== "1991-default" ||
    state.currentTurn !== 1 ||
    state.currentYear !== 1991 ||
    state.startingPartiesMode !== "none" ||
    state.isActive !== false ||
    state.isProcessing !== false ||
    state.nextScheduledTurn != null ||
    config.maintenanceMode !== "full"
  ) {
    throw new BootstrapRecoveryConflict(
      "Recovery requires a sealed inactive turn-1 1991 no-party world"
    );
  }
  const occupied = counts.filter(([, count]) => count > 0);
  if (occupied.length > 0) {
    throw new BootstrapRecoveryConflict(
      `Recovery runtime is not empty: ${occupied.map(([name, count]) => `${name}=${count}`).join(", ")}`
    );
  }
  const unownedSectors = await db.collection("unownedSectors").countDocuments();
  if (unownedSectors > 10000)
    throw new BootstrapRecoveryConflict("Stale market pool exceeds recovery cap");
  return {
    ready: true as const,
    runId,
    preset: "1991-default" as const,
    startingParties: "none" as const,
    unownedSectors,
  };
}

export async function recover1991Bootstrap(
  db: Db,
  options: { runId: string; adminUsername: string; log?: (line: string) => void }
) {
  await preview1991BootstrapRecovery(db, options.runId);
  const claimed = await db.collection("gameConfig").updateOne(
    {
      _id: "default" as never,
      "lastReset.runId": options.runId,
      "lastReset.status": "failed",
      "lastReset.phaseReached": "build",
    },
    { $set: { "lastReset.status": "recovering" } }
  );
  if (claimed.matchedCount !== 1)
    throw new BootstrapRecoveryConflict("Recovery was already claimed or the reset changed");

  const logs: string[] = [];
  const log = (line: string) => {
    logs.push(line);
    options.log?.(line);
  };
  const run = createResetRunRecord(log);
  let phaseReached = "build";
  let aborted = false;
  const auditId = new ObjectId();
  try {
    await db.collection("adminLogs").insertOne({
      _id: auditId,
      category: "system",
      action: "game_reset_recovery",
      adminUsername: options.adminUsername,
      createdAt: new Date(),
      recovery: { runId: options.runId, status: "running" },
    });
    // This pool survived the reference/runtime split. All economic owners and
    // player runtime were verified empty above; bootstrap rebuilds the pool.
    const cleared = await db.collection("unownedSectors").deleteMany({});
    log(`Recovery cleared ${cleared.deletedCount} stale unowned markets; teardown is not repeated`);
    const clock = await db.collection("gameState").updateOne(
      {
        _id: "current" as never,
        preset: "1991-default",
        currentTurn: 1,
        isActive: false,
        isProcessing: false,
      },
      { $set: { preIteration: { active: true, startedTurn: 1 }, preIterationTurns: 0 } }
    );
    if (clock.matchedCount !== 1)
      throw new BootstrapRecoveryConflict("World changed before founding recovery");
    invalidateGameTimeCache();
    await bootstrapGameWorld({
      db,
      preset: "1991-default",
      mode: "historical",
      startingParties: "none",
      resetReference: true,
      preIteration: true,
      log,
      run,
    });
    phaseReached = "finalize";
    await run.step("finalize", "finalizeResetGameWorld", () =>
      finalizeResetGameWorld(db, {
        preset: "1991-default",
        startingParties: "none",
        teardown: {
          officialsDeleted: 0,
          officialsSeeded: 0,
          electionsDeleted: 0,
          candidatesDeleted: 0,
          nppsDeleted: 0,
          nppsSeeded: 0,
          statePartyElectionsDeleted: 0,
          billsDeleted: 0,
          stateBillsDeleted: 0,
          actionLogsCleared: 0,
          demographicsReset: 0,
          customPartiesDeleted: 0,
          partyOrgRecordsDeleted: 0,
          budgetSeedLog: [],
        },
        deleteProfiles: false,
        log,
      })
    );
    await run.step("finalize", "seedPartylessFoundingCandidates", () =>
      seedPartylessFoundingCandidates(db, "1991-default", log)
    );
    phaseReached = "audit";
    const report = await runSeedDiagnostic(db, {
      preset: "1991-default",
      mode: "conformance",
      trigger: "post-reset",
    });
    log(formatDiagnosticSummary(report));
    for (const check of report.checks.filter((check) => check.severity === "critical")) {
      run.recordFailure(
        "audit",
        check.id,
        `${check.scope}: ${check.metric}; expected ${check.expected}, actual ${check.actual}`
      );
    }
    if (report.summary.critical > 0 && run.failures.length === 0) {
      run.recordFailure(
        "audit",
        "seedConformance",
        `${report.summary.critical} critical seed checks`
      );
    }
    if (run.status(false) === "succeeded") await captureSeedBaseline(db);
    phaseReached = "complete";
    return { status: run.status(false), diagnostics: report.summary, failures: run.failures, logs };
  } catch (error) {
    aborted = true;
    log(
      `Recovery failed in ${phaseReached}: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error;
  } finally {
    const status = run.status(aborted);
    await db.collection("gameConfig").updateOne(
      {
        _id: "default" as never,
        "lastReset.runId": options.runId,
        "lastReset.status": "recovering",
      },
      {
        $set: {
          "lastReset.status": status,
          "lastReset.phaseReached": phaseReached,
          "lastReset.recoveredAt": new Date(),
          "lastReset.recoveredBy": options.adminUsername,
        },
      }
    );
    await db.collection("adminLogs").updateOne(
      { _id: auditId },
      {
        $set: {
          "recovery.status": status,
          "recovery.phaseReached": phaseReached,
          "recovery.finishedAt": new Date(),
          "recovery.failures": run.failures,
          "recovery.logTail": logs.slice(-200),
        },
      }
    );
    await db.collection("adminLogs").updateOne(
      { "resetRun.runId": options.runId },
      {
        $set: {
          "resetRun.recoveryAuditId": auditId,
          "resetRun.recoveryStatus": status,
          "resetRun.recoveredAt": new Date(),
        },
      }
    );
  }
}
