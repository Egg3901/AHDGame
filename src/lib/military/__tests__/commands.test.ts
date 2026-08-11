import { describe, it, expect } from "vitest";
import { createCommand, dedupeCommandIds, validateDraft, type CommandDraft } from "../commands";
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
  it("warns when an assigned region is already owned by another command", () => {
    const draft: CommandDraft = {
      name: "X",
      type: "REGIONAL",
      regionIds: ["mea"],
      commanderIds: ["hale"],
      commandingGeneralId: null,
      posture: "Deterrence",
      supply: "Normal",
    };
    const w = validateDraft(draft, stateWith([cmd({ regionIds: ["mea"] })]));
    expect(w.some((m) => m.includes("already assigned"))).toBe(true);
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
});
