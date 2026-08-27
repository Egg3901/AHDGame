// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { CombatState } from "../useCombatState";
import type { NatMods } from "@/lib/military/doctrineTree";
import { DoctrineCommand } from "./DoctrineCommand";

afterEach(cleanup);

// Only the three fields this panel actually reads, cast the way the sibling
// war-room test does — a full CombatState would be fixture for its own sake.
const state = {
  conflictAssignments: [
    { theaterId: "war_us_dd_415", generalCharacterId: "char_9", inCharge: false },
  ],
  generalsById: { char_9: { name: "Gen. Real", level: 2 } },
  conflicts: [{ id: "war_us_dd_415", name: "The War for Germany" }],
} as unknown as CombatState;

const natMods = {
  cvAll: 1,
  cvDom: {},
  cvTrait: {},
  joint: 1,
  supply: 0,
  upkeep: 1,
  xp: 1,
  deep: 0,
} as unknown as NatMods;

describe("DoctrineCommand", () => {
  // The posting line under each general was printing the conflict's internal id,
  // which is what a player saw: a chip reading `war_us_dd_415`.
  it("names the conflict a general is posted to", () => {
    render(<DoctrineCommand state={state} natMods={natMods} />);

    expect(screen.getByText(/The War for Germany/)).toBeTruthy();
    expect(screen.queryByText(/war_us_dd_415/)).toBeNull();
  });
});
