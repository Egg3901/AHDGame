// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SituationBoardClient } from "./SituationBoardClient";

// Conflicts are dynamic and may start empty.
const props = {
  country: "US",
  // Resolved server-side from live organisation membership, not from a table here.
  bloc: "west" as const,
  pool: 1000,
  cohesion: 85,
  committed: {},
  conflicts: [],
};

beforeEach(() => vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true })));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SituationBoardClient (smoke render)", () => {
  it("renders the header, ledger, and empty conflict register", () => {
    render(<SituationBoardClient {...props} />);
    expect(screen.getByRole("heading", { name: "Conflicts", level: 1 })).toBeTruthy();
    expect(screen.getByText(/WESTERN BLOC · COMBAT POWER/)).toBeTruthy();
    expect(screen.getByText("No active conflicts")).toBeTruthy();
    expect(screen.getByText("ACTIVE FRONTS · 0")).toBeTruthy();
  });

  it("reflects the live pool in the ledger (all in reserve, none deployed)", () => {
    render(<SituationBoardClient {...props} />);
    // total = pool (1,000); with no conflicts, nothing is deployed and all is reserve
    expect(screen.getAllByText("1,000").length).toBeGreaterThan(0);
  });

  it("adjusts bloc cohesion and persists it", () => {
    render(<SituationBoardClient {...props} />);
    const slider = screen.getByRole("slider", { name: "Set bloc cohesion" });
    fireEvent.change(slider, { target: { value: "60" } });
    expect(screen.getByText("60%")).toBeTruthy();
  });

  // The board named the bloc from a static table that covered 9 countries and read
  // every other nation as western — a Warsaw Pact player was labelled WESTERN BLOC.
  it("names the bloc from the live roll, not from the flavour table", () => {
    render(<SituationBoardClient {...props} country="DD" bloc="east" />);
    expect(screen.getByText(/EASTERN BLOC · COMBAT POWER/)).toBeTruthy();
  });

  it("labels an unaligned nation NON-ALIGNED rather than defaulting it west", () => {
    render(<SituationBoardClient {...props} country="SE" bloc="nonAligned" />);
    expect(screen.getByText(/NON-ALIGNED · COMBAT POWER/)).toBeTruthy();
  });

  it("renders live fronts and commits combat power to them", () => {
    render(
      <SituationBoardClient
        {...props}
        conflicts={[
          {
            id: "conflict-nic",
            conflictId: 7,
            name: "Nicaraguan Civil War",
            status: "active",
            sideA: "Government",
            sideB: "Insurgents",
            control: 35,
          },
        ]}
      />
    );

    expect(screen.getByText("ACTIVE FRONTS · 1")).toBeTruthy();
    expect(screen.getByText("Nicaraguan Civil War")).toBeTruthy();
    expect(screen.getByText("Government 65% / Insurgents 35%")).toBeTruthy();

    const slider = screen.getByRole("slider", {
      name: "Commit combat power to Nicaraguan Civil War",
    });
    fireEvent.change(slider, { target: { value: "400" } });

    expect(screen.getByText("400 CP committed")).toBeTruthy();
    expect(screen.getByText("600", { selector: "[data-reserve-power]" })).toBeTruthy();
  });
});
