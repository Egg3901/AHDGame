// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { ObjectId } from "mongodb";
import type { MilitaryCommand } from "@/lib/military/types";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import { STRATEGIC_REGIONS } from "@/lib/military/regions";
import { CommandsBuilder } from "./CommandsBuilder";

beforeEach(() => vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true })));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function command(over: Partial<MilitaryCommand> = {}): MilitaryCommand {
  return {
    id: "cmd-1",
    name: "Central Command",
    type: "REGIONAL",
    commanderIds: [],
    regionIds: ["mea"],
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
  } as MilitaryCommand;
}

function unit(): MilitaryUnit {
  return {
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
    theaterId: "reserve",
    assignedGeneralId: null,
    createdTurn: 1,
  } as unknown as MilitaryUnit;
}

const base = {
  units: [unit()],
  conflictAssignments: [],
  commanders: [{ id: "char_9", name: "Gen. Real", spec: "armor", level: 2, fit: 70 }],
  regionThreats: { cas: "Severe" as const },
  conflicts: [{ id: "afghan", name: "Central Asian Front" }],
  countryCode: "us",
  positionId: "secretary_of_defense",
};

describe("CommandsBuilder", () => {
  it("renders the summary + roster with the command", () => {
    render(<CommandsBuilder commands={[command()]} {...base} />);
    expect(screen.getByText("Commands")).toBeTruthy(); // summary tile label
    // appears in the roster and the (auto-selected) detail header
    expect(screen.getAllByText("Central Command").length).toBeGreaterThan(0);
  });

  it("shows the create control for a defense holder", () => {
    render(<CommandsBuilder commands={[]} {...base} />);
    expect(screen.getByText(/Create command/i)).toBeTruthy();
  });

  it("is read-only with no defense seat (no create control)", () => {
    render(
      <CommandsBuilder
        commands={[]}
        units={base.units}
        commanders={[]}
        conflictAssignments={[]}
        regionThreats={{}}
        countryCode="br"
        positionId=""
      />
    );
    expect(screen.queryByText(/Create command/i)).toBeNull();
  });

  it("shows the live conflict-driven threat on the region panel", () => {
    render(<CommandsBuilder commands={[command()]} {...base} />);
    // the region panel lives in the Assign-Regions modal now — open it first
    fireEvent.click(screen.getByRole("button", { name: "ASSIGN" }));
    // switch the region filter to Threat, then Central Asia (cas) reads SEVERE
    fireEvent.click(screen.getByRole("button", { name: "THREAT" }));
    expect(screen.getByText("SEVERE")).toBeTruthy();
  });

  it("shows the detail panel for the selected command with the real commander", () => {
    render(<CommandsBuilder commands={[command({ commanderIds: ["char_9"] })]} {...base} />);
    // the first command is selected by default → its detail renders
    expect(screen.getByText("Assigned forces")).toBeTruthy();
    expect(screen.getByText("Branch focus")).toBeTruthy();
    // the assigned commander is the real general (not a mock)
    expect(screen.getAllByText("Gen. Real").length).toBeGreaterThan(0);
  });

  it("opens the create-command dialog", () => {
    render(<CommandsBuilder commands={[]} {...base} />);
    fireEvent.click(screen.getByRole("button", { name: /create command/i }));
    expect(screen.getByText("New theater command")).toBeTruthy();
    expect(screen.getByPlaceholderText(/Southern Command/i)).toBeTruthy();
  });

  it("creates a command with only a name — warnings don't block Create", () => {
    render(<CommandsBuilder commands={[]} {...base} />);
    fireEvent.click(screen.getByRole("button", { name: /create command/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByPlaceholderText(/Southern Command/i), {
      target: { value: "US Defense" },
    });
    const confirm = within(dialog).getByRole("button", { name: /create command/i });
    expect(confirm.hasAttribute("disabled")).toBe(false);
    fireEvent.click(confirm);
    // the new command lands in the roster (no commander → advisory warning only)
    expect(screen.getAllByText("US Defense").length).toBeGreaterThan(0);
  });

  it("marks the commanding general in the detail panel", () => {
    render(
      <CommandsBuilder
        commands={[command({ commanderIds: ["char_9"], commandingGeneralId: "char_9" })]}
        {...base}
      />
    );
    expect(screen.getByText("CG")).toBeTruthy();
  });

  it("promotes a commander to commanding general", () => {
    render(
      <CommandsBuilder
        commands={[command({ commanderIds: ["char_9"], commandingGeneralId: null })]}
        {...base}
      />
    );
    expect(screen.queryByText("CG")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /make gen\. real commanding general/i }));
    expect(screen.getByText("CG")).toBeTruthy();
  });

  it("offers no promote control without a defense seat", () => {
    render(
      <CommandsBuilder
        commands={[command({ commanderIds: ["char_9"], commandingGeneralId: null })]}
        units={base.units}
        commanders={base.commanders}
        conflictAssignments={[]}
        regionThreats={{}}
        countryCode="br"
        positionId=""
      />
    );
    expect(screen.queryByRole("button", { name: /commanding general/i })).toBeNull();
  });

  // Posting a general to a Conflict is what makes them command anything: battle math
  // only applies a general to units at a front they are actually posted to.
  it("posts a general to a conflict", () => {
    render(<CommandsBuilder commands={[command({ commanderIds: ["char_9"] })]} {...base} />);
    fireEvent.change(screen.getByRole("combobox", { name: /post gen\. real to a conflict/i }), {
      target: { value: "afghan" },
    });
    // the posting badge names the theater (afghan → "Central Asian Front")
    expect(screen.getAllByText("Central Asian Front").length).toBeGreaterThan(0);
  });

  it("puts a posted general in charge of their conflict", () => {
    render(
      <CommandsBuilder
        commands={[command({ commanderIds: ["char_9"] })]}
        {...base}
        conflictAssignments={[
          { theaterId: "afghan", generalCharacterId: "char_9", inCharge: false },
        ]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /put gen\. real in charge/i }));
    expect(screen.getByText(/◉ TC/)).toBeTruthy();
  });

  it("offers no MAKE TC control once the general is already in charge", () => {
    render(
      <CommandsBuilder
        commands={[command({ commanderIds: ["char_9"] })]}
        {...base}
        conflictAssignments={[
          { theaterId: "afghan", generalCharacterId: "char_9", inCharge: true },
        ]}
      />
    );
    expect(screen.queryByRole("button", { name: /in charge/i })).toBeNull();
    expect(screen.getByText(/◉ TC/)).toBeTruthy();
  });

  it("offers no posting control without a defense seat", () => {
    render(
      <CommandsBuilder
        commands={[command({ commanderIds: ["char_9"] })]}
        units={base.units}
        commanders={base.commanders}
        conflictAssignments={[]}
        regionThreats={{}}
        countryCode="br"
        positionId=""
      />
    );
    expect(screen.queryByRole("combobox", { name: /post .* to a conflict/i })).toBeNull();
  });

  it("renders the region panel and inspects a region on click", () => {
    render(<CommandsBuilder commands={[command()]} {...base} />);
    // the region panel lives in the Assign-Regions modal now — open it first
    fireEvent.click(screen.getByRole("button", { name: "ASSIGN" }));
    expect(screen.getByText("Strategic regions")).toBeTruthy();
    expect(screen.getByText("COVERAGE")).toBeTruthy(); // a filter chip
    const region = STRATEGIC_REGIONS[0];
    fireEvent.click(screen.getByText(region.name));
    // the region detail panel opens (shows the Infra stat label)
    expect(screen.getByText("Infra")).toBeTruthy();
  });

  // The player-visible face of the coverage bug. A Regional command holding a region
  // while a Logistics command sustains it is the recommended overseas pairing, and the
  // default COVERAGE filter labelled it UNASSIGNED, so the builder told the Secretary
  // their correct structure was a gap. Asserted through the UI because the chip is
  // where players actually met it.
  it("shows a region held by two different command types as covered, not a gap", () => {
    render(
      <CommandsBuilder
        commands={[
          command({ id: "cmd-1", name: "Northern Command", type: "REGIONAL", regionIds: ["mea"] }),
          command({ id: "cmd-2", name: "Supply Corps", type: "LOGISTICS", regionIds: ["mea"] }),
        ]}
        {...base}
      />
    );
    // Different types are not a role conflict, so the same-type overlap banner stays away.
    expect(screen.queryByText(/with two commands of the same type/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "ASSIGN" }));
    // Scope to the assign-regions modal: the roster renders region names too.
    const dialog = screen.getByRole("dialog");
    const row = within(dialog).getByText("Middle East").closest("button");
    expect(row).toBeTruthy();
    // getByText matches exactly, so this cannot be satisfied by "UNASSIGNED".
    expect(within(row as HTMLElement).getByText("ASSIGNED")).toBeTruthy();
    expect(within(row as HTMLElement).queryByText("UNASSIGNED")).toBeNull();
  });

  // A player holding this seat asked "where do I assign more troops to the battlefield
  // as SoD?" — a question with no button, because units are never sent to a front
  // directly. This page is where the chain starts, so it is where the rule belongs.
  it("explains how units actually reach a front", () => {
    render(<CommandsBuilder commands={[command()]} {...base} />);
    expect(screen.getByText(/How your troops reach a front/i)).toBeTruthy();
    expect(screen.getByText(/wherever the general it is assigned to is posted/i)).toBeTruthy();
    expect(screen.getAllByText(/Commanding General/i).length).toBeGreaterThan(0);
  });
});

describe("posture trade-offs", () => {
  it("shows the selected posture's trade-offs in the create dialog and updates on change", () => {
    render(<CommandsBuilder commands={[]} {...base} />);
    fireEvent.click(screen.getByRole("button", { name: /create command/i }));
    const dialog = screen.getByRole("dialog");
    // the default posture is Deterrence
    expect(within(dialog).getByText("+ crisis response")).toBeTruthy();
    expect(within(dialog).getByText("+ forward presence")).toBeTruthy();
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Posture" }), {
      target: { value: "Training / Reserve" },
    });
    expect(within(dialog).getByText("+ readiness recovery")).toBeTruthy();
    expect(within(dialog).getByText("− not deployable")).toBeTruthy();
    expect(within(dialog).queryByText("+ crisis response")).toBeNull();
  });

  it("shows the command's posture trade-offs in the detail panel", () => {
    render(<CommandsBuilder commands={[command({ posture: "Expeditionary" })]} {...base} />);
    expect(screen.getByText("+ deployment speed")).toBeTruthy();
    expect(screen.getByText("− higher supply cost")).toBeTruthy();
  });

  it("shows the trade-offs to a read-only viewer too", () => {
    render(
      <CommandsBuilder
        commands={[command({ posture: "Rapid Response" })]}
        units={base.units}
        commanders={[]}
        conflictAssignments={[]}
        regionThreats={{}}
        countryCode="br"
        positionId=""
      />
    );
    expect(screen.queryByRole("combobox", { name: "Command posture" })).toBeNull();
    expect(screen.getByText("+ reaction speed")).toBeTruthy();
    expect(screen.getByText("− sustainment depth")).toBeTruthy();
  });
});

describe("command type bonuses", () => {
  it("shows the selected type's bonuses in the create dialog and updates on change", () => {
    render(<CommandsBuilder commands={[]} {...base} />);
    fireEvent.click(screen.getByRole("button", { name: /create command/i }));
    const dialog = screen.getByRole("dialog");
    // the default type is Regional
    expect(within(dialog).getByText("+ balanced command")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Logistics" }));
    expect(within(dialog).getByText("+ supply throughput")).toBeTruthy();
    expect(within(dialog).getByText("+ overseas sustainment")).toBeTruthy();
    expect(within(dialog).queryByText("+ balanced command")).toBeNull();
  });

  it("shows the command's type bonuses in the detail panel", () => {
    render(<CommandsBuilder commands={[command({ type: "HOMELAND_DEFENSE" })]} {...base} />);
    expect(screen.getByText("+ air-defense integration")).toBeTruthy();
    expect(screen.getByText("+ faster reserve mobilization")).toBeTruthy();
  });
});

describe("finding the Commanding General's page", () => {
  it("links the callout's 'Commanding General' to that page", () => {
    // The callout already explains that the CG does the posting; making the phrase
    // a link is what closes the loop, since nothing else on this page points there.
    render(<CommandsBuilder commands={[command()]} {...base} />);
    const link = screen.getByRole("link", { name: "Commanding General" });
    expect(link.getAttribute("href")).toBe("/country/us/general/commands");
  });

  it("links from the CG's name in the detail panel", () => {
    render(
      <CommandsBuilder
        commands={[command({ commanderIds: ["char_9"], commandingGeneralId: "char_9" })]}
        {...base}
      />
    );
    const link = screen.getByRole("link", { name: /command page/i });
    expect(link.getAttribute("href")).toBe("/country/us/general/commands");
  });

  it("shows no command-page link on a command with no CG yet", () => {
    // Nothing to point at until someone leads it.
    render(
      <CommandsBuilder
        commands={[command({ commanderIds: ["char_9"], commandingGeneralId: null })]}
        {...base}
      />
    );
    expect(screen.queryByRole("link", { name: /command page/i })).toBeNull();
  });

  it("uses the viewing country, not a hardcoded one", () => {
    render(<CommandsBuilder commands={[command()]} {...base} countryCode="de" />);
    expect(screen.getByRole("link", { name: "Commanding General" }).getAttribute("href")).toBe(
      "/country/de/general/commands"
    );
  });
});

describe("one command per commanding general", () => {
  it("offers no MAKE CG control for a general who already leads another command", () => {
    // The reducer refuses the promotion, so the button would silently do nothing.
    render(
      <CommandsBuilder
        commands={[
          command({ id: "cmd-1", commanderIds: ["char_9"], commandingGeneralId: null }),
          command({
            id: "cmd-2",
            name: "Other Command",
            unitIds: [],
            commanderIds: ["char_9"],
            commandingGeneralId: "char_9",
          }),
        ]}
        {...base}
      />
    );
    expect(
      screen.queryByRole("button", { name: /make gen\. real commanding general/i })
    ).toBeNull();
    expect(screen.getByText(/leads another/i)).toBeTruthy();
  });

  it("still offers MAKE CG when the general leads nothing", () => {
    render(
      <CommandsBuilder
        commands={[command({ commanderIds: ["char_9"], commandingGeneralId: null })]}
        {...base}
      />
    );
    expect(
      screen.getByRole("button", { name: /make gen\. real commanding general/i })
    ).toBeTruthy();
  });

  /**
   * Live data: Russia's only command listed a general who had moved to the United
   * Kingdom. The row could not render (the roster no longer held them), so the
   * header counted a commander with no line to remove, and the commands PUT then
   * refused every later edit over that same id.
   */
  describe("a commander who has left the country", () => {
    const stale = [command({ commanderIds: ["char_9", "char_gone"], commandingGeneralId: null })];

    it("does not count a commander it cannot show", () => {
      render(<CommandsBuilder commands={stale} {...base} />);
      expect(screen.getByText(/Commanders . 1/)).toBeTruthy();
      expect(screen.queryByText(/Commanders . 2/)).toBeNull();
    });

    it("says why the roster came back shorter", () => {
      render(<CommandsBuilder commands={stale} {...base} />);
      expect(screen.getByRole("status").textContent).toMatch(
        /no longer a commissioned general of this country/i
      );
    });

    it("clears a lead who is the one who left, so the save is not refused twice", () => {
      render(
        <CommandsBuilder
          commands={[command({ commanderIds: ["char_gone"], commandingGeneralId: "char_gone" })]}
          {...base}
        />
      );
      expect(screen.getByText(/none . −10% efficiency/i)).toBeTruthy();
    });

    it("says nothing when every commander is still on the roster", () => {
      render(<CommandsBuilder commands={[command({ commanderIds: ["char_9"] })]} {...base} />);
      expect(screen.queryByRole("status")).toBeNull();
    });
  });
});
