// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { InfluenceTarget, OrgInfluenceView } from "@/lib/alignment/queries/orgInfluence";
import { NationsInPlay } from "./NationsInPlay";

const target = (over: Partial<InfluenceTarget>): InfluenceTarget =>
  ({
    entityId: "YU",
    name: "Somewhere",
    isPlayable: true,
    lead: 20,
    status: "contested",
    ourShare: 30,
    shares: { WEST: 30, EAST: 50 },
    nonAligned: 20,
    previousShares: null,
    axis: null,
    topPoleId: "EAST",
    trend: null,
    ourShareTrend: null,
    crisis: null,
    sanctionedBy: [],
    isMember: false,
    pointCostLocal: 100,
    turnCapCostLocal: 500,
    costToGate: 3_000,
    resistsAtHalfStrength: false,
    ...over,
  }) as InfluenceTarget;

const VIEW = {
  poles: [
    { id: "WEST", label: "West", shortLabel: "W", accentToken: "info" },
    { id: "EAST", label: "East", shortLabel: "E", accentToken: "error" },
  ],
  remainderLabel: "Non-aligned",
  fundCurrencyCountryId: "US",
  joinShare: 60,
  targets: [
    target({ entityId: "YU", name: "Yugoslavia", costToGate: 9_000_000_000, lead: 4 }),
    target({ entityId: "SE", name: "Sweden", costToGate: 1_000_000_000, lead: 40 }),
    target({
      entityId: "TR",
      name: "Turkey",
      costToGate: 5_000_000_000,
      lead: 20,
      crisis: { turnsRemaining: 3, movementCap: 7.5 },
    }),
  ],
} as unknown as OrgInfluenceView;

const rows = () => screen.getAllByTestId("nation-row").map((r) => r.textContent ?? "");

describe("NationsInPlay", () => {
  it("opens cheapest-to-flip first", () => {
    render(<NationsInPlay view={VIEW} selectedEntityId={null} onSelect={() => {}} />);
    expect(rows()[0]).toMatch(/Sweden/);
  });

  it("ranks by distance to our own gate, not by how contested a nation is", () => {
    // The old "closest battles" sorted on the gap between the top two poles,
    // which surfaced knife-edge fights in countries we barely hold. What a
    // player wants here is who is nearly ours.
    render(
      <NationsInPlay
        view={
          {
            ...VIEW,
            targets: [
              // Bitterly contested (lead 1) but we hold almost nothing.
              target({ entityId: "YU", name: "Yugoslavia", lead: 1, ourShare: 12 }),
              // Not contested at all, and four points from joining us.
              target({ entityId: "TR", name: "Turkey", lead: 40, ourShare: 56 }),
            ],
          } as unknown as OrgInfluenceView
        }
        selectedEntityId={null}
        onSelect={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /^Closest to joining$/i }));
    expect(rows()[0]).toMatch(/Turkey/);
    expect(rows()[0]).toMatch(/4\.00 to join/);
  });

  it("marks a nation that already clears the gate", () => {
    // "-8 to join" would be nonsense; it qualifies and simply has not applied.
    render(
      <NationsInPlay
        view={
          {
            ...VIEW,
            targets: [target({ entityId: "TR", name: "Turkey", ourShare: 68 })],
          } as unknown as OrgInfluenceView
        }
        selectedEntityId={null}
        onSelect={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /^Closest to joining$/i }));
    expect(rows()[0]).toMatch(/eligible/);
  });

  it("shows only nations under a flashpoint, soonest to settle first", () => {
    // "Where is influence worth most right now" — a nation with no flashpoint
    // is not an answer to that question.
    render(
      <NationsInPlay
        view={
          {
            ...VIEW,
            targets: [
              target({ entityId: "SE", name: "Sweden" }),
              target({
                entityId: "TR",
                name: "Turkey",
                crisis: { turnsRemaining: 7, movementCap: 7.5 },
              }),
              target({
                entityId: "YU",
                name: "Yugoslavia",
                crisis: { turnsRemaining: 2, movementCap: 7.5 },
              }),
            ],
          } as unknown as OrgInfluenceView
        }
        selectedEntityId={null}
        onSelect={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /^Under flashpoint$/i }));
    expect(rows()).toHaveLength(2);
    expect(rows()[0]).toMatch(/Yugoslavia/); // 2 turns left — closing soonest
    expect(rows()[1]).toMatch(/Turkey/); // 7
    expect(rows().join(" ")).not.toMatch(/Sweden/);
  });

  it("says so when no flashpoint is open anywhere", () => {
    render(
      <NationsInPlay
        view={
          {
            ...VIEW,
            targets: VIEW.targets.map((t) => ({ ...t, crisis: null })),
          } as unknown as OrgInfluenceView
        }
        selectedEntityId={null}
        onSelect={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /^Under flashpoint$/i }));
    expect(screen.queryAllByTestId("nation-row")).toHaveLength(0);
    expect(screen.getByText(/No flashpoint is open anywhere/i)).toBeTruthy();
  });

  it("shows the metric the active sort ranks by", () => {
    // A ranking whose number is not on screen is a ranking the player cannot
    // check.
    render(<NationsInPlay view={VIEW} selectedEntityId={null} onSelect={() => {}} />);
    expect(rows()[0]).toMatch(/\$1B/); // cost to gate
    fireEvent.click(screen.getByRole("button", { name: /^Closest to joining$/i }));
    expect(rows()[0]).toMatch(/to join|eligible/);
  });

  it("sorts an unpriceable nation last rather than first", () => {
    // Absent data must never read as "cheapest".
    render(
      <NationsInPlay
        view={
          {
            ...VIEW,
            targets: [
              target({ entityId: "JO", name: "Jordan", costToGate: null }),
              ...VIEW.targets,
            ],
          } as unknown as OrgInfluenceView
        }
        selectedEntityId={null}
        onSelect={() => {}}
      />
    );
    expect(rows().at(-1)).toMatch(/Jordan/);
  });

  it("hides nothing in the acquisition modes", () => {
    // These answer "who should I go after" — hiding a nation would hide an
    // option. The two narrowing modes answer different questions and are
    // tested separately.
    render(<NationsInPlay view={VIEW} selectedEntityId={null} onSelect={() => {}} />);
    for (const mode of [/^Cheapest to flip$/i, /^Closest to joining$/i]) {
      fireEvent.click(screen.getByRole("button", { name: mode }));
      expect(screen.getAllByTestId("nation-row")).toHaveLength(3);
    }
  });

  it("reports the selection", () => {
    const onSelect = vi.fn();
    render(<NationsInPlay view={VIEW} selectedEntityId={null} onSelect={onSelect} />);
    fireEvent.click(screen.getAllByTestId("nation-row")[0]!);
    expect(onSelect).toHaveBeenCalledWith("SE");
  });
  it("shows only members, weakest hold first, when filtering by membership", async () => {
    // Retention: the member closest to walking out is the one worth keeping,
    // and a list padded with countries you have no relationship to cannot
    // answer "who am I about to lose".
    render(
      <NationsInPlay
        view={
          {
            ...VIEW,
            targets: [
              target({ entityId: "SE", name: "Sweden", isMember: false }),
              target({ entityId: "TR", name: "Turkey", isMember: true, ourShare: 70 }),
              target({ entityId: "YU", name: "Yugoslavia", isMember: true, ourShare: 44 }),
            ],
          } as unknown as OrgInfluenceView
        }
        selectedEntityId={null}
        onSelect={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /^Already a member$/i }));
    expect(rows()).toHaveLength(2); // Sweden is not a member and is gone
    expect(rows()[0]).toMatch(/Yugoslavia/); // 44 — weakest hold
    expect(rows()[1]).toMatch(/Turkey/); // 70
    expect(rows().join(" ")).not.toMatch(/Sweden/);
  });

  it("explains an empty membership view rather than showing a blank list", async () => {
    // A bloc with no members yet must say so; an empty panel reads as a bug.
    render(<NationsInPlay view={VIEW} selectedEntityId={null} onSelect={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^Already a member$/i }));
    expect(screen.queryAllByTestId("nation-row")).toHaveLength(0);
    expect(screen.getByText(/no members with a standing to defend/i)).toBeTruthy();
  });
});
