import type { GameHealthSummary } from "@/lib/db/types/gameHealthSnapshot";

export interface MirroredProgress {
  currentTurn?: number;
  lastMessage?: string;
  lastWarnings?: string[];
  health?: GameHealthSummary | null;
  progressUpdatedAt?: Date;
}

export interface SandboxProgress {
  currentTurn?: number;
  lastMessage?: string;
  lastWarnings?: string[];
  health?: GameHealthSummary | null;
  progressUpdatedAt?: Date;
  updatedAt?: Date;
  bootstrapConformance?: {
    status: "reported" | "skipped-existing" | "diagnostic-error";
    summary: string;
    baselineCaptured: boolean;
    reportId?: unknown;
    ranAt?: Date | null;
    ok?: number | null;
    warn?: number | null;
    critical?: number | null;
  };
}

export function completedTurnProgress(
  currentTurn: number,
  result: { message: string; warnings: string[]; health?: GameHealthSummary | null },
  progressUpdatedAt: Date
): Required<
  Pick<
    SandboxProgress,
    "currentTurn" | "lastMessage" | "lastWarnings" | "progressUpdatedAt" | "updatedAt"
  >
> &
  Pick<SandboxProgress, "health"> {
  return {
    currentTurn,
    lastMessage: result.message,
    lastWarnings: result.warnings,
    ...(result.health ? { health: result.health } : {}),
    progressUpdatedAt,
    updatedAt: progressUpdatedAt,
  };
}

function warningsEqual(left: string[] | undefined, right: string[] | undefined): boolean {
  const a = left ?? [];
  const b = right ?? [];
  return a.length === b.length && a.every((warning, index) => warning === b[index]);
}

function healthEqual(
  left: GameHealthSummary | null | undefined,
  right: GameHealthSummary | null | undefined
): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

/**
 * Keep worker liveness independent from sandbox progress freshness. A mirror
 * tick always renews the worker lease, but only changes the job's `updatedAt`
 * when the reported turn/message/warnings actually changed.
 */
export function buildStatusMirrorUpdate(
  job: MirroredProgress,
  sandbox: SandboxProgress,
  workerHeartbeatAt: Date
): Record<string, unknown> {
  const heartbeat = {
    heartbeatAt: workerHeartbeatAt,
    workerHeartbeatAt,
    workerPhase: "turns",
  };
  const changed =
    sandbox.currentTurn !== job.currentTurn ||
    sandbox.lastMessage !== job.lastMessage ||
    !warningsEqual(sandbox.lastWarnings, job.lastWarnings) ||
    (sandbox.health != null && !healthEqual(sandbox.health, job.health));
  if (!changed) return heartbeat;

  const progressUpdatedAt = sandbox.progressUpdatedAt ?? sandbox.updatedAt ?? workerHeartbeatAt;
  return {
    currentTurn: sandbox.currentTurn,
    lastMessage: sandbox.lastMessage,
    lastWarnings: sandbox.lastWarnings,
    ...(sandbox.health != null ? { health: sandbox.health } : {}),
    progressUpdatedAt,
    updatedAt: progressUpdatedAt,
    ...heartbeat,
  };
}
