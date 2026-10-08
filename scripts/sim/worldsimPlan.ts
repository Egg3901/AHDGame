/** Select bounded world evidence without treating a short run as balance proof. */
import { createHash } from "node:crypto";
import { z } from "zod";
import { resolveSimPreset } from "./simPreset";

const sha = z.string().regex(/^[a-f0-9]{40}$/);
const token = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const pin = z.object({ commit: sha, worktree: token }).strict();
export const planRequestSchema = z
  .object({
    baseline: pin,
    candidate: pin,
    intent: z.enum(["auto", "performance", "rules", "integration"]).default("auto"),
    question: z.string().min(8).max(1000),
    preset: z.string(),
    seed: token,
    attempt: z.number().int().min(1).max(100).default(1),
    state: z.enum(["fresh", "aged"]).default("fresh"),
    minimumTurns: z.number().int().min(1).max(5000).optional(),
    // Two occurrences of each declared cadence, regardless of initial offset.
    periods: z.array(z.number().int().min(1).max(2500)).max(32).default([]),
    maxEngineSeconds: z.number().int().min(1).max(604800),
    secondsPerTurn: z.number().positive().max(86400).default(700),
    bootstrapSeconds: z.number().nonnegative().max(86400).default(300),
    safetyFactor: z.number().min(1).max(10).default(1.5),
    costBasis: z
      .string()
      .min(1)
      .max(1000)
      .default("Unmeasured planning assumption; calibrate from a comparable run"),
    // Accepted evidence is an explicit input, not inferred from a job exit code.
    acceptedEvidence: z
      .array(
        z
          .object({
            fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
            verdict: z.literal("passed"),
            completedTurns: z.number().int().positive(),
            reportSha256: z.string().regex(/^[a-f0-9]{64}$/),
            reportPath: z.string().min(1),
          })
          .strict()
      )
      .default([]),
  })
  .strict();
export type PlanRequest = z.infer<typeof planRequestSchema>;
export type AcceptedEvidence = PlanRequest["acceptedEvidence"][number];
export interface PlannedArm {
  arm: "baseline" | "candidate";
  sourceCommit: string;
  sourceWorktree: string;
  fingerprint: string;
  reusedReport?: string;
  engineBudgetSeconds: number;
}
export interface WorldsimPlan {
  version: 1;
  attempt: number;
  question: string;
  changedPaths: string[];
  selection: "no-worldsim" | "matched-world";
  risk: string;
  turns: number;
  preset: string;
  seed: string;
  runtime: string;
  costBasis: string;
  maxEngineSeconds: number;
  reservedEngineSeconds: number;
  status: "no-worldsim-needed" | "ready" | "blocked" | "reuse";
  blockers: string[];
  limitations: string[];
  arms: PlannedArm[];
  queue: { startPolicy: "window"; cloneFromLive: false };
}

function presentationOnly(path: string): boolean {
  return (
    /^(docs\/|content\/changelog\/|messages\/|public\/)/.test(path) ||
    /^(README|CONTRIBUTING)\.md$/.test(path) ||
    /^src\/(components\/.*\.(tsx|css)|app\/.*\.css)$/.test(path)
  );
}

/** Inputs are exact git paths, including deleted and renamed old paths. Unknown paths escalate. */
export function makeWorldsimPlan(
  request: PlanRequest,
  changedPaths: string[],
  runtime: string,
  evidenceValid: (evidence: AcceptedEvidence) => boolean = () => false
): WorldsimPlan {
  const r = planRequestSchema.parse(request);
  const preset = resolveSimPreset(r.preset);
  const paths = [...new Set(changedPaths)].sort();
  const presentation = paths.length === 0 || paths.every(presentationOnly);
  const noWorld =
    presentation &&
    r.intent === "auto" &&
    r.minimumTurns === undefined &&
    r.periods.length === 0 &&
    r.state === "fresh";
  const risk = noWorld
    ? "presentation-only"
    : r.intent === "performance"
      ? "performance-smoke"
      : r.intent === "rules"
        ? "rule-trajectory"
        : "integrated-change";
  const blockers: string[] = [];
  if (!noWorld && r.state === "aged")
    blockers.push(
      "An aged-state fixture is required; fresh bootstrap cannot substitute. Use a verified prepared-sandbox experiment."
    );
  if (!noWorld && r.intent !== "performance" && r.minimumTurns === undefined) {
    blockers.push(
      "Declare minimumTurns for the question; paths cannot establish a sufficient balance horizon."
    );
  }
  const turns = noWorld ? 0 : Math.max(r.minimumTurns ?? 1, ...r.periods.map((p) => p * 2));
  const perArm = Math.ceil((r.bootstrapSeconds + turns * r.secondsPerTurn) * r.safetyFactor);
  const arms: PlannedArm[] = noWorld
    ? []
    : (["baseline", "candidate"] as const).map((arm) => {
        const source = r[arm];
        const fingerprint = createHash("sha256")
          .update(
            JSON.stringify({
              recipe: "worldsim-plan-v1",
              source: source.commit,
              preset,
              seed: r.seed,
              turns,
              mode: "full",
              actors: "pure-npp",
              runtime,
              // Bind evidence to reviewed intent/question/cadences as well as execution.
              intent: r.intent,
              question: r.question,
              periods: [...r.periods].sort((a, b) => a - b),
            })
          )
          .digest("hex");
        const evidence = r.acceptedEvidence.find(
          (e) => e.fingerprint === fingerprint && e.completedTurns >= turns && evidenceValid(e)
        );
        return {
          arm,
          sourceCommit: source.commit,
          sourceWorktree: source.worktree,
          fingerprint,
          ...(evidence ? { reusedReport: evidence.reportPath } : {}),
          engineBudgetSeconds: perArm,
        };
      });
  const reservedEngineSeconds = arms
    .filter((a) => !a.reusedReport)
    .reduce((n, a) => n + a.engineBudgetSeconds, 0);
  if (reservedEngineSeconds > r.maxEngineSeconds)
    blockers.push(
      `Required engine reservation ${reservedEngineSeconds}s exceeds ${r.maxEngineSeconds}s; do not shorten the required horizon.`
    );
  return {
    version: 1,
    attempt: r.attempt,
    question: r.question,
    changedPaths: paths,
    selection: noWorld ? "no-worldsim" : "matched-world",
    risk,
    turns,
    preset,
    seed: r.seed,
    runtime,
    costBasis: r.costBasis,
    maxEngineSeconds: r.maxEngineSeconds,
    reservedEngineSeconds,
    status: blockers.length
      ? "blocked"
      : noWorld
        ? "no-worldsim-needed"
        : arms.every((a) => a.reusedReport)
          ? "reuse"
          : "ready",
    blockers,
    arms,
    queue: { startPolicy: "window", cloneFromLive: false },
    limitations: [
      "Planning is not qualification. Compare outcomes and accounting, failures/retries, commands, bytes and peak memory before accepting evidence.",
      "Fresh seeded worlds only. Bootstrap drift may prevent same-state comparison; prepared/aged states and undeclared periodic or long-horizon effects remain unqualified.",
      "For performance changes, prefer an existing same-state phase replay; this world plan is only an integrated smoke fallback, not proof of phase equivalence.",
      "Budget caps engine subprocess time including bootstrap; queue wait, collectors, control-plane work and kill grace are excluded. It is not a currency or whole-host memory cap.",
      "Required verify/build/security gates remain mandatory. File classification is conservative guidance, not semantic analysis.",
    ],
  };
}
