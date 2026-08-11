// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { OrgInfluenceView } from "@/lib/alignment/queries/orgInfluence";
import { BalanceBar } from "./BalanceBar";

const BASE = {
  poles: [
    { id: "WEST", label: "West", shortLabel: "W", accentToken: "info" },
    { id: "EAST", label: "East", shortLabel: "E", accentToken: "error" },
  ],
  remainderLabel: "Non-aligned",
  balance: {
    byEconomy: { shares: { WEST: 61, EAST: 21 }, nonAligned: 18 },
    byNations: { shares: { WEST: 43, EAST: 33 }, nonAligned: 24 },
    economyCount: 182,
    nationCount: 197,
  },
  channel: { poleId: "WEST", poleLabel: "West", accentToken: "info", weight: 1 },
} as unknown as OrgInfluenceView;

describe("BalanceBar", () => {
  it("opens on the economic weighting and can switch to nations", () => {
    render(<BalanceBar view={BASE} />);
    expect(screen.getByText(/West 61/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /by nations/i }));
    expect(screen.getByText(/West 43/)).toBeTruthy();
  });

  it("says how many nations fed the active weighting", () => {
    // The two counts differ whenever a nation has no GDP, so the bar states
    // which population it is describing rather than letting them disagree.
    render(<BalanceBar view={BASE} />);
    expect(screen.getByText(/182 of 197/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /by nations/i }));
    expect(screen.getByText(/197 nations/)).toBeTruthy();
  });

  it("renders nothing when there is no balance to show", () => {
    // No rows is "no data", not "the world is non-aligned".
    const { container } = render(
      <BalanceBar view={{ ...BASE, balance: null } as unknown as OrgInfluenceView} />
    );
    expect(container.textContent).toBe("");
  });
});
