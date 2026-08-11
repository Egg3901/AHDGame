// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useCombatState, combatReducer, type CombatState, type CombatSeed } from "./useCombatState";

const seed = {
  units: [],
  conflictAssignments: [],
  generalsById: {},
  positions: {},
  pendingDeclarations: [],
  reports: [],
  conflicts: [],
  currentTurn: 40,
  country: "US",
  countryCode: "us",
  positionId: "secretary_of_defense",
} as unknown as CombatSeed;

afterEach(() => vi.unstubAllGlobals());

describe("useCombatState optimistic writes", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("rolls back a refused offensive and surfaces the server's reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({ ok: false, json: async () => ({ error: "No units at that front" }) })
    );
    const { result } = renderHook(() => useCombatState(seed));

    act(() => {
      result.current.dispatch({ type: "DECLARE", theaterId: "t1", targetCountry: "CN" });
    });
    // Optimistic: the order shows immediately…
    expect(result.current.state.pendingDeclarations).toHaveLength(1);

    // …then the refusal undoes it rather than leaving a phantom offensive.
    await waitFor(() => expect(result.current.state.refusal).toBe("No units at that front"));
    expect(result.current.state.pendingDeclarations).toHaveLength(0);
  });

  it("keeps an accepted offensive and files no refusal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const { result } = renderHook(() => useCombatState(seed));

    act(() => {
      result.current.dispatch({ type: "DECLARE", theaterId: "t1", targetCountry: "CN" });
    });
    await waitFor(() => expect(result.current.state.pendingDeclarations).toHaveLength(1));
    expect(result.current.state.refusal).toBeNull();
  });

  it("rolls back a refused withdrawal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    const withPending = {
      ...seed,
      pendingDeclarations: [{ theaterId: "t1", targetCountry: "CN", declaredTurn: 39 }],
    } as unknown as CombatSeed;
    const { result } = renderHook(() => useCombatState(withPending));

    act(() => {
      result.current.dispatch({ type: "WITHDRAW_DECLARATION", theaterId: "t1" });
    });
    expect(result.current.state.pendingDeclarations).toHaveLength(0);

    // Falls back to a generic reason when the body carries none.
    await waitFor(() => expect(result.current.state.refusal).toMatch(/withdrawal was refused/i));
    expect(result.current.state.pendingDeclarations).toHaveLength(1);
  });
});

describe("combatReducer ROLLBACK", () => {
  it("restores the patched slice and records the message", () => {
    const state = {
      pendingDeclarations: [{ theaterId: "t1", targetCountry: "CN", declaredTurn: 40 }],
      refusal: null,
    } as unknown as CombatState;
    const next = combatReducer(state, {
      type: "ROLLBACK",
      patch: { pendingDeclarations: [] },
      message: "nope",
    });
    expect(next.pendingDeclarations).toEqual([]);
    expect(next.refusal).toBe("nope");
  });
});
