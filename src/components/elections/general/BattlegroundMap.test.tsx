// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { render as rtlRender } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { HoverCard } from "./BattlegroundMap";
import enElections from "../../../../messages/en/elections.json";

function render(ui: React.ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enElections}>
      {ui}
    </NextIntlClientProvider>
  );
}

describe("HoverCard", () => {
  it("renders state name, candidate rows with shares, and tier line", () => {
    const { getByText } = render(
      <HoverCard
        data={{
          stateName: "Pennsylvania",
          candidates: [
            { name: "J. Smith", partyAbbr: "DEM", partyColor: "#3B82F6", votePct: 52.1 },
            { name: "M. Jones", partyAbbr: "REP", partyColor: "#EF4444", votePct: 47.4 },
          ],
          marginPp: 4.7,
          tier: "tossup",
        }}
      />
    );
    // getByText throws if not found, so a successful return IS the assertion.
    expect(getByText("Pennsylvania")).toBeTruthy();
    expect(getByText("J. Smith")).toBeTruthy();
    expect(getByText("M. Jones")).toBeTruthy();
    expect(getByText("DEM")).toBeTruthy();
    expect(getByText("REP")).toBeTruthy();
    expect(getByText("52.1%")).toBeTruthy();
    expect(getByText("47.4%")).toBeTruthy();
    expect(getByText(/Toss-up/i)).toBeTruthy();
    expect(getByText(/\+4\.7pp/)).toBeTruthy();
  });

  it("renders three-candidate variant when input includes 3 candidates", () => {
    const { getByText } = render(
      <HoverCard
        data={{
          stateName: "California",
          candidates: [
            { name: "A", partyAbbr: "DEM", partyColor: "#3B82F6", votePct: 50 },
            { name: "B", partyAbbr: "REP", partyColor: "#EF4444", votePct: 45 },
            { name: "C", partyAbbr: "GRN", partyColor: "#22C55E", votePct: 5 },
          ],
          marginPp: 5,
          tier: "lean",
        }}
      />
    );
    expect(getByText("DEM")).toBeTruthy();
    expect(getByText("REP")).toBeTruthy();
    expect(getByText("GRN")).toBeTruthy();
    expect(getByText(/Lean/i)).toBeTruthy();
  });
});
