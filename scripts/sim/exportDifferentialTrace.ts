#!/usr/bin/env npx tsx
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { EJSON } from "bson";
import type { Db } from "mongodb";
import {
  buildDifferentialTrace,
  hashNormalizedMongoObservation,
  normalizeMongoObservation,
  type PhaseCapture,
} from "./differentialTraceExport";

const execFileAsync = promisify(execFile);

function arg(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`Missing --${name}`);
  return value;
}

async function capture(db: Db, countryId: string) {
  const [resources, elections, electionCandidates, budgets, stateBudgets, policies, laws, news] =
    await Promise.all([
      db
        .collection("npps")
        .find({ countryId })
        .project({ _id: 1, countryId: 1, actions: 1, funds: 1, currencyBalances: 1 })
        .sort({ _id: 1 })
        .toArray(),
      db
        .collection("elections")
        .find({ countryId })
        .project({
          _id: 1,
          countryId: 1,
          office: 1,
          stateId: 1,
          status: 1,
          currentRound: 1,
          primaryDate: 1,
          generalDate: 1,
          winnerId: 1,
        })
        .sort({ _id: 1 })
        .toArray(),
      db
        .collection("electionCandidates")
        .find({ countryId })
        .project({
          _id: 1,
          electionId: 1,
          characterId: 1,
          nppId: 1,
          partyId: 1,
          status: 1,
          votes: 1,
          voteShare: 1,
        })
        .sort({ _id: 1 })
        .toArray(),
      db
        .collection("federalBudget")
        .find({ countryId })
        .project({
          _id: 1,
          countryId: 1,
          revenue: 1,
          spending: 1,
          surplus: 1,
          treasuryBalance: 1,
          debt: 1,
        })
        .sort({ _id: 1 })
        .toArray(),
      db
        .collection("stateBudgets")
        .find({ countryId })
        .project({ _id: 1, countryId: 1, stateId: 1, revenue: 1, spending: 1, balance: 1 })
        .sort({ _id: 1 })
        .toArray(),
      db
        .collection("countryGameStates")
        .find({ countryId })
        .project({ _id: 1, countryId: 1, policies: 1, policyPositions: 1 })
        .sort({ _id: 1 })
        .toArray(),
      db
        .collection("enactedLaws")
        .find({ countryId })
        .project({
          _id: 1,
          countryId: 1,
          legislationTypeId: 1,
          status: 1,
          enactedTurn: 1,
          policyEffects: 1,
        })
        .sort({ _id: 1 })
        .toArray(),
      db
        .collection("newsPosts")
        .find({ countryId })
        .project({
          _id: 1,
          countryId: 1,
          category: 1,
          relatedCharacterIds: 1,
          relatedPartyIds: 1,
          relatedElectionId: 1,
          turn: 1,
        })
        .sort({ _id: 1 })
        .toArray(),
    ]);
  return EJSON.serialize({
    resources,
    elections: { elections, candidates: electionCandidates },
    budgets: { federal: budgets, state: stateBudgets },
    policies: { country: policies, enactedLaws: laws },
    playerConsequences: { news },
  });
}

async function main() {
  const dbName = arg("db");
  if (!/^ahd_sim_[a-z0-9_]+$/i.test(dbName)) {
    throw new Error("--db must name an isolated ahd_sim_* sandbox database");
  }
  process.env.MONGODB_DB = dbName;
  const seed = arg("seed");
  process.env.SIM_RNG_SALT = seed;
  const revision = arg("source-revision");
  const [{ stdout: head }, { stdout: status }] = await Promise.all([
    execFileAsync("git", ["rev-parse", "HEAD"]),
    execFileAsync("git", ["status", "--porcelain"]),
  ]);
  if (head.trim() !== revision || status.trim() !== "") {
    throw new Error("Source checkout must be clean and exactly match --source-revision");
  }
  const { getDb, getMongoClient } = await import("@/lib/mongodb");
  const { processTurn } = await import("@/lib/turnSystem");
  const db = await getDb();
  if ((await db.collection("users").countDocuments()) > 0) {
    throw new Error("Refusing to trace a database containing users");
  }
  const countryId = arg("country");
  const rawInitial = await capture(db, countryId);
  const initial = normalizeMongoObservation(rawInitial);
  const captures: PhaseCapture[] = [];
  const result = await processTurn({
    onPhaseCompleted: async ({ name }) => {
      captures.push({
        name,
        observations: normalizeMongoObservation(await capture(db, countryId)),
      });
    },
  });
  if (!result.success || captures.length === 0) {
    throw new Error(`AHDGame turn did not produce a complete trace: ${result.message}`);
  }
  const sourceSha256 = hashNormalizedMongoObservation(initial);
  const trace = buildDifferentialTrace({
    revision,
    fixtureId: arg("fixture"),
    era: arg("era"),
    countryId,
    seed,
    sourceSha256,
    initial,
    captures,
  });
  await writeFile(resolve(arg("output")), `${JSON.stringify(trace)}\n`, { flag: "wx" });
  await (await getMongoClient()).close();
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
