/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render as rtlRender, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enElections from "../../../../messages/en/elections.json";
import { DemocraticHealthGauge, type DemocraticHealthData } from "./DemocraticHealthGauge";

function render(ui: React.ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enElections}>
      {ui}
    </NextIntlClientProvider>
  );
}

afterEach(cleanup);

const HEALTH: DemocraticHealthData = {
  value: 42.5,
  label: "Fragile democracy",
  rulingPartyId: "1",
  rulingPartyName: "Democratic Party",
  partyPenaltyPct: 4.2,
  currentRulerPenaltyPct: 6.3,
  currentRulerReliefPct: 40,
  currentRulerInRace: true,
  recordedTurn: 412,
};

describe("DemocraticHealthGauge", () => {
  it("renders nothing when no health snapshot exists", () => {
    const { container } = render(<DemocraticHealthGauge data={undefined} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the score, ruling-party drag, ruler drag, and temporary relief", () => {
    render(<DemocraticHealthGauge data={HEALTH} />);
    expect(screen.getByText("Democratic Health")).toBeTruthy();
    expect(screen.getByText("42.5 / 100")).toBeTruthy();
    expect(screen.getByText(/judge Democratic Party/)).toBeTruthy();
    expect(screen.getByText("-4.2%")).toBeTruthy();
    expect(screen.getByText("-6.3%")).toBeTruthy();
    expect(screen.getByText(/reduces the extra presidential drag by 40%/)).toBeTruthy();
    expect(screen.getByText(/turn 412/)).toBeTruthy();
  });

  it("identifies when the sitting President is not a candidate", () => {
    render(<DemocraticHealthGauge data={{ ...HEALTH, currentRulerInRace: false }} />);
    expect(screen.getByText(/not in this race/)).toBeTruthy();
  });
});
