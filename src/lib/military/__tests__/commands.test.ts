import { describe, it, expect } from "vitest";
import {
  createCommand,
  dedupeCommandIds,
  needsLogisticsPairing,
  reconcileCommandCommanders,
  validateDraft,
  type CommandDraft,
} from "../commands";
import type { MilitaryCommand, MilitaryState } from "../types";

function cmd(over: Partial<MilitaryCommand> = {}): MilitaryCommand {
  return {
    id: "own",
    name: "Owner Command",
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

const stateWith = (commands: MilitaryCommand[]): MilitaryState => ({
  commands,
  selectedId: commands[0]?.id ?? null,
  selectedRegionId: null,
  filter: "coverage",
  assignMode: false,
});

describe("createCommand", () => {
  it("builds a command from a draft with derived capacity and empty units", () => {
    const draft: CommandDraft = {
      name: " Southern Command ",
      type: "REGIONAL",
      regionIds: ["sam"],
      commanderIds: [],
      commandingGeneralId: null,
      posture: "Deterrence",
      supply: "Normal",
    };
    const { command } = createCommand(draft, []);
    expect(command.name).toBe("Southern Command");
    expect(command.cap).toBe(18 + 1 * 2);
    expect(command.readiness).toBe("Forming");
    expect(command.regionIds).toEqual(["sam"]);
    expect(command.unitIds).toEqual([]);
  });

  it("assigns unique ids to successive commands", () => {
    const draft: CommandDraft = {
      name: "A",
      type: "REGIONAL",
      regionIds: [],
      commanderIds: [],
      commandingGeneralId: null,
      posture: "Deterrence",
      supply: "Normal",
    };
    // Uniqueness comes from the commands already held, which is what the reducer
    // passes. This test used to hand `[]` to both calls and still pass, because ids
    // came from a module counter — so it asserted uniqueness while proving nothing
    // about the case that actually broke.
    const a = createCommand(draft, []).command;
    const b = createCommand({ ...draft, name: "B" }, [a]).command;
    expect(a.id).not.toBe(b.id);
  });

  /**
   * The id counter reset on every page load and ignored the commands already saved,
   * so the first command created in a new session took the id the first SAVED command
   * already had. The roster highlighted both rows, the detail panel opened the older
   * one, and every commandId action edited both — then autosaved it.
   */
  it("does not reuse an id already held by a persisted command", () => {
    const draft: CommandDraft = {
      name: "Third Command",
      type: "REGIONAL",
      regionIds: [],
      commanderIds: [],
      commandingGeneralId: null,
      posture: "Deterrence",
      supply: "Normal",
    };
    // A fresh page load holding two commands saved in an earlier session.
    const existing = [{ id: "cmd1" }, { id: "cmd2" }] as MilitaryCommand[];
    const { command } = createCommand(draft, existing);
    expect(existing.map((c) => c.id)).not.toContain(command.id);
  });

  it("steps past ids that do not follow the cmdN shape", () => {
    const draft: CommandDraft = {
      name: "X",
      type: "REGIONAL",
      regionIds: [],
      commanderIds: [],
      commandingGeneralId: null,
      posture: "Deterrence",
      supply: "Normal",
    };
    const existing = [{ id: "cmd1" }, { id: "homeland-defense" }] as MilitaryCommand[];
    const { command } = createCommand(draft, existing);
    expect(existing.map((c) => c.id)).not.toContain(command.id);
  });
});

describe("dedupeCommandIds", () => {
  it("leaves an already-unique org untouched", () => {
    const commands = [{ id: "cmd1" }, { id: "cmd2" }] as MilitaryCommand[];
    expect(dedupeCommandIds(commands)).toBe(commands);
  });

  // Repairs orgs already saved with the collision. The FIRST holder keeps the id, so
  // the older command — the one carrying units and history — stays put.
  it("re-keys the later duplicate and keeps the first", () => {
    const commands = [
      { id: "cmd1", name: "Home Defense" },
      { id: "cmd2", name: "Northern" },
      { id: "cmd1", name: "Third Command" },
    ] as MilitaryCommand[];
    const out = dedupeCommandIds(commands);
    expect(out[0].id).toBe("cmd1");
    expect(out[0].name).toBe("Home Defense");
    expect(out[2].name).toBe("Third Command");
    expect(new Set(out.map((c) => c.id)).size).toBe(3);
  });

  it("does not hand a duplicate the id of a later command", () => {
    const commands = [
      { id: "cmd1" },
      { id: "cmd1" },
      { id: "cmd2" },
      { id: "cmd3" },
    ] as MilitaryCommand[];
    const out = dedupeCommandIds(commands);
    expect(new Set(out.map((c) => c.id)).size).toBe(4);
  });
});

describe("validateDraft", () => {
  it("warns when an assigned region is already owned by a command of the same type", () => {
    const draft: CommandDraft = {
      name: "X",
      type: "REGIONAL",
      regionIds: ["mea"],
      commanderIds: ["hale"],
      commandingGeneralId: null,
      posture: "Deterrence",
      supply: "Normal",
    };
    const w = validateDraft(draft, stateWith([cmd({ type: "REGIONAL", regionIds: ["mea"] })]));
    expect(w.some((m) => m.includes("already assigned"))).toBe(true);
  });

  // Only a same-type owner is a role conflict; overlappingRegions has always drawn the
  // line there. The warning ignored type, so pairing a Logistics command with the
  // Regional command already holding the region looked prohibited.
  it("does not warn when the region's existing owner is a different command type", () => {
    const draft: CommandDraft = {
      name: "X",
      type: "LOGISTICS",
      regionIds: ["mea"],
      commanderIds: ["hale"],
      commandingGeneralId: null,
      posture: "Expeditionary",
      supply: "Normal",
    };
    const w = validateDraft(draft, stateWith([cmd({ type: "REGIONAL", regionIds: ["mea"] })]));
    expect(w.some((m) => m.includes("already assigned"))).toBe(false);
  });

  // Mixed owners are the case the old code got wrong twice over: it warned when it
  // should not have, and `owners[0]` could name whichever command happened to sort
  // first, pointing the Secretary at a command that was not the clash.
  it("names the same-type owner when a region also holds a command of another type", () => {
    const draft: CommandDraft = {
      name: "X",
      type: "REGIONAL",
      regionIds: ["mea"],
      commanderIds: ["hale"],
      commandingGeneralId: null,
      posture: "Deterrence",
      supply: "Normal",
    };
    const w = validateDraft(
      draft,
      stateWith([
        cmd({ id: "supply", name: "Supply Corps", type: "LOGISTICS", regionIds: ["mea"] }),
        cmd({ id: "north", name: "Northern Command", type: "REGIONAL", regionIds: ["mea"] }),
      ])
    );
    const warning = w.find((m) => m.includes("already assigned"));
    expect(warning).toBeDefined();
    expect(warning).toContain("Northern Command");
    expect(warning).not.toContain("Supply Corps");
  });

  it("warns when no commander is selected", () => {
    const draft: CommandDraft = {
      name: "X",
      type: "REGIONAL",
      regionIds: [],
      commanderIds: [],
      commandingGeneralId: null,
      posture: "Deterrence",
      supply: "Normal",
    };
    expect(validateDraft(draft, stateWith([])).some((m) => m.includes("No commander"))).toBe(true);
  });

  it("warns when a sea region has no naval/logistics structure", () => {
    const draft: CommandDraft = {
      name: "X",
      type: "HOMELAND_DEFENSE",
      regionIds: ["ior"],
      commanderIds: ["ward"],
      commandingGeneralId: null,
      posture: "Air Defense",
      supply: "Normal",
    };
    expect(
      validateDraft(draft, stateWith([])).some((m) => m.includes("naval command structure"))
    ).toBe(true);
  });

  // Ticket #1244. The warning keyed on `regionIds.length >= REGION_CAP`, and REGION_CAP
  // is a hard cap the dialog and the reducer both enforce, so it fired on every full
  // non-Logistics command whatever the geography. South Asia, East Asia and Southeast
  // Asia are one theatre; sustaining them needs no separate logistics tail, and any two
  // of the three drew no warning at all.
  it("does not recommend logistics when every assigned region is in one macro theatre", () => {
    const draft: CommandDraft = {
      name: "X",
      type: "REGIONAL",
      regionIds: ["sas", "eas", "sea"],
      commanderIds: ["hale"],
      commandingGeneralId: null,
      posture: "Deterrence",
      supply: "Normal",
    };
    expect(
      validateDraft(draft, stateWith([])).some((m) => m.includes("Logistics command recommended"))
    ).toBe(false);
  });

  it("recommends logistics when the assigned regions span two macro theatres", () => {
    const draft: CommandDraft = {
      name: "X",
      type: "REGIONAL",
      regionIds: ["weu", "sas"],
      commanderIds: ["hale"],
      commandingGeneralId: null,
      posture: "Deterrence",
      supply: "Normal",
    };
    expect(
      validateDraft(draft, stateWith([])).some((m) => m.includes("Logistics command recommended"))
    ).toBe(true);
  });

  // The advice has to be reachable from the detail panel too, which holds a saved
  // MilitaryCommand rather than a draft, so the rule lives in its own predicate.
  it("does not recommend logistics to a command whose regions are all one theatre", () => {
    expect(needsLogisticsPairing("REGIONAL", ["sas", "eas", "sea"])).toBe(false);
  });

  it("recommends logistics to a command spanning two theatres", () => {
    expect(needsLogisticsPairing("REGIONAL", ["weu", "sas"])).toBe(true);
  });

  it("never recommends logistics to a Logistics command", () => {
    expect(needsLogisticsPairing("LOGISTICS", ["weu", "sas"])).toBe(false);
  });

  it("recommends nothing for a command with no regions", () => {
    expect(needsLogisticsPairing("REGIONAL", [])).toBe(false);
  });

  // A saved command can name a region the map no longer has. An unknown id contributes
  // no theatre rather than counting as its own, which would advise on a phantom spread.
  it("ignores region ids the map does not know", () => {
    expect(needsLogisticsPairing("REGIONAL", ["sas", "not-a-region"])).toBe(false);
  });

  // A Logistics command IS the sustainment structure, so it is never told to go find one.
  it("never recommends logistics to a Logistics command spanning theatres", () => {
    const draft: CommandDraft = {
      name: "X",
      type: "LOGISTICS",
      regionIds: ["weu", "sas"],
      commanderIds: ["hale"],
      commandingGeneralId: null,
      posture: "Expeditionary",
      supply: "Normal",
    };
    expect(
      validateDraft(draft, stateWith([])).some((m) => m.includes("Logistics command recommended"))
    ).toBe(false);
  });
});

/**
 * Live data really did this: Russia's only command listed a general who had since
 * moved to the United Kingdom. The panel skipped the unresolvable row, so the
 * Secretary saw "COMMANDERS - 1" over an empty list with no way to remove anyone,
 * and the commands PUT refused every later edit because of that same id.
 */
describe("reconcileCommandCommanders", () => {
  it("leaves a clean org untouched, and returns the same array", () => {
    const commands = [cmd({ commanderIds: ["g1"], commandingGeneralId: "g1" })];
    const out = reconcileCommandCommanders(commands, ["g1", "g2"]);
    expect(out.commands).toBe(commands);
    expect(out.removed).toBe(0);
  });

  it("drops a commander the country's roster no longer contains", () => {
    const commands = [cmd({ commanderIds: ["g1", "gone"] })];
    const out = reconcileCommandCommanders(commands, ["g1"]);
    expect(out.commands[0].commanderIds).toEqual(["g1"]);
    expect(out.removed).toBe(1);
  });

  // The route also requires the lead to be one of the command's own commanders, so
  // leaving a dangling lead would swap one unsavable state for another.
  it("clears the lead when the lead is who left", () => {
    const commands = [cmd({ commanderIds: ["gone"], commandingGeneralId: "gone" })];
    const out = reconcileCommandCommanders(commands, ["g1"]);
    expect(out.commands[0].commanderIds).toEqual([]);
    expect(out.commands[0].commandingGeneralId).toBeNull();
  });

  it("keeps a lead who is still on the roster while dropping a colleague", () => {
    const commands = [cmd({ commanderIds: ["g1", "gone"], commandingGeneralId: "g1" })];
    const out = reconcileCommandCommanders(commands, ["g1"]);
    expect(out.commands[0].commandingGeneralId).toBe("g1");
  });

  it("counts every dropped commander across every command", () => {
    const commands = [
      cmd({ id: "a", commanderIds: ["gone1"] }),
      cmd({ id: "b", commanderIds: ["g1", "gone2"] }),
      cmd({ id: "c", commanderIds: ["g1"] }),
    ];
    const out = reconcileCommandCommanders(commands, ["g1"]);
    expect(out.removed).toBe(2);
    expect(out.commands.map((c) => c.commanderIds)).toEqual([[], ["g1"], ["g1"]]);
  });

  // A lead who was never on the command's own list is the same unsavable state by
  // another route: the PUT requires the lead to be one of its commanders.
  it("clears a lead who is not on the command's own list, dropping nobody", () => {
    const commands = [cmd({ commanderIds: ["g1"], commandingGeneralId: "orphan" })];
    const out = reconcileCommandCommanders(commands, ["g1", "orphan"]);
    expect(out.commands[0].commanderIds).toEqual(["g1"]);
    expect(out.commands[0].commandingGeneralId).toBeNull();
    expect(out.removed).toBe(0);
  });

  it("empties every command when the roster is empty", () => {
    const commands = [cmd({ commanderIds: ["g1"], commandingGeneralId: "g1" })];
    const out = reconcileCommandCommanders(commands, []);
    expect(out.commands[0].commanderIds).toEqual([]);
    expect(out.commands[0].commandingGeneralId).toBeNull();
  });
});
