export interface SingleplayerSetupProgress {
  active: boolean;
  phase: "idle" | "preparing" | "clearing" | "building" | "finalizing" | "complete" | "failed";
  label: string;
  detail: string;
  progress: number;
  updatedAt: string;
  stalled: boolean;
}

const STORE = Symbol.for("ahd.singleplayerSetupProgress");
type GlobalStore = typeof globalThis & { [STORE]?: SingleplayerSetupProgress };

function state(): SingleplayerSetupProgress {
  const root = globalThis as GlobalStore;
  return (root[STORE] ??= {
    active: false,
    phase: "idle",
    label: "Ready",
    detail: "",
    progress: 0,
    updatedAt: new Date().toISOString(),
    stalled: false,
  });
}

export function readSingleplayerSetupProgress(): SingleplayerSetupProgress {
  const current = state();
  return {
    ...current,
    stalled: current.active && Date.now() - Date.parse(current.updatedAt) > 30_000,
  };
}

export function setSingleplayerSetupProgress(
  patch: Partial<Omit<SingleplayerSetupProgress, "updatedAt" | "stalled">>
): void {
  const root = globalThis as GlobalStore;
  root[STORE] = { ...state(), ...patch, updatedAt: new Date().toISOString(), stalled: false };
}

export function noteSingleplayerSetupWork(detail: string): void {
  const current = state();
  const ceiling =
    current.phase === "clearing" ? 18 : current.phase === "building" ? 88 : current.progress;
  setSingleplayerSetupProgress({
    detail,
    progress: Math.min(ceiling, current.progress + (current.phase === "building" ? 0.65 : 1)),
  });
}
