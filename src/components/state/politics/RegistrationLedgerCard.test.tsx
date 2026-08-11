/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RegistrationLedgerCard } from "./RegistrationLedgerCard";

describe("RegistrationLedgerCard", () => {
  it("shows the honest unseeded state when not seeded", () => {
    render(<RegistrationLedgerCard regLedger={{ seeded: false, headline: null, movement: [] }} />);
    expect(screen.getByText(/not yet seeded/i)).toBeTruthy();
  });

  it("shows the headline Reg% and party when seeded", () => {
    render(
      <RegistrationLedgerCard
        regLedger={{
          seeded: true,
          headline: { partyId: "3", abbr: "DEM", color: "#3b82f6", regPct: 49 },
          movement: [
            { turn: 98, regPct: 48.5 },
            { turn: 100, regPct: 49 },
          ],
        }}
      />
    );
    expect(screen.getByText("DEM")).toBeTruthy();
    expect(screen.getByText(/49\.0%/)).toBeTruthy();
  });
});
