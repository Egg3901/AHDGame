// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ObjectId } from "mongodb";
import type { MilitaryCommand } from "@/lib/military/types";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
// The tab renders GeneralCorps, which reaches for the app router on mount.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { CommandsTab } from "./CommandsTab";

beforeEach(() => vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true })));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const command = {
  id: "cmd-1",
  name: "Central Command",
  type: "REGIONAL",
  commanderIds: ["char_9"],
  regionIds: ["cas"],
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
} as unknown as MilitaryCommand;

const unit = {
  _id: new ObjectId(),
  countryId: "US",
  branchId: "army",
  domain: "ground",
  name: "1st Armored Division",
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
  theaterId: "afghan",
  assignedGeneralId: "char_9",
  createdTurn: 1,
} as unknown as MilitaryUnit;

const props = {
  commands: [command],
  units: [unit],
  commanders: [{ id: "char_9", name: "Gen. Real", spec: "armor", level: 2, fit: 70 }],
  conflictAssignments: [{ theaterId: "afghan", generalCharacterId: "char_9", inCharge: false }],
  corps: [],
  commissionCandidates: [],
  regionThreats: { cas: "Severe" as const },
  conflicts: [{ id: "afghan", name: "Central Asian Front" }],
  countryCode: "us",
  positionId: "secretary_of_defense",
};

// The tab is the only thing between the briefing payload and the command builder, and
// it was dropping the conflict list on the floor: the builder already accepted it and
// its own tests already passed it, so nothing caught that the real caller never did.
// The seat could not post a single general to a war.
describe("CommandsTab", () => {
  it("links the defense office to naval and air command", () => {
    render(<CommandsTab {...props} />);

    expect(
      screen.getByRole("link", { name: "Open naval and air command" }).getAttribute("href")
    ).toBe("/country/us/navair");
  });

  it("offers the live conflicts as posting options", () => {
    render(<CommandsTab {...props} />);

    const posting = screen.getByLabelText("Post Gen. Real to a conflict") as HTMLSelectElement;
    expect([...posting.options].map((o) => o.textContent)).toContain("Central Asian Front");
  });

  it("names the conflict a general is posted to instead of printing its id", () => {
    render(<CommandsTab {...props} />);

    expect(screen.getAllByText("Central Asian Front").length).toBeGreaterThan(0);
    expect(screen.queryByText("afghan")).toBeNull();
  });
});
