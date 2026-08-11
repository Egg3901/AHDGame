/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import DebateCard from "./DebateCard";

const STRATEGY_OPTIONS = [
  { id: "attack", label: "Attack opponent", blurb: "Go on the offensive.", linkedStat: "debate" },
  {
    id: "aboveFray",
    label: "Remain above the fray",
    blurb: "Stay presidential.",
    linkedStat: "charisma",
  },
  {
    id: "tout",
    label: "Tout accomplishments",
    blurb: "Run on your record.",
    linkedStat: "statecraft",
  },
];

// Far-future fixed deadline so the countdown is always positive (no new Date() in assertions).
const FUTURE_DEADLINE_MS = 4_102_444_800_000; // ~year 2100

function stubFetch(active: Record<string, unknown> | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ active, lastResolved: null }) }))
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("DebateCard — after the player has submitted", () => {
  beforeEach(() => {
    stubFetch({
      id: "deb1",
      opponentName: "Kian Blackstone",
      deadlineRealtimeMs: FUTURE_DEADLINE_MS,
      canSubmit: false,
      submittedStrategies: ["attack"],
      strategyOptions: STRATEGY_OPTIONS,
    });
  });

  it("highlights the chosen strategy in green with a 'You selected' indicator", async () => {
    render(<DebateCard />);

    const attackBtn = await screen.findByRole("button", { name: /Attack opponent/i });
    // Chosen option carries the indicator and a success (green) highlight.
    expect(within(attackBtn).getByText(/You selected/i)).toBeTruthy();
    expect(attackBtn.className).toMatch(/success/);
  });

  it("does not mark unchosen strategies as selected", async () => {
    render(<DebateCard />);

    await screen.findByRole("button", { name: /Attack opponent/i });
    const aboveBtn = screen.getByRole("button", { name: /Remain above the fray/i });
    expect(within(aboveBtn).queryByText(/You selected/i)).toBeNull();
    expect(aboveBtn.className).not.toMatch(/success/);
  });
});

describe("DebateCard — picking a strategy is single-select", () => {
  beforeEach(() => {
    stubFetch({
      id: "deb1",
      opponentName: "Matthew Thompson",
      deadlineRealtimeMs: FUTURE_DEADLINE_MS,
      canSubmit: true,
      submittedStrategies: null,
      strategyOptions: STRATEGY_OPTIONS,
    });
  });

  it("selecting a second strategy deselects the first", async () => {
    render(<DebateCard />);

    const attackBtn = await screen.findByRole("button", { name: /Attack opponent/i });
    const aboveBtn = screen.getByRole("button", { name: /Remain above the fray/i });

    fireEvent.click(attackBtn);
    expect(attackBtn.className).toMatch(/bg-primary/);

    fireEvent.click(aboveBtn);
    // Picking the second clears the first — only one stays highlighted.
    expect(aboveBtn.className).toMatch(/bg-primary/);
    expect(attackBtn.className).not.toMatch(/bg-primary/);

    // Commit control stays singular, never a count > 1.
    expect(screen.getByRole("button", { name: /^Commit strategy$/i })).toBeTruthy();
  });
});
