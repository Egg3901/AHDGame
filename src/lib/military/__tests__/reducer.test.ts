import { describe, it, expect } from "vitest";
import { militaryReducer } from "../reducer";
import type { MilitaryCommand, MilitaryState } from "../types";

function cmd(over: Partial<MilitaryCommand> = {}): MilitaryCommand {
  return {
    id: "a",
    name: "A Command",
    type: "REGIONAL",
    commanderIds: [],
    commandingGeneralId: null,
    regionIds: [],
    spec: "Joint Operations",
    posture: "Deterrence",
    supply: "High",
    readiness: "Alert",
    cap: 20,
    base: 80,
    political: "Low",
    branchFocus: "Army",
    unitIds: [],
    role: "role",
    ...over,
  };
}

function state(
  commands: MilitaryCommand[],
  selectedId: string | null = commands[0]?.id ?? null
): MilitaryState {
  return { commands, selectedId, selectedRegionId: null, filter: "coverage", assignMode: false };
}

describe("military reducer — regions", () => {
  it("enforces the 3-region cap on assignment", () => {
    const s = state([cmd({ id: "a", regionIds: ["noa", "cac", "weu"] })]);
    const next = militaryReducer(s, { type: "TOGGLE_REGION", commandId: "a", regionId: "sam" });
    expect(next.commands[0].regionIds).not.toContain("sam");
  });
  it("toggles a region off when already assigned, on when not", () => {
    let s = state([cmd({ id: "a", regionIds: ["mea"] })]);
    s = militaryReducer(s, { type: "TOGGLE_REGION", commandId: "a", regionId: "mea" });
    expect(s.commands[0].regionIds).not.toContain("mea");
    s = militaryReducer(s, { type: "TOGGLE_REGION", commandId: "a", regionId: "mea" });
    expect(s.commands[0].regionIds).toContain("mea");
  });
  it("removes a region", () => {
    const s = state([cmd({ id: "a", regionIds: ["mea", "naf"] })]);
    const next = militaryReducer(s, { type: "REMOVE_REGION", commandId: "a", regionId: "mea" });
    expect(next.commands[0].regionIds).not.toContain("mea");
  });
  it("opens and closes the region popover", () => {
    let s = state([cmd()]);
    s = militaryReducer(s, { type: "CLICK_REGION", regionId: "noa" });
    expect(s.selectedRegionId).toBe("noa");
    s = militaryReducer(s, { type: "CLOSE_REGION" });
    expect(s.selectedRegionId).toBeNull();
  });
});

describe("military reducer — commanders", () => {
  it("adds a commander without duplicating", () => {
    let s = state([cmd({ id: "a" })]);
    s = militaryReducer(s, { type: "ADD_COMMANDER", commandId: "a", commanderId: "hale" });
    expect(s.commands[0].commanderIds).toContain("hale");
    s = militaryReducer(s, { type: "ADD_COMMANDER", commandId: "a", commanderId: "hale" });
    expect(s.commands[0].commanderIds.filter((x) => x === "hale")).toHaveLength(1);
  });
});

describe("military reducer — units", () => {
  it("ASSIGN_UNIT adds a unit and pulls it from any prior command", () => {
    const s = state([cmd({ id: "a", unitIds: ["u1"] }), cmd({ id: "b", unitIds: [] })]);
    const next = militaryReducer(s, { type: "ASSIGN_UNIT", commandId: "b", unitId: "u1" });
    expect(next.commands.find((c) => c.id === "b")!.unitIds).toContain("u1");
    expect(next.commands.find((c) => c.id === "a")!.unitIds).not.toContain("u1");
  });
  it("ASSIGN_UNIT does not duplicate within the same command", () => {
    const s = state([cmd({ id: "a", unitIds: ["u1"] })]);
    const next = militaryReducer(s, { type: "ASSIGN_UNIT", commandId: "a", unitId: "u1" });
    expect(next.commands[0].unitIds).toEqual(["u1"]);
  });
  it("UNASSIGN_UNIT removes a unit", () => {
    const s = state([cmd({ id: "a", unitIds: ["u1", "u2"] })]);
    const next = militaryReducer(s, { type: "UNASSIGN_UNIT", commandId: "a", unitId: "u1" });
    expect(next.commands[0].unitIds).toEqual(["u2"]);
  });
});

describe("military reducer — lifecycle", () => {
  it("stands a command down and reselects", () => {
    const s = state([cmd({ id: "a" }), cmd({ id: "b" })], "a");
    const next = militaryReducer(s, { type: "STAND_DOWN", commandId: "a" });
    expect(next.commands.find((c) => c.id === "a")).toBeUndefined();
    expect(next.selectedId).not.toBe("a");
  });
  it("creates a command from a draft and moves chosen commanders out of prior commands", () => {
    const s = state([cmd({ id: "a", commanderIds: ["hale"] })]);
    const next = militaryReducer(s, {
      type: "CREATE_COMMAND",
      draft: {
        name: "Southern Command",
        type: "REGIONAL",
        regionIds: ["sam"],
        commanderIds: ["hale"],
        commandingGeneralId: null,
        posture: "Deterrence",
        supply: "Normal",
      },
    });
    const created = next.commands.find((c) => c.name === "Southern Command")!;
    expect(created).toBeDefined();
    expect(created.unitIds).toEqual([]);
    expect(next.selectedId).toBe(created.id);
    expect(next.commands.find((c) => c.id === "a")!.commanderIds).not.toContain("hale");
  });
  it("auto-assigns uncovered regions to under-loaded regional commands", () => {
    const s = state([cmd({ id: "a", type: "REGIONAL", regionIds: [] })]);
    const next = militaryReducer(s, { type: "AUTO_ASSIGN" });
    expect(next.commands[0].regionIds.length).toBeGreaterThan(0);
  });
});

describe("military reducer — commanding general", () => {
  it("promotes a member of the command to CG", () => {
    const s = state([cmd({ id: "a", commanderIds: ["g1", "g2"], commandingGeneralId: null })]);
    const next = militaryReducer(s, {
      type: "SET_COMMANDING_GENERAL",
      commandId: "a",
      commanderId: "g2",
    });
    expect(next.commands[0].commandingGeneralId).toBe("g2");
  });

  it("refuses to promote a general who is not in the command", () => {
    const s = state([cmd({ id: "a", commanderIds: ["g1"], commandingGeneralId: null })]);
    const next = militaryReducer(s, {
      type: "SET_COMMANDING_GENERAL",
      commandId: "a",
      commanderId: "zz",
    });
    expect(next.commands[0].commandingGeneralId).toBeNull();
  });

  it("refuses to promote a general who already leads ANOTHER command", () => {
    // One command per CG. The CG's page resolves their command by first match, so a
    // general leading two could operate only one — the other command's generals
    // would be unpostable and its units would never reach a front.
    const s = state([
      cmd({ id: "a", commanderIds: ["g1"], commandingGeneralId: "g1" }),
      cmd({ id: "b", commanderIds: ["g1"], commandingGeneralId: null }),
    ]);
    const next = militaryReducer(s, {
      type: "SET_COMMANDING_GENERAL",
      commandId: "b",
      commanderId: "g1",
    });
    expect(next.commands[1].commandingGeneralId).toBeNull();
    // and the original lead is untouched
    expect(next.commands[0].commandingGeneralId).toBe("g1");
  });

  it("still lets a command re-promote its OWN existing lead", () => {
    // The guard must exclude the command being edited, or setting the lead to the
    // general who already holds it would be refused as a duplicate of itself.
    const s = state([cmd({ id: "a", commanderIds: ["g1"], commandingGeneralId: "g1" })]);
    const next = militaryReducer(s, {
      type: "SET_COMMANDING_GENERAL",
      commandId: "a",
      commanderId: "g1",
    });
    expect(next.commands[0].commandingGeneralId).toBe("g1");
  });

  it("lets a general lead one command while merely serving in another", () => {
    // Sitting on two rosters is fine; only the lead is constrained.
    const s = state([
      cmd({ id: "a", commanderIds: ["g1"], commandingGeneralId: null }),
      cmd({ id: "b", commanderIds: ["g1"], commandingGeneralId: null }),
    ]);
    const next = militaryReducer(s, {
      type: "SET_COMMANDING_GENERAL",
      commandId: "a",
      commanderId: "g1",
    });
    expect(next.commands[0].commandingGeneralId).toBe("g1");
    expect(next.commands[1].commanderIds).toContain("g1");
  });

  it("clears the CG when set to null", () => {
    const s = state([cmd({ id: "a", commanderIds: ["g1"], commandingGeneralId: "g1" })]);
    const next = militaryReducer(s, {
      type: "SET_COMMANDING_GENERAL",
      commandId: "a",
      commanderId: null,
    });
    expect(next.commands[0].commandingGeneralId).toBeNull();
  });

  it("clears the CG when that general is removed from the command", () => {
    const s = state([cmd({ id: "a", commanderIds: ["g1", "g2"], commandingGeneralId: "g2" })]);
    const next = militaryReducer(s, {
      type: "REMOVE_COMMANDER",
      commandId: "a",
      commanderId: "g2",
    });
    expect(next.commands[0].commandingGeneralId).toBeNull();
    expect(next.commands[0].commanderIds).toEqual(["g1"]);
  });

  it("clears a stale CG when a new command steals the lead general", () => {
    const s = state([cmd({ id: "a", commanderIds: ["g1"], commandingGeneralId: "g1" })]);
    const next = militaryReducer(s, {
      type: "CREATE_COMMAND",
      draft: {
        name: "New Command",
        type: "REGIONAL",
        regionIds: [],
        commanderIds: ["g1"],
        commandingGeneralId: "g1",
        posture: "Deterrence",
        supply: "Normal",
      },
    });
    expect(next.commands[0].commandingGeneralId).toBeNull();
    expect(next.commands[1].commandingGeneralId).toBe("g1");
  });
});
