// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { MilitaryCommand, CommanderRef } from "@/lib/military/types";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import { CommandingGeneralClient } from "./CommandingGeneralClient";

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const command: MilitaryCommand = {
  id: "cmd1",
  name: "US Defense",
  type: "REGIONAL",
  commanderIds: ["g1", "g2"],
  commandingGeneralId: "g1",
  regionIds: ["noa"],
  spec: "Regional Command",
  posture: "Deterrence",
  supply: "Normal",
  readiness: "Peacetime",
  cap: 20,
  base: 60,
  political: "Medium",
  branchFocus: "Combined",
  unitIds: ["u1"],
  role: "Continental defence of North America.",
};

const generals: CommanderRef[] = [
  { id: "g1", name: "Gen. Alpha", spec: "armor", level: 3, fit: 74 },
  { id: "g2", name: "Gen. Bravo", spec: "armor", level: 1, fit: 58 },
];

const units = [
  { _id: "u1", name: "1st Armored Division", theaterId: "afghan", assignedGeneralId: "g2" },
] as unknown as MilitaryUnit[];

const base = {
  countryCode: "us",
  command,
  generals,
  units,
  conflictAssignments: [],
  conflicts: [{ id: "afghan", name: "Central Asian Front" }],
};

/**
 * The postings surface alone. The structure panel above it lists the same
 * generals and units as a roster, so a page-wide query now finds both.
 */
function postings() {
  return within(screen.getByRole("region", { name: "Postings" }));
}

/** The last conflictAssignments body sent to the CG route. */
function lastSent() {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return JSON.parse(call[1].body as string).conflictAssignments;
}

describe("CommandingGeneralClient", () => {
  it("lists the command's generals", () => {
    render(<CommandingGeneralClient {...base} />);
    expect(postings().getByText("Gen. Alpha")).toBeTruthy();
    expect(postings().getByText("Gen. Bravo")).toBeTruthy();
  });

  it("posts a general to a conflict and saves it", async () => {
    render(<CommandingGeneralClient {...base} />);
    fireEvent.change(screen.getByRole("combobox", { name: /post gen\. bravo to a conflict/i }), {
      target: { value: "afghan" },
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/country/us/general/assignments");
    expect(lastSent()).toEqual([
      { theaterId: "afghan", generalCharacterId: "g2", inCharge: false },
    ]);
  });

  it("designates a theater commander", async () => {
    render(
      <CommandingGeneralClient
        {...base}
        conflictAssignments={[{ theaterId: "afghan", generalCharacterId: "g2", inCharge: false }]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /put gen\. bravo in charge/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(lastSent()[0].inCharge).toBe(true);
    expect(screen.getByText(/THEATER COMMANDER/)).toBeTruthy();
  });

  it("only one general is in charge of a front at a time", async () => {
    render(
      <CommandingGeneralClient
        {...base}
        conflictAssignments={[
          { theaterId: "afghan", generalCharacterId: "g1", inCharge: true },
          { theaterId: "afghan", generalCharacterId: "g2", inCharge: false },
        ]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /put gen\. bravo in charge/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const sent = lastSent() as { generalCharacterId: string; inCharge: boolean }[];
    expect(sent.filter((a) => a.inCharge).map((a) => a.generalCharacterId)).toEqual(["g2"]);
  });

  // A general's force is derived from unit.assignedGeneralId (SecDef-owned) and shown
  // read-only here — the CG posts generals, it does not pick units.
  it("shows the general's assigned force at their posting, read-only", () => {
    render(
      <CommandingGeneralClient
        {...base}
        conflictAssignments={[{ theaterId: "afghan", generalCharacterId: "g2", inCharge: false }]}
      />
    );
    // u1 is assigned to g2, who is posted to afghan, so it appears in g2's force…
    expect(postings().getByText("1st Armored Division")).toBeTruthy();
    // …as a read-only chip, not a clickable toggle.
    expect(screen.queryByRole("button", { name: "1st Armored Division" })).toBeNull();
  });

  it("shows an empty force when no units are assigned to the general", () => {
    render(
      <CommandingGeneralClient
        {...base}
        units={[]}
        conflictAssignments={[{ theaterId: "afghan", generalCharacterId: "g2", inCharge: false }]}
      />
    );
    expect(screen.getByText(/no units assigned to this general yet/i)).toBeTruthy();
  });

  it("surfaces a rejected save instead of pretending it worked", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Only one theater commander per conflict (afghan)" }),
    });
    render(<CommandingGeneralClient {...base} />);
    fireEvent.change(screen.getByRole("combobox", { name: /post gen\. bravo to a conflict/i }), {
      target: { value: "afghan" },
    });
    await waitFor(() =>
      expect(screen.getByText(/only one theater commander per conflict/i)).toBeTruthy()
    );
  });

  it("shows an empty state when the command has no generals", () => {
    render(<CommandingGeneralClient {...base} generals={[]} />);
    expect(screen.getByText(/your command has no generals yet/i)).toBeTruthy();
  });
});

describe("the command's structure", () => {
  // The bug: the only route to a CG's own order of battle was a link into the
  // defence seat's office, which the cabinet fog-of-war gate shuts them out of.
  it("publishes the command's makeup on the CG's own page", () => {
    render(<CommandingGeneralClient {...base} />);
    const structure = within(screen.getByRole("region", { name: "Command structure and units" }));
    expect(structure.getByText("REGIONAL")).toBeTruthy();
    expect(structure.getByText("North America")).toBeTruthy();
    // Every unit in the command, whether or not its general is posted anywhere.
    expect(structure.getByText("1st Armored Division")).toBeTruthy();
  });

  it("shows the structure even when the defence office is closed to the viewer", () => {
    render(<CommandingGeneralClient {...base} defenceOffice={null} />);
    expect(screen.getByRole("region", { name: "Command structure and units" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /office/i })).toBeNull();
  });
});

describe("linking to the defence office", () => {
  const defenceOffice = {
    href: "/country/us/executive/cabinet/secretary_of_defense/office#commands",
    seatName: "Secretary of Defense",
  };

  it("offers the office to a viewer who may open it, named for its seat", () => {
    render(<CommandingGeneralClient {...base} defenceOffice={defenceOffice} />);
    const link = screen.getByRole("link", { name: /Secretary of Defense/i });
    expect(link.getAttribute("href")).toBe(defenceOffice.href);
  });

  it("deep-links to the Commands tab, not just the office", () => {
    render(<CommandingGeneralClient {...base} defenceOffice={defenceOffice} />);
    expect(
      screen.getByRole("link", { name: /Secretary of Defense/i }).getAttribute("href")
    ).toMatch(/#commands$/);
  });

  it("offers no link when the viewer may not open that office", () => {
    // Better no link than one that answers "Office records restricted".
    render(<CommandingGeneralClient {...base} defenceOffice={null} />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("explaining what a Theater Commander does", () => {
  it("binds the TC acronym, so the button label is not two bare letters", () => {
    const { container } = render(<CommandingGeneralClient {...base} />);
    expect(container.textContent).toMatch(/Theater Commander \(TC\)/);
  });

  it("titles the MAKE TC button with what it does", () => {
    // The button only appears once a general is posted somewhere.
    render(
      <CommandingGeneralClient
        {...base}
        conflictAssignments={[{ theaterId: "afghan", generalCharacterId: "g1", inCharge: false }]}
      />
    );
    const button = screen.getByRole("button", { name: /in charge of/i });
    expect(button.getAttribute("title")).toMatch(/only they may declare offensives/i);
  });

  it("says naming a TC takes declare authority from the Secretary of Defense", () => {
    // canActAtTheater locks the front to the TC once one exists — the defence
    // holder is refused. Choosing without knowing that is choosing blind.
    const { container } = render(<CommandingGeneralClient {...base} />);
    expect(container.textContent).toMatch(/only the tc may declare offensives/i);
    expect(container.textContent).toMatch(/out of the Secretary of Defense/i);
  });

  it("states the front-wide bonus from the constant, not a hardcoded number", async () => {
    const { THEATER_COMMAND } = await import("@/lib/military/config");
    const { container } = render(<CommandingGeneralClient {...base} />);
    expect(container.textContent).toMatch(
      new RegExp(`${Math.round(THEATER_COMMAND.bonusShare * 100)}% of the edge`)
    );
  });

  it("tells the player which general to pick", () => {
    const { container } = render(<CommandingGeneralClient {...base} />);
    expect(container.textContent).toMatch(/strongest trait set/i);
  });
});
