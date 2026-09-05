/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { StateOperationsSection } from "./StateOperationsSection";
import type { StateOperationsView } from "@/lib/elections/dto/stateOperations";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function view(over: Partial<StateOperationsView> = {}): StateOperationsView {
  return {
    electionId: "e1",
    currentTurn: 12,
    positives: {
      camp: {
        currentCampaignState: "IA",
        currentTicks: 3,
        tickCap: 5,
        homeState: "IA",
        surgeUsed: false,
        playerActions: 25,
        playerFunds: 250_000,
        surgeCostFunds: 25_000,
        surgeCostActions: 3,
        surgeBoost: 15,
        states: [
          { id: "IA", name: "Iowa", actionCost: 3 },
          { id: "NH", name: "New Hampshire", actionCost: 3 },
        ],
      },
      presence: [{ stateId: "NH", name: "New Hampshire", level: 5, nextCost: 250_000 }],
      canvass: { available: true, stateId: "IA", reason: null },
    },
    opponents: [
      {
        candidateId: "r1",
        name: "Rival Filer",
        color: "#EF4444",
        delegates: 942,
        liveAgainstThem: [],
      },
    ],
    liveAgainstYou: [],
    shieldPct: 0,
    campaignFunds: 1_200_000,
    campaignFxRate: 1,
    localAttack: { costFunds: 40_000, costActions: 4, perTurn: 0.4, turns: 8 },
    ...over,
  };
}

function renderSection(over: Partial<StateOperationsView> = {}) {
  const onAttack = vi.fn();
  render(
    <StateOperationsSection
      view={view(over)}
      busy={null}
      onAttack={onAttack}
      onChanged={() => {}}
    />
  );
  return { onAttack };
}

describe("StateOperationsSection", () => {
  it("keeps an opponent's attacks closed until their row is opened", () => {
    renderSection();
    expect(screen.queryByRole("button", { name: /Local attack/ })).toBeNull();
  });

  it("opens an opponent's attacks when their row is chosen", () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /Rival Filer/ }));
    expect(screen.getByRole("button", { name: /Local attack/ })).toBeTruthy();
  });

  it("marks the expander for assistive tech", () => {
    renderSection();
    const row = screen.getByRole("button", { name: /Rival Filer/ });
    expect(row.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
  });

  it("says what the attack does and what it costs", () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /Rival Filer/ }));
    const copy = screen.getByText(/0\.4 a turn/);
    expect(copy.textContent).toContain("$40,000");
    expect(copy.textContent).toContain("8 turns");
  });

  it("takes every figure from the view, so no price is typed into the markup", () => {
    // The home-state surge sat inert for months because a route and an engine
    // each held their own copy of one number.
    renderSection({
      localAttack: { costFunds: 12_345, costActions: 2, perTurn: 1.5, turns: 3 },
    });
    fireEvent.click(screen.getByRole("button", { name: /Rival Filer/ }));
    const copy = screen.getByText(/1\.5 a turn/);
    expect(copy.textContent).toContain("$12,345");
    expect(copy.textContent).toContain("3 turns");
  });

  it("asks which state before attacking, since an attack names one", () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /Rival Filer/ }));
    fireEvent.click(screen.getByRole("button", { name: /Local attack/ }));
    // The shared picker opens rather than the attack firing blind.
    expect(screen.getByText("Pick a state to attack in")).toBeTruthy();
  });

  it("passes the target, the kind and the chosen state back", () => {
    const { onAttack } = renderSection();
    fireEvent.click(screen.getByRole("button", { name: /Rival Filer/ }));
    fireEvent.click(screen.getByRole("button", { name: /Local attack/ }));
    fireEvent.click(screen.getByRole("button", { name: /Iowa/ }));
    expect(onAttack).toHaveBeenCalledWith("r1", "localFavorability", "IA");
  });

  it("names who is attacking you, so a hit can be traced", () => {
    renderSection({
      liveAgainstYou: [
        {
          kind: "localFavorability",
          stateId: "NH",
          stateName: "New Hampshire",
          actorName: "Rival Filer",
          expiresTurn: 18,
        },
      ],
    });
    // Both halves in one assertion: the rival's name is also on their row in
    // the field, and New Hampshire is also in the presence line.
    expect(screen.getByText(/Rival Filer in New Hampshire/)).toBeTruthy();
  });

  it("counts down an incoming attack rather than printing a raw turn number", () => {
    renderSection({
      liveAgainstYou: [
        {
          kind: "localFavorability",
          stateId: "NH",
          stateName: "New Hampshire",
          actorName: "Rival Filer",
          expiresTurn: 18,
        },
      ],
    });
    expect(screen.getByText(/6 turns left/)).toBeTruthy();
  });

  it("says how much of an incoming hit Rapid Response is absorbing", () => {
    renderSection({ shieldPct: 0.25 });
    expect(screen.getByText(/25% of every hit/)).toBeTruthy();
  });

  it("disables an attack the campaign cannot pay for, and says why", () => {
    renderSection({
      positives: { ...view().positives, camp: { ...view().positives.camp, playerActions: 1 } },
    });
    fireEvent.click(screen.getByRole("button", { name: /Rival Filer/ }));
    const btn = screen.getByRole("button", { name: /Local attack/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByText(/Needs 4 actions/)).toBeTruthy();
  });

  it("disables an attack the war chest cannot pay for, and says why", () => {
    // The war chest, not the candidate's own balance: an attack is charged to
    // the campaign, the way Presence and the ops levers are.
    renderSection({ campaignFunds: 10 });
    fireEvent.click(screen.getByRole("button", { name: /Rival Filer/ }));
    const btn = screen.getByRole("button", { name: /Local attack/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByText(/\$40,000 in the war chest/)).toBeTruthy();
  });

  it("ignores the candidate's own balance, which pays for the surge instead", () => {
    renderSection({
      positives: { ...view().positives, camp: { ...view().positives.camp, playerFunds: 0 } },
    });
    fireEvent.click(screen.getByRole("button", { name: /Rival Filer/ }));
    const btn = screen.getByRole("button", { name: /Local attack/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("prices the next presence level per state off its own level", () => {
    // Presence escalates. Quoting the level-1 price for a level-5 state is the
    // "two sources, two prices" bug this hub exists to avoid.
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /Build presence/ }));
    // Iowa has none, so it is offered at the base price; New Hampshire is at 5.
    expect(screen.getByRole("button", { name: /Iowa/ }).textContent).toContain("L0");
    expect(screen.getByRole("button", { name: /New Hampshire/ }).textContent).toContain("L5");
  });

  it("quotes presence in the campaign's currency, not in anchor units", () => {
    renderSection({ campaignFxRate: 2 });
    fireEvent.click(screen.getByRole("button", { name: /Build presence/ }));
    // Level 0 in Iowa is the base price, doubled by the rate the view carries.
    expect(screen.getByRole("button", { name: /Iowa/ }).textContent).toContain("$500,000");
  });

  it("says nothing is running against you when nothing is", () => {
    renderSection();
    expect(screen.getByText("Nothing running against you.")).toBeTruthy();
  });

  it("handles a candidate running unopposed", () => {
    renderSection({ opponents: [] });
    expect(screen.getByText("You are running unopposed.")).toBeTruthy();
  });
});
