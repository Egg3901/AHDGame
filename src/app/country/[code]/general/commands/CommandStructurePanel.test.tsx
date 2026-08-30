// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { MilitaryCommand, CommanderRef } from "@/lib/military/types";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import { CommandStructurePanel } from "./CommandStructurePanel";

afterEach(cleanup);

const command = {
  id: "cmd10",
  name: "USINDCOM",
  type: "REGIONAL",
  commanderIds: ["g1", "g2"],
  commandingGeneralId: "g1",
  regionIds: ["sas"],
  spec: "Regional Command",
  posture: "Deterrence",
  supply: "Normal",
  readiness: "Forming",
  cap: 20,
  base: 60,
  political: "Medium",
  branchFocus: "Combined",
  unitIds: ["u1", "u2"],
  role: "Newly established regional command.",
} as MilitaryCommand;

const generals: CommanderRef[] = [
  { id: "g1", name: "Gen. Alpha", spec: "armor", level: 3, fit: 74 },
  { id: "g2", name: "Gen. Bravo", spec: "armor", level: 1, fit: 58 },
];

const units = [
  { _id: "u1", name: "1st Armored Division", basePower: 60, assignedGeneralId: "g2" },
  { _id: "u2", name: "7th Infantry Division", basePower: 24, assignedGeneralId: null },
] as unknown as MilitaryUnit[];

const base = { command, generals, units };

describe("CommandStructurePanel", () => {
  // The command is named by the page heading above the panel, so the panel says
  // what kind of command it is rather than repeating the name.
  it("states the command's type", () => {
    render(<CommandStructurePanel {...base} />);
    // The badge, not the label — this command's spec happens to read "Regional
    // Command" too, so matching the label alone would not prove the type rendered.
    expect(screen.getByText("REGIONAL")).toBeTruthy();
    expect(screen.queryByText("USINDCOM")).toBeNull();
  });

  it("reports the command's standing figures", () => {
    const { container } = render(<CommandStructurePanel {...base} />);
    expect(container.textContent).toMatch(/Posture/);
    expect(container.textContent).toMatch(/Deterrence/);
    expect(container.textContent).toMatch(/Readiness/);
    expect(container.textContent).toMatch(/Forming/);
    expect(container.textContent).toMatch(/Effectiveness/);
    expect(container.textContent).toMatch(/Branch focus/);
  });

  // load = round(60/12) + round(24/12) = 5 + 2 = 7, against a capacity of 20.
  it("states what the posture and type mean, not only their names", () => {
    render(<CommandStructurePanel {...base} />);
    // Deterrence
    expect(screen.getByText("+ crisis response")).toBeTruthy();
    expect(screen.getByText("+ forward presence")).toBeTruthy();
    // Regional
    expect(screen.getByText("+ balanced command")).toBeTruthy();
  });

  it("shows force load against capacity", () => {
    const { container } = render(<CommandStructurePanel {...base} />);
    expect(container.textContent).toMatch(/7\s*\/\s*20/);
  });

  it("names the regions the command is responsible for", () => {
    render(<CommandStructurePanel {...base} />);
    expect(screen.getByText("South Asia")).toBeTruthy();
  });

  it("says so when a command has no map regions rather than showing an empty list", () => {
    render(<CommandStructurePanel {...base} command={{ ...command, regionIds: [] }} />);
    expect(screen.getByText(/global scope/i)).toBeTruthy();
  });

  it("lists every unit in the command, not only those under a posted general", () => {
    const { container } = render(<CommandStructurePanel {...base} />);
    expect(screen.getByText("1st Armored Division")).toBeTruthy();
    expect(screen.getByText("7th Infantry Division")).toBeTruthy();
    // The unit's general is named, and one with none reads as General Staff.
    expect(container.textContent).toMatch(/Gen\. Bravo/);
    expect(container.textContent).toMatch(/General Staff/);
  });

  it("says the command has no units rather than rendering an empty list", () => {
    render(<CommandStructurePanel {...base} command={{ ...command, unitIds: [] }} units={[]} />);
    expect(screen.getByText(/no units assigned/i)).toBeTruthy();
  });

  // A unitId with no matching unit (deleted or withheld) must not blank the panel,
  // and must not be counted either: a heading over rows nobody can see is exactly
  // what made a command with a departed commander unreadable.
  it("skips a unit id that resolves to nothing, and does not count it", () => {
    const { container } = render(<CommandStructurePanel {...base} units={[units[0]]} />);
    expect(screen.getByText("1st Armored Division")).toBeTruthy();
    expect(screen.queryByText("7th Infantry Division")).toBeNull();
    expect(container.textContent).toMatch(/Assigned units . 1/);
  });

  it("counts only regions it can name", () => {
    const { container } = render(
      <CommandStructurePanel {...base} command={{ ...command, regionIds: ["sas", "nowhere"] }} />
    );
    expect(screen.getByText("South Asia")).toBeTruthy();
    expect(container.textContent).toMatch(/Assigned regions . 1/);
  });

  // Live data really does this: a unit in one command's unitIds assigned to a
  // general in another. Reading that as unled would be wrong.
  it("names a unit's leader even when they belong to another command", () => {
    const { container } = render(
      <CommandStructurePanel
        {...base}
        generals={[...generals, { id: "g9", name: "Gen. Delta", spec: "air", level: 2, fit: 61 }]}
        units={
          [
            { _id: "u1", name: "1st Armored Division", basePower: 60, assignedGeneralId: "g9" },
            { _id: "u2", name: "7th Infantry Division", basePower: 24, assignedGeneralId: null },
          ] as unknown as MilitaryUnit[]
        }
      />
    );
    expect(container.textContent).toMatch(/Gen\. Delta/);
  });

  it("warns when the command is over capacity", () => {
    const { container } = render(
      <CommandStructurePanel {...base} command={{ ...command, cap: 3 }} />
    );
    expect(container.textContent).toMatch(/over-capacity/i);
  });

  // Read-only by construction: the CG employs a command, the defence seat builds it.
  it("offers no controls that would edit the command", () => {
    render(<CommandStructurePanel {...base} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
  });
});
