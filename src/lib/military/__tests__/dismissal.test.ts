import { describe, it, expect } from "vitest";
import { applyDismissal } from "../dismissal";
import type { MilitaryCommand } from "../types";
import type { ConflictAssignment } from "../assignments";

const cmd = (over: Partial<MilitaryCommand> = {}): MilitaryCommand =>
  ({
    id: "cmd1",
    name: "US Defense",
    type: "REGIONAL",
    commanderIds: ["g1", "g2"],
    commandingGeneralId: "g1",
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
  }) as MilitaryCommand;

const post = (over: Partial<ConflictAssignment> = {}): ConflictAssignment => ({
  theaterId: "afghan",
  generalCharacterId: "g1",
  inCharge: false,
  ...over,
});

describe("applyDismissal", () => {
  it("drops the general from their command's roster", () => {
    const { commands } = applyDismissal([cmd()], [], "g2");
    expect(commands[0].commanderIds).toEqual(["g1"]);
  });

  // A command whose lead is not one of its members violates the commands route's own
  // invariant, so dismissing a CG must clear the lead in the same operation.
  it("clears the commanding general when the dismissed general led the command", () => {
    const { commands } = applyDismissal([cmd()], [], "g1");
    expect(commands[0].commanderIds).toEqual(["g2"]);
    expect(commands[0].commandingGeneralId).toBeNull();
  });

  it("leaves another command's lead alone", () => {
    const { commands } = applyDismissal(
      [
        cmd({ id: "cmd1", commanderIds: ["g1"], commandingGeneralId: "g1" }),
        cmd({ id: "cmd2", commanderIds: ["g3"], commandingGeneralId: "g3" }),
      ],
      [],
      "g1"
    );
    expect(commands[1].commandingGeneralId).toBe("g3");
    expect(commands[1].commanderIds).toEqual(["g3"]);
  });

  it("drops every posting held by the dismissed general", () => {
    const { assignments } = applyDismissal(
      [cmd()],
      [
        post({ generalCharacterId: "g1", theaterId: "afghan" }),
        post({ generalCharacterId: "g1", theaterId: "angola" }),
        post({ generalCharacterId: "g2" }),
      ],
      "g1"
    );
    expect(assignments).toHaveLength(1);
    expect(assignments[0].generalCharacterId).toBe("g2");
  });

  // Dismissing a Theater Commander vacates that front. Authority falls back to the
  // defense holder (canActAtTheater handles a theater with no TC), so it is never
  // orphaned — but the front genuinely loses its commander.
  it("vacates the front when the dismissed general was its theater commander", () => {
    const { assignments } = applyDismissal(
      [cmd()],
      [post({ generalCharacterId: "g1", inCharge: true }), post({ generalCharacterId: "g2" })],
      "g1"
    );
    expect(assignments.some((a) => a.inCharge)).toBe(false);
    expect(assignments).toHaveLength(1);
  });

  it("does not promote anyone else into the vacated command", () => {
    const { assignments } = applyDismissal(
      [cmd()],
      [
        post({ generalCharacterId: "g1", inCharge: true }),
        post({ generalCharacterId: "g2", inCharge: false }),
      ],
      "g1"
    );
    expect(assignments[0].inCharge).toBe(false);
  });

  it("is a no-op for a character who holds nothing", () => {
    const commands = [cmd()];
    const assignments = [post()];
    const out = applyDismissal(commands, assignments, "nobody");
    expect(out.commands).toEqual(commands);
    expect(out.assignments).toEqual(assignments);
  });

  it("does not mutate its inputs", () => {
    const commands = [cmd()];
    const assignments = [post({ generalCharacterId: "g1" })];
    applyDismissal(commands, assignments, "g1");
    expect(commands[0].commanderIds).toEqual(["g1", "g2"]);
    expect(assignments).toHaveLength(1);
  });
});
