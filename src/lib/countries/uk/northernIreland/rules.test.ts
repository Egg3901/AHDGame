import { describe, expect, it } from "vitest";
import { emptyConflictState } from "@/lib/livingConflict/engine";
import { initialUKDevolutionState } from "../devolution/rules";
import {
  northernIrelandPoliticalEffects,
  northernIrelandSecurityCost,
  reconcileNorthernIrelandInstitution,
} from "./rules";

const conflict = {
  ...emptyConflictState("northern_ireland"),
  hasOpened: true,
  phaseLevel: 1,
  status: "active" as const,
  tracks: { violence: 70, legitimacy: 35 },
};
const settled = {
  ...conflict,
  phaseLevel: 6,
  status: "settled" as const,
  tracks: { violence: 10, legitimacy: 80, ratificationAuthorization: 2, referendumRatification: 1 },
};
const reconcile = (
  state: ReturnType<typeof initialUKDevolutionState>,
  signal = conflict,
  turn = 100
) => reconcileNorthernIrelandInstitution(state, signal, turn, 3, 48, 5, 48);

describe("Northern Ireland institutions and regional consequences", () => {
  it("does not establish an executive from a paper agreement or a single leader", () => {
    const state = reconcile(initialUKDevolutionState(1991), { ...conflict, phaseLevel: 5 });
    expect(state.regions.NIR.active).toBe(false);
    expect(state.regions.SCO.active).toBe(false);
  });
  it("anchors genuine elections after ratification and preserves the anchor on retries", () => {
    const initial = initialUKDevolutionState(1991);
    const next = reconcileNorthernIrelandInstitution(initial, settled, 100, 3, 48, 5, 48);
    expect(next.regions.NIR).toEqual({ active: true, firstCycle: 4, firstElectionEndTurn: 148 });
    expect(next.northernIrelandPeace?.assemblyFirstCycle).toBe(6);
    expect(next.regions.SCO).toEqual(initial.regions.SCO);
    expect(reconcileNorthernIrelandInstitution(next, settled, 101, 4, 48, 6, 48)).toBe(next);
    expect(initial.regions.NIR.active).toBe(false);
  });
  it("suspends authority and restores a new cycle without assigning a winner", () => {
    const active = reconcileNorthernIrelandInstitution(
      initialUKDevolutionState(1991),
      settled,
      100,
      0,
      48,
      0,
      48
    );
    const suspended = reconcileNorthernIrelandInstitution(
      active,
      { ...conflict, phaseLevel: 7, status: "negotiating" },
      200,
      1,
      48,
      1,
      48
    );
    expect(suspended.regions.NIR.active).toBe(false);
    const restored = reconcileNorthernIrelandInstitution(suspended, settled, 300, 1, 48, 1, 48);
    expect(restored.regions.NIR).toEqual({
      active: true,
      firstCycle: 2,
      firstElectionEndTurn: 348,
    });
  });
  it("scales security costs to regional GDP and violence without compounding or changing debt", () => {
    expect(northernIrelandSecurityCost(conflict, 10_000_000_000)).toBe(140_000_000);
    expect(northernIrelandSecurityCost(settled, 10_000_000_000)).toBe(20_000_000);
    expect(northernIrelandSecurityCost({ ...conflict, status: "closed" }, 10_000_000_000)).toBe(0);
    expect(northernIrelandSecurityCost(conflict, NaN)).toBe(0);
  });
  it("makes safety, autonomy and legitimacy recover with settlement and fall with suspension", () => {
    const war = northernIrelandPoliticalEffects(conflict);
    const peace = northernIrelandPoliticalEffects(settled);
    const suspended = northernIrelandPoliticalEffects({
      ...settled,
      phaseLevel: 7,
      status: "negotiating",
    });
    expect(peace["order.safety"]).toBeGreaterThan(war["order.safety"]!);
    expect(peace["governance.participation"]).toBeGreaterThan(war["governance.participation"]!);
    expect(suspended["governance.localAutonomy"]).toBe(-4);
    expect(northernIrelandPoliticalEffects({ ...settled, status: "closed" })).toEqual({});
  });
});
