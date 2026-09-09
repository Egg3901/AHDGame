// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { ObjectId } from "mongodb";
import type { MilitaryCommand } from "@/lib/military/types";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import { useMilitaryState, type MilitarySeed } from "./useMilitaryState";

function unit(): MilitaryUnit {
  return {
    _id: new ObjectId(),
    countryId: "US",
    branchId: "army",
    domain: "ground",
    name: "Division",
    type: "Armored Division",
    icon: "tank",
    posture: "standard",
    techTier: 1,
    personnel: 15000,
    readiness: 70,
    basePower: 92,
    upkeepBase: 180,
    vet: 1,
    xp: 0,
    equipment: { firepower: 1, protection: 1, support: 1 },
    drill: null,
    theaterId: "reserve",
    assignedGeneralId: null,
    createdTurn: 1,
  };
}
function seed(units: MilitaryUnit[], unitIds: string[]): MilitarySeed {
  const command: MilitaryCommand = {
    id: "command",
    name: "Central Command",
    type: "REGIONAL",
    commanderIds: [],
    commandingGeneralId: null,
    regionIds: ["mea"],
    spec: "Joint Operations",
    posture: "Deterrence",
    supply: "High",
    readiness: "Alert",
    cap: 20,
    base: 80,
    political: "Low",
    branchFocus: "Army",
    unitIds,
    role: "role",
  };
  return { commands: [command], units, countryCode: "us", positionId: "secretary_of_defense" };
}
const fetchMock = vi.fn().mockResolvedValue({ ok: true });
beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function save() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(601);
  });
}

describe("command roster reconciliation", () => {
  it("saves an edited command without invisible stale unit references", async () => {
    const live = unit();
    const initial = seed([live], [String(live._id), "removed-unit"]);
    const { result } = renderHook(() => useMilitaryState(initial));
    expect(result.current.state.commands[0].unitIds).toEqual([String(live._id)]);
    act(() =>
      result.current.dispatch({
        type: "SET_POSTURE",
        commandId: "command",
        posture: "Expeditionary",
      })
    );
    await save();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "/api/country/us/executive/cabinet/secretary_of_defense/commands",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          commands: [
            { ...initial.commands[0], posture: "Expeditionary", unitIds: [String(live._id)] },
          ],
        }),
      })
    );
    expect(initial.commands[0].unitIds).toEqual([String(live._id), "removed-unit"]);
  });

  it("retains local edits when the roster refreshes and saves only surviving units", async () => {
    const kept = unit();
    const removed = unit();
    const initial = seed([kept, removed], [String(kept._id), String(removed._id)]);
    const { result, rerender } = renderHook(useMilitaryState, { initialProps: initial });
    act(() =>
      result.current.dispatch({
        type: "SET_POSTURE",
        commandId: "command",
        posture: "Expeditionary",
      })
    );
    rerender({ ...initial, units: [kept] });
    expect(result.current.state.commands[0]).toMatchObject({
      posture: "Expeditionary",
      unitIds: [String(kept._id)],
      regionIds: ["mea"],
    });
    expect(result.current.state.selectedId).toBe("command");
    expect(result.current.pool).toEqual([]);
    await save();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].body).not.toContain(String(removed._id));
  });

  it("keeps read-only views read-only when the final unit disappears", async () => {
    const live = unit();
    const initial = { ...seed([live], [String(live._id)]), positionId: "" };
    const { result, rerender } = renderHook(useMilitaryState, { initialProps: initial });
    rerender({ ...initial, units: [] });
    expect(result.current.state.commands[0].unitIds).toEqual([]);
    await save();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
