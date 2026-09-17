import type { TurnStatus } from "@/hooks/useGameEvents";
import { classifyTurnActivity, type TurnActivityId } from "./turnProgressPresentation";

/** Hard ceiling for a processing session. Never treated as successful completion. */
export const TURN_PROGRESS_STALE_MS = 30 * 60 * 1000;

/** Heartbeat age after which the worker is treated as lost, not still running. */
export const TURN_PROGRESS_HEARTBEAT_GRACE_MS = 2 * 60 * 1000;

export type TurnProgressStatus = TurnStatus & {
  singleplayer?: boolean;
  processingHeartbeatAt?: string | Date | null;
  processingStartedAt?: string | Date | null;
};

export type TurnProgressKind = "hidden" | "processing" | "stale" | "offline" | "error";

export interface TurnProgressView {
  kind: TurnProgressKind;
  sessionKey: string | null;
  targetTurn: number | null;
  currentTurn: number | null;
  progress: number | null;
  activityId: TurnActivityId;
  activityLabel: string | null;
  errorMessage: string | null;
}

export interface TurnProgressMemory {
  dismissedKey: string | null;
  completedKey: string | null;
  cancelledKey: string | null;
  errorMessage: string | null;
  offline: boolean;
  key: string | null;
  anchorTurn: number | null;
  firstSeenAtMs: number | null;
  lastStatus: TurnProgressStatus | null;
  completeFence: boolean;
  fencedTurn: number | null;
}

export interface TurnProgressSnapshot {
  view: TurnProgressView;
  memory: TurnProgressMemory;
}

export type TurnProgressEvent =
  | { type: "status"; status: TurnProgressStatus | null; nowMs: number }
  | { type: "tick"; nowMs: number }
  | { type: "dismiss" }
  | { type: "complete" }
  | { type: "error"; message?: string | null }
  | { type: "cancel" }
  | { type: "offline" }
  | { type: "online"; nowMs: number }
  | { type: "retry"; nowMs: number }
  | { type: "reset" };

export const HIDDEN_VIEW: TurnProgressView = {
  kind: "hidden",
  sessionKey: null,
  targetTurn: null,
  currentTurn: null,
  progress: null,
  activityId: "preparing",
  activityLabel: null,
  errorMessage: null,
};

export const INITIAL_TURN_PROGRESS_MEMORY: TurnProgressMemory = {
  dismissedKey: null,
  completedKey: null,
  cancelledKey: null,
  errorMessage: null,
  offline: false,
  key: null,
  anchorTurn: null,
  firstSeenAtMs: null,
  lastStatus: null,
  completeFence: false,
  fencedTurn: null,
};

export const INITIAL_TURN_PROGRESS: TurnProgressSnapshot = {
  view: HIDDEN_VIEW,
  memory: INITIAL_TURN_PROGRESS_MEMORY,
};

export function measuredProgress(status: TurnProgressStatus | null): number | null {
  const value = status?.processingProgress;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function toEpochMs(value: string | Date | null | undefined): number | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function processingSessionKey(
  status: TurnProgressStatus,
  anchorTurn: number | null
): string {
  const started = toEpochMs(status.processingStartedAt);
  if (status.processingTargetTurn != null) {
    return `target:${status.processingTargetTurn}${started == null ? "" : `:start:${started}`}`;
  }
  if (started != null) return `start:${started}`;
  return `anchor:${anchorTurn ?? status.currentTurn}`;
}

function turnAlreadyAdvanced(status: TurnProgressStatus, memory: TurnProgressMemory): boolean {
  if (status.processingTargetTurn != null && status.currentTurn >= status.processingTargetTurn) {
    return true;
  }
  if (memory.key == null) return false;
  const nextKey = processingSessionKey(status, memory.anchorTurn ?? status.currentTurn);
  if (nextKey !== memory.key) return false;
  return memory.anchorTurn != null && status.currentTurn > memory.anchorTurn;
}

function isMultiplayer(status: TurnProgressStatus | null): boolean {
  return status?.singleplayer === false;
}

function isNewerThanFence(status: TurnProgressStatus, fencedTurn: number | null): boolean {
  if (fencedTurn == null) return false;
  if (status.processingTargetTurn != null && status.processingTargetTurn > fencedTurn) return true;
  return status.currentTurn > fencedTurn && status.isProcessing;
}

function hiddenSnapshot(memory: TurnProgressMemory, status: TurnProgressStatus | null) {
  return {
    view: {
      ...HIDDEN_VIEW,
      currentTurn: status?.currentTurn ?? memory.lastStatus?.currentTurn ?? null,
    },
    memory,
  };
}

function viewForKind(
  kind: Exclude<TurnProgressKind, "hidden">,
  status: TurnProgressStatus,
  memory: TurnProgressMemory
): TurnProgressView {
  const activity = classifyTurnActivity(
    status.processingPhase ?? null,
    status.processingPhaseLabel ?? null
  );
  return {
    kind,
    sessionKey: memory.key,
    targetTurn: status.processingTargetTurn ?? null,
    currentTurn: status.currentTurn,
    progress: measuredProgress(status),
    activityId: activity.id,
    activityLabel: activity.label,
    errorMessage: kind === "error" ? memory.errorMessage : null,
  };
}

function projectActive(
  status: TurnProgressStatus,
  memory: TurnProgressMemory,
  nowMs: number
): TurnProgressSnapshot {
  if (memory.dismissedKey === memory.key || memory.cancelledKey === memory.key) {
    return hiddenSnapshot(memory, status);
  }
  if (memory.completedKey === memory.key) return hiddenSnapshot(memory, status);

  if (memory.errorMessage !== null) {
    return { view: viewForKind("error", status, memory), memory };
  }
  if (memory.offline) {
    return { view: viewForKind("offline", status, memory), memory };
  }

  const startedAt = toEpochMs(status.processingStartedAt) ?? memory.firstSeenAtMs ?? nowMs;
  const heartbeatAt = toEpochMs(status.processingHeartbeatAt);
  const staleByLock = status.canResetProcessingLock === true;
  const staleByBound = nowMs - startedAt >= TURN_PROGRESS_STALE_MS;
  const staleByHeartbeat =
    heartbeatAt != null && nowMs - heartbeatAt >= TURN_PROGRESS_HEARTBEAT_GRACE_MS;

  if (staleByLock || staleByBound || staleByHeartbeat) {
    return { view: viewForKind("stale", status, memory), memory };
  }
  return { view: viewForKind("processing", status, memory), memory };
}

function applyStatus(
  prev: TurnProgressMemory,
  status: TurnProgressStatus | null,
  nowMs: number
): TurnProgressSnapshot {
  if (isMultiplayer(status)) {
    return hiddenSnapshot({ ...INITIAL_TURN_PROGRESS_MEMORY, lastStatus: status }, status);
  }

  if (status == null) {
    if (
      prev.key &&
      prev.completedKey !== prev.key &&
      prev.dismissedKey !== prev.key &&
      prev.cancelledKey !== prev.key &&
      !prev.completeFence
    ) {
      const last = prev.lastStatus;
      if (last && last.singleplayer !== false) {
        return {
          view: viewForKind("offline", last, { ...prev, offline: true }),
          memory: { ...prev, offline: true },
        };
      }
    }
    return hiddenSnapshot({ ...prev, lastStatus: null }, null);
  }

  let memory: TurnProgressMemory = { ...prev, lastStatus: status };

  if (memory.completeFence) {
    if (!status.isProcessing) {
      memory = {
        ...memory,
        completeFence: false,
        key: null,
        anchorTurn: null,
        firstSeenAtMs: null,
      };
      return hiddenSnapshot(memory, status);
    }
    if (!isNewerThanFence(status, memory.fencedTurn)) {
      return hiddenSnapshot(memory, status);
    }
    memory = { ...memory, completeFence: false, fencedTurn: null };
  }

  if (turnAlreadyAdvanced(status, memory)) {
    const fencedTurn = status.processingTargetTurn ?? status.currentTurn;
    memory = {
      ...memory,
      completeFence: status.isProcessing,
      fencedTurn,
      completedKey: memory.key ?? memory.completedKey,
      key: null,
      anchorTurn: null,
      firstSeenAtMs: null,
    };
    return hiddenSnapshot(memory, status);
  }

  if (!status.isProcessing) {
    const cancelled =
      memory.key != null &&
      memory.completedKey !== memory.key &&
      memory.anchorTurn != null &&
      status.currentTurn <= memory.anchorTurn;
    memory = {
      ...memory,
      cancelledKey: cancelled ? memory.key : memory.cancelledKey,
      key: null,
      anchorTurn: null,
      firstSeenAtMs: null,
      errorMessage: null,
      offline: false,
    };
    return hiddenSnapshot(memory, status);
  }

  const anchorTurn =
    memory.key != null ? (memory.anchorTurn ?? status.currentTurn) : status.currentTurn;
  const key = processingSessionKey(status, anchorTurn);
  const restarted = memory.key != null && memory.key !== key;

  memory = {
    ...memory,
    key,
    anchorTurn: restarted || memory.key == null ? status.currentTurn : anchorTurn,
    firstSeenAtMs: restarted || memory.firstSeenAtMs == null ? nowMs : memory.firstSeenAtMs,
    errorMessage: restarted ? null : memory.errorMessage,
    offline: restarted ? false : memory.offline,
  };

  return projectActive(status, memory, nowMs);
}

export function reduceTurnProgress(
  prev: TurnProgressSnapshot,
  event: TurnProgressEvent
): TurnProgressSnapshot {
  switch (event.type) {
    case "reset":
      return INITIAL_TURN_PROGRESS;
    case "status":
      return applyStatus(prev.memory, event.status, event.nowMs);
    case "tick":
      return applyStatus(prev.memory, prev.memory.lastStatus, event.nowMs);
    case "dismiss": {
      if (!prev.memory.key) return { view: HIDDEN_VIEW, memory: prev.memory };
      const memory = { ...prev.memory, dismissedKey: prev.memory.key };
      return hiddenSnapshot(memory, memory.lastStatus);
    }
    case "complete": {
      const fencedTurn =
        prev.memory.lastStatus?.processingTargetTurn ??
        prev.memory.lastStatus?.currentTurn ??
        prev.memory.anchorTurn;
      const memory: TurnProgressMemory = {
        ...prev.memory,
        completeFence: true,
        fencedTurn,
        completedKey: prev.memory.key ?? prev.memory.completedKey,
        key: null,
        firstSeenAtMs: null,
        errorMessage: null,
        offline: false,
      };
      return hiddenSnapshot(memory, memory.lastStatus);
    }
    case "error": {
      const memory = {
        ...prev.memory,
        errorMessage: event.message?.trim() ? event.message : "",
      };
      if (!memory.lastStatus?.isProcessing || memory.lastStatus.singleplayer === false) {
        return hiddenSnapshot(memory, memory.lastStatus);
      }
      if (memory.completeFence || memory.dismissedKey === memory.key) {
        return hiddenSnapshot(memory, memory.lastStatus);
      }
      return {
        view: viewForKind("error", memory.lastStatus, memory),
        memory,
      };
    }
    case "cancel": {
      const memory = {
        ...prev.memory,
        cancelledKey: prev.memory.key ?? prev.memory.cancelledKey,
        key: null,
        firstSeenAtMs: null,
        errorMessage: null,
        offline: false,
      };
      return hiddenSnapshot(memory, memory.lastStatus);
    }
    case "offline": {
      const memory = { ...prev.memory, offline: true };
      if (
        !memory.lastStatus?.isProcessing ||
        memory.lastStatus.singleplayer === false ||
        memory.completeFence ||
        memory.dismissedKey === memory.key
      ) {
        return hiddenSnapshot(memory, memory.lastStatus);
      }
      return { view: viewForKind("offline", memory.lastStatus, memory), memory };
    }
    case "online":
      return applyStatus({ ...prev.memory, offline: false }, prev.memory.lastStatus, event.nowMs);
    case "retry":
      return applyStatus(
        { ...prev.memory, offline: false, errorMessage: null },
        prev.memory.lastStatus,
        event.nowMs
      );
  }
}
