/** @vitest-environment happy-dom */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PartyPositions } from "./PartyPositions";
import type { PartyLite } from "./PartyChip";

const p = (abbr: string): PartyLite => ({
  partyId: abbr,
  abbreviation: abbr,
  color: "#444",
  name: abbr,
});

describe("PartyPositions", () => {
  it("renders each group's chips and a dash for an empty group", () => {
    render(
      <PartyPositions
        forParties={[p("SF")]}
        againstParties={[p("DUP"), p("UUP")]}
        undeclared={[]}
      />
    );
    expect(screen.getByText("SF")).toBeTruthy();
    expect(screen.getByText("DUP")).toBeTruthy();
    expect(screen.getByText("UUP")).toBeTruthy();
    // Undeclared group empty → a muted dash placeholder is shown.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("uses kind-aware column labels when provided", () => {
    render(
      <PartyPositions
        forParties={[p("SF")]}
        againstParties={[]}
        undeclared={[]}
        labels={{ yes: "Reunify", no: "Stay in UK" }}
      />
    );
    expect(screen.getByText(/For · Reunify/i)).toBeTruthy();
    expect(screen.getByText(/Against · Stay in UK/i)).toBeTruthy();
  });
});
