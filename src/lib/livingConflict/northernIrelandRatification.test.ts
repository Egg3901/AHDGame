import { describe, expect, it } from "vitest";
import type { Bill } from "@/lib/db/types";
import type { LivingConflictState } from "./types";
import { northernIrelandRatificationDeltas } from "./northernIrelandRatification";

const state = {
  defKey: "northern_ireland",
  hasOpened: true,
  status: "settled",
  phaseLevel: 5,
  intensity: 20,
  openedYear: 1991,
  pressure: { a: 0, b: 0 },
  tracks: { ratificationAuthorization: 0 },
  phaseTurns: 0,
  totalTurns: 200,
  updatedAt: new Date(0),
} satisfies LivingConflictState;

describe("Northern Ireland ratification reconciliation", () => {
  it("requires successful authorization from both parliaments", () => {
    const deltas = northernIrelandRatificationDeltas(
      [
        { countryId: "UK", status: "signed" },
        { countryId: "IE", status: "signed" },
      ] as Bill[],
      state
    );
    expect(deltas.ratificationAuthorization).toBe(2);
    expect(deltas.ratificationFailureCount).toBe(0);
  });

  it("does not count introduction or an active vote as ratification", () => {
    const deltas = northernIrelandRatificationDeltas(
      [
        { countryId: "UK", status: "active" },
        { countryId: "IE", status: "enrolled" },
      ] as Bill[],
      state
    );
    expect(deltas.ratificationAuthorization).toBe(0);
  });

  it("damages momentum when either parliament rejects its bill", () => {
    const deltas = northernIrelandRatificationDeltas(
      [
        { countryId: "UK", status: "failed" },
        { countryId: "IE", status: "signed" },
      ] as Bill[],
      state
    );
    expect(deltas).toMatchObject({
      ratificationAuthorization: 1,
      ratificationFailureCount: 1,
      settlementMomentum: -4,
      legitimacy: -3,
    });
  });

  it("is idempotent after both authorizations have been recorded", () => {
    const deltas = northernIrelandRatificationDeltas(
      [
        { countryId: "UK", status: "signed" },
        { countryId: "IE", status: "signed" },
      ] as Bill[],
      { ...state, tracks: { ratificationAuthorization: 2 } }
    );
    expect(deltas).toEqual({ ratificationAuthorization: 0, ratificationFailureCount: 0 });
  });

  it("does not apply rejection damage twice", () => {
    const deltas = northernIrelandRatificationDeltas(
      [{ countryId: "UK", status: "failed" }] as Bill[],
      { ...state, tracks: { ratificationAuthorization: 0, ratificationFailureCount: 1 } }
    );
    expect(deltas).toEqual({ ratificationAuthorization: 0, ratificationFailureCount: 0 });
  });
});
