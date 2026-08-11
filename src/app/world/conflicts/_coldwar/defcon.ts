import { usePersistedNumber } from "./persisted";

/** DEFCON readout color: critical red (≤2), safe green (≥5), elevated amber otherwise. */
export function defconColor(d: number): string {
  return d <= 2 ? "#ff5a3c" : d >= 5 ? "#86d978" : "#ff7849";
}

/** Shared DEFCON level (1–5, default 3), persisted across every Cold War page. */
export function useDefcon(): number {
  return usePersistedNumber("ahd_defcon", 3, 1, 5)[0];
}

/** `[defcon, setDefcon]` for pages that can change readiness (e.g. commit escalation). */
export function useDefconState(): [number, (v: number) => void] {
  return usePersistedNumber("ahd_defcon", 3, 1, 5);
}
