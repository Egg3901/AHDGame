/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from "vitest";
import { render as rtlRender, screen, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Character } from "@/lib/db/types";
import { PoliticalStanding } from "./PoliticalStanding";
import enProfile from "../../../../messages/en/profile.json";

function render(ui: React.ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enProfile}>
      {ui}
    </NextIntlClientProvider>
  );
}

const baseProps = {
  character: { actions: 5, party: "2" } as unknown as Character,
  homeState: null,
  influence: 0,
  nationalInfluence: 0,
  influenceDecay: "0",
  nationalGainPerTurn: "0",
  favorability: 50,
  favDecayDisplay: null,
  infamy: 0,
  infamyPenalty: null,
  maxNPI: 100,
  baseActionsPerTurn: 4,
  officeActionBonus: 2,
  chairActionBonus: 0,
  totalActionsPerTurn: 6,
  actionHoarding: false,
};

function rowFor(label: string): HTMLElement {
  const row = screen.getByText(label).closest("tr");
  if (!row) throw new Error(`no row for ${label}`);
  return row as HTMLElement;
}

describe("PoliticalStanding action breakdown", () => {
  it("renders each labeled source line in the Actions tooltip when opened", () => {
    render(
      <PoliticalStanding
        {...baseProps}
        bonusActionsFromParty={3}
        actionBreakdown={[
          { label: "Base", amount: 4 },
          { label: "Office (Member of Bundestag)", amount: 1 },
          { label: "Cabinet (Federal Minister of Defence)", amount: 1 },
          { label: "Party influence", amount: 3 },
        ]}
      />
    );

    // Tooltip content only renders once the trigger is focused/opened.
    fireEvent.focus(screen.getByText("Actions"));

    expect(screen.getByText("Office (Member of Bundestag)")).toBeTruthy();
    expect(screen.getByText("Cabinet (Federal Minister of Defence)")).toBeTruthy();
    expect(screen.getAllByText("Party influence").length).toBeGreaterThanOrEqual(2);
    // Amounts render with a leading "+".
    expect(screen.getAllByText("+1").length).toBeGreaterThanOrEqual(2);
  });

  it("renders no breakdown block when actionBreakdown is absent", () => {
    render(<PoliticalStanding {...baseProps} />);
    fireEvent.focus(screen.getByText("Actions"));
    expect(screen.queryByText(/Cabinet \(/)).toBeNull();
  });
});

describe("PoliticalStanding table", () => {
  it("is a table with measure, value, per-turn and notes columns", () => {
    render(<PoliticalStanding {...baseProps} />);
    const table = screen.getByRole("table");
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent);
    expect(headers).toEqual(["Measure", "Value", "Per turn", "Notes"]);
    const heading = screen.getByRole("heading", { name: "Political standing" });
    // A primary block: the large main heading, with no rule under it.
    expect(heading.className).toContain("text-heading-lg");
    expect(heading.parentElement?.className).not.toContain("border-b");
  });

  it("colours only gains, losses and penalties", () => {
    render(
      <PoliticalStanding
        {...baseProps}
        influence={34.2}
        influenceDecay="0.26"
        nationalInfluence={12.6}
        nationalGainPerTurn="1.34"
        favorability={63.4}
        favDecayDisplay="0.2"
        infamy={24.5}
        infamyPenalty="0.23"
      />
    );

    expect(within(rowFor("State influence")).getByText("−0.26").className).toContain("text-error");
    expect(within(rowFor("National influence")).getByText("+1.34").className).toContain(
      "text-success"
    );
    expect(within(rowFor("Favorability")).getByText("−0.2").className).toContain("text-error");
    // The infamy penalty is the only red note; the values themselves stay neutral.
    const infamyRow = rowFor("Infamy");
    const penaltyNotes = within(infamyRow).getAllByText("Costs 0.23% favorability per turn");
    expect(penaltyNotes.every((note) => note.className.includes("text-error"))).toBe(true);
    expect(within(infamyRow).getByText("24.5%").className).toContain("text-foreground");
    expect(within(rowFor("Favorability")).getByText("63.4%").className).toContain(
      "text-foreground"
    );
  });

  it("shows the national rank and the leader's score instead of a glow", () => {
    const { container } = render(
      <PoliticalStanding {...baseProps} nationalInfluence={12.6} maxNPI={45.2} nationalRank={3} />
    );
    expect(
      within(rowFor("National influence")).getAllByText("#3 nationally, leader at 45.2").length
    ).toBeGreaterThan(0);
    expect(container.innerHTML).not.toContain("shadow-[0_0");
  });

  it("flags hoarding as a penalty", () => {
    render(<PoliticalStanding {...baseProps} actionHoarding />);
    const notes = within(rowFor("Actions")).getAllByText(/Hoarding: −4 per turn/);
    expect(notes.every((note) => note.className.includes("text-error"))).toBe(true);
  });

  it("links the campaign office only on the player's own profile", () => {
    const { rerender } = render(<PoliticalStanding {...baseProps} />);
    expect(screen.getByRole("link", { name: "Campaign office" })).toBeTruthy();
    rerender(
      <NextIntlClientProvider locale="en" messages={enProfile}>
        <PoliticalStanding {...baseProps} isOwnProfile={false} />
      </NextIntlClientProvider>
    );
    expect(screen.queryByRole("link", { name: "Campaign office" })).toBeNull();
  });

  it("omits the party row for independents", () => {
    render(
      <PoliticalStanding
        {...baseProps}
        character={{ actions: 5, party: "independent" } as unknown as Character}
      />
    );
    expect(screen.queryByText("Party influence")).toBeNull();
  });
});
