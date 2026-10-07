/** Read-only by default; --enqueue writes idempotent, overnight sandbox jobs only. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { MongoClient } from "mongodb";
import { makeWorldsimPlan, planRequestSchema, type AcceptedEvidence } from "./worldsimPlan";
import { plannedJobs } from "./worldsimPlanQueue";
import { defaultSimSourceDeps, verifySimSource } from "./simSource";

async function main() {
  const { values } = parseArgs({
    options: {
      request: { type: "string" },
      out: { type: "string" },
      enqueue: { type: "boolean", default: false },
    },
  });
  if (!values.request || !values.out)
    throw new Error("Use --request request.json --out plan.json [--enqueue]");
  const request = planRequestSchema.parse(JSON.parse(readFileSync(values.request, "utf8")));
  const changed = execFileSync(
    "git",
    [
      "diff",
      "--no-renames",
      "--name-only",
      "-z",
      request.baseline.commit,
      request.candidate.commit,
      "--",
    ],
    { encoding: "utf8" }
  )
    .split("\0")
    .filter(Boolean);
  const validateEvidence = (e: AcceptedEvidence) => {
    try {
      const bytes = readFileSync(e.reportPath);
      if (createHash("sha256").update(bytes).digest("hex") !== e.reportSha256) return false;
      const report = JSON.parse(bytes.toString("utf8"));
      return (
        report.fingerprint === e.fingerprint &&
        report.verdict === "passed" &&
        report.completedTurns === e.completedTurns
      );
    } catch {
      return false;
    }
  };
  const plan = makeWorldsimPlan(
    request,
    changed,
    `${process.version}/${process.platform}/${process.arch}`,
    validateEvidence
  );
  writeFileSync(values.out, JSON.stringify(plan, null, 2) + "\n");
  console.log(
    `${plan.status}: ${plan.turns} turns/arm; ${plan.reservedEngineSeconds}s engine reservation`
  );
  if (plan.status === "blocked") {
    process.exitCode = 2;
    return;
  }
  if (!values.enqueue || plan.status !== "ready") return;
  if (!process.env.OPS_MONGODB_URI)
    throw new Error("OPS_MONGODB_URI required to enqueue; plan written without queue mutation");
  // Verify every pin before writing either arm. The worker checks again at claim/spawn.
  for (const arm of plan.arms.filter((a) => !a.reusedReport))
    verifySimSource(arm, defaultSimSourceDeps());
  const client = new MongoClient(process.env.OPS_MONGODB_URI);
  try {
    await client.connect();
    const jobs = client
      .db(process.env.OPS_DB_NAME || "a-house-divided")
      .collection<{ _id: string; status: string }>("simJobs");
    const statuses: Array<{ id: string; status: unknown }> = [];
    for (const job of plannedJobs(plan, new Date())) {
      // Existing failed/running/completed jobs are never reset or retried automatically.
      await jobs.updateOne({ _id: job._id }, { $setOnInsert: job }, { upsert: true });
      const stored = await jobs.findOne({ _id: job._id });
      statuses.push({ id: job._id, status: stored?.status });
    }
    console.log(
      JSON.stringify({
        jobs: statuses,
        note: "Existing rows are retained, not requeued. A budget-aware worker is required.",
      })
    );
  } finally {
    await client.close();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
