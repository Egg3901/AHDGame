/**
 * Discrete tension shocks share one bounded formula across ordinary and replayed events.
 * planTensionEvent preserves the pressure floor and caps the visible event history.
 */
import type { ColdWarTensionState, TensionEventKind } from "../tension";

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value * 10) / 10));
export function planTensionEvent(
  state: ColdWarTensionState,
  turn: number,
  kind: TensionEventKind,
  label: string,
  delta: number,
  minimumValue: number | undefined,
  at: Date
): ColdWarTensionState {
  const floor = clamp(minimumValue ?? state.pressureFloor);
  const value = clamp(delta < 0 ? Math.max(floor, state.value + delta) : state.value + delta);
  return {
    ...state,
    value,
    pressureFloor: minimumValue == null ? state.pressureFloor : floor,
    events: [
      { turn, kind, label, delta: Math.round((value - state.value) * 10) / 10, at },
      ...state.events,
    ].slice(0, 24),
  };
}
