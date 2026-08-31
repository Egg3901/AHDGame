import { describe, it, expect } from "vitest";
import { unitsForCommandPage } from "./commandForce";

interface Row {
  id: string;
  assignedGeneralId: string | null;
}

const idOf = (u: Row) => u.id;
const command = { unitIds: ["u1", "u2"], commanderIds: ["g1", "g2"] };

describe("unitsForCommandPage", () => {
  it("keeps the command's own establishment", () => {
    const units: Row[] = [
      { id: "u1", assignedGeneralId: null },
      { id: "u2", assignedGeneralId: "g1" },
    ];
    expect(unitsForCommandPage(units, idOf, command).map(idOf)).toEqual(["u1", "u2"]);
  });

  // Live data really does this: a unit sits in one command's unitIds while being
  // assigned to a general in another. theaterOfUnit reads the general alone, so
  // the unit still travels to this command's front.
  it("keeps a unit that travels with one of this command's generals", () => {
    const units: Row[] = [{ id: "u9", assignedGeneralId: "g2" }];
    expect(unitsForCommandPage(units, idOf, command).map(idOf)).toEqual(["u9"]);
  });

  it("drops a unit that is neither in the command nor led by its generals", () => {
    const units: Row[] = [
      { id: "u9", assignedGeneralId: "gX" },
      { id: "u8", assignedGeneralId: null },
    ];
    expect(unitsForCommandPage(units, idOf, command)).toEqual([]);
  });

  it("never counts a unit twice when it is both in the command and led by it", () => {
    const units: Row[] = [{ id: "u1", assignedGeneralId: "g1" }];
    expect(unitsForCommandPage(units, idOf, command)).toHaveLength(1);
  });

  // `null === null` would sweep in every unassigned unit in the country if the
  // command happened to carry a null in its commander list.
  it("does not match an unassigned unit against a null commander id", () => {
    const units: Row[] = [{ id: "u9", assignedGeneralId: null }];
    const odd = { unitIds: [], commanderIds: [null as unknown as string] };
    expect(unitsForCommandPage(units, idOf, odd)).toEqual([]);
  });
});
