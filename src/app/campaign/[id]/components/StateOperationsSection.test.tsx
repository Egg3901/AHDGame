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
    countryId: "US",
    attacks: [
      {
        kind: "localFavorability",
        label: "Local attack",
        description:
          "Their favourability there falls 0.4 a turn for 8 turns. Costs $40,000 and 4 actions.",
        costFunds: 40_000,
        costActions: 4,
        needsBucket: false,
        shielded: true,
      },
      {
        kind: "voteSuppression",
        label: "Suppress their vote",
        description:
          "Takes 2.5% off their vote in one state for 8 turns. Costs $70,000 and 5 actions.",
        costFunds: 70_000,
        costActions: 5,
        needsBucket: false,
        shielded: true,
      },
      {
        kind: "turnoutSuppression",
        label: "Suppress a group's turnout",
        description:
          "Takes 1.5 points off one group's turnout in one state. Costs $50,000 and 4 actions.",
        costFunds: 50_000,
        costActions: 4,
        needsBucket: true,
        shielded: false,
      },
    ],
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

  it("shows all three attacks when a rival is opened", () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /Rival Filer/ }));
    expect(screen.getByRole("button", { name: /Local attack/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Suppress their vote/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Suppress a group's turnout/ })).toBeTruthy();
  });

  it("prints each attack's own description, verbatim from the view", () => {
    // The copy is assembled server-side from the constants. A panel that built
    // its own sentence would be a second source for every figure in it.
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /Rival Filer/ }));
    for (const attack of view().attacks) {
      expect(screen.getByText(attack.description)).toBeTruthy();
    }
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
    expect(onAttack).toHaveBeenCalledWith("r1", "localFavorability", "IA", undefined);
  });

  it("does not ask for a group when the attack does not name one", () => {
    const { onAttack } = renderSection();
    fireEvent.click(screen.getByRole("button", { name: /Rival Filer/ }));
    fireEvent.click(screen.getByRole("button", { name: /Suppress their vote/ }));
    fireEvent.click(screen.getByRole("button", { name: /Iowa/ }));
    expect(onAttack).toHaveBeenCalledWith("r1", "voteSuppression", "IA", undefined);
  });

  it("asks for a group as well as a state when the attack names one", () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /Rival Filer/ }));
    fireEvent.click(screen.getByRole("button", { name: /Suppress a group's turnout/ }));
    fireEvent.click(screen.getByRole("button", { name: /Iowa/ }));
    // The state is chosen; now the group, from the canvassing vocabulary.
    expect(screen.getByText("Pick a group to target")).toBeTruthy();
  });

  it("passes the group back with the attack", () => {
    const { onAttack } = renderSection();
    fireEvent.click(screen.getByRole("button", { name: /Rival Filer/ }));
    fireEvent.click(screen.getByRole("button", { name: /Suppress a group's turnout/ }));
    fireEvent.click(screen.getByRole("button", { name: /Iowa/ }));
    fireEvent.click(screen.getAllByTestId("demographic-group-option")[0]);
    expect(onAttack).toHaveBeenCalledWith(
      "r1",
      "turnoutSuppression",
      "IA",
      expect.objectContaining({ categoryKey: expect.any(String), bucket: expect.any(String) })
    );
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
    expect(screen.getByText(/25% of incoming ads and vote/)).toBeTruthy();
  });

  it("says what the shield does not cover, since it blunts two of the three", () => {
    renderSection({ shieldPct: 0.25 });
    expect(screen.getByText(/does not cover turnout suppression/i)).toBeTruthy();
  });

  it("disables an attack the campaign cannot pay for, and says why", () => {
    renderSection({
      positives: { ...view().positives, camp: { ...view().positives.camp, playerActions: 1 } },
    });
    fireEvent.click(screen.getByRole("button", { name: /Rival Filer/ }));
    const btn = screen.getByRole("button", { name: /Local attack/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getAllByText(/Needs 4 actions/).length).toBeGreaterThan(0);
  });

  it("gates each attack on its own price, not on the cheapest", () => {
    // 4 actions buys the local attack and the turnout one; vote suppression
    // costs 5 and must stay closed.
    renderSection({
      positives: { ...view().positives, camp: { ...view().positives.camp, playerActions: 4 } },
    });
    fireEvent.click(screen.getByRole("button", { name: /Rival Filer/ }));
    expect(
      (screen.getByRole("button", { name: /Local attack/ }) as HTMLButtonElement).disabled
    ).toBe(false);
    expect(
      (screen.getByRole("button", { name: /Suppress their vote/ }) as HTMLButtonElement).disabled
    ).toBe(true);
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

describe("how a turnout attack reads against you", () => {
  const turnoutRow = {
    kind: "turnoutSuppression" as const,
    stateId: "NH",
    stateName: "New Hampshire",
    actorName: "Rival Filer",
    bucketLabel: "Evangelicals",
    expiresTurn: 18,
  };

  it("names the group it hit", () => {
    renderSection({ liveAgainstYou: [turnoutRow] });
    expect(screen.getByText(/Evangelicals turnout/)).toBeTruthy();
  });

  it("does not count down, because that effect does not expire", () => {
    // expiresTurn on a turnout row is the attacker's cooldown. The effect
    // itself decays on the same slow curve every turnout modifier does, so a
    // countdown would print a duration the mechanic does not have.
    renderSection({ liveAgainstYou: [turnoutRow] });
    expect(screen.queryByText(/turns left/)).toBeNull();
    expect(screen.getByText(/fading slowly/)).toBeTruthy();
  });

  it("still counts down the kinds that do expire", () => {
    renderSection({
      liveAgainstYou: [
        {
          kind: "voteSuppression",
          stateId: "NH",
          stateName: "New Hampshire",
          actorName: "Rival Filer",
          expiresTurn: 18,
        },
      ],
    });
    expect(screen.getByText(/6 turns left/)).toBeTruthy();
  });

  it("reads without a label if the group id is unknown to this country", () => {
    renderSection({
      liveAgainstYou: [{ ...turnoutRow, bucketLabel: undefined }],
    });
    expect(screen.getByText(/a group turnout/)).toBeTruthy();
  });
});
