/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, afterEach } from "vitest";
import { render as rtlRender, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { NationalMoodGauge, type NationalMoodData } from "./NationalMoodGauge";
import enElections from "../../../../messages/en/elections.json";

function render(ui: React.ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enElections}>
      {ui}
    </NextIntlClientProvider>
  );
}

afterEach(cleanup);

const PENALTY: NationalMoodData = {
  miseryIndex: 7.5,
  sharePts: -3.4,
  components: [
    { key: "unemployment", label: "Unemployment", contributionPts: -2.4 },
    { key: "inflation", label: "Inflation", contributionPts: -1 },
  ],
  fatigueMultiplier: 1,
  incumbentPartyId: "1",
  incumbentPartyName: "Democratic Party",
  incumbentPartyColor: "#3b82f6",
  recordedTurn: 412,
};

describe("NationalMoodGauge", () => {
  it("renders nothing when the tally has no referendum snapshot", () => {
    const { container } = render(<NationalMoodGauge data={undefined} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing for an explicit null", () => {
    const { container } = render(<NationalMoodGauge data={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the signed total, the component rows, and the incumbent party", () => {
    render(<NationalMoodGauge data={PENALTY} />);
    expect(screen.getByText("National Mood")).toBeTruthy();
    expect(screen.getAllByText(/-3\.4 pts/).length).toBeGreaterThan(0);
    expect(screen.getByText("Unemployment")).toBeTruthy();
    expect(screen.getByText(/-2\.4 pts/)).toBeTruthy();
    expect(screen.getByText("Inflation")).toBeTruthy();
    expect(screen.getByText(/Toward Democratic Party/)).toBeTruthy();
    expect(screen.getByText(/turn 412/)).toBeTruthy();
  });

  it("signs a positive shift with a plus and omits the fatigue line at x1", () => {
    render(
      <NationalMoodGauge
        data={{
          ...PENALTY,
          sharePts: 2.5,
          components: [{ key: "incomeTrend", label: "Real incomes", contributionPts: 2.5 }],
        }}
      />
    );
    expect(screen.getAllByText(/\+2\.5 pts/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/consecutive term/)).toBeNull();
  });

  it("names the term and the multiplier when term fatigue applies", () => {
    render(<NationalMoodGauge data={{ ...PENALTY, fatigueMultiplier: 1.25 }} />);
    expect(screen.getByText(/Seeking a 3rd consecutive term/)).toBeTruthy();
    expect(screen.getByText(/x1\.25/)).toBeTruthy();
  });

  it("reports a fourth or later term at the higher multiplier", () => {
    render(<NationalMoodGauge data={{ ...PENALTY, fatigueMultiplier: 1.5 }} />);
    expect(screen.getByText(/Seeking a 4th or later consecutive term/)).toBeTruthy();
    expect(screen.getByText(/x1\.5/)).toBeTruthy();
  });

  it("shows the response-credit line and the credited bill titles", () => {
    render(
      <NationalMoodGauge
        data={{
          ...PENALTY,
          forgivenessFrac: 0.23,
          creditedBills: [
            { key: "b1", title: "Emergency Jobs Act", component: "unemployment", weight: 1 },
            { key: "b2", title: "Relief Payments Act", component: "poverty", weight: 0.5 },
          ],
        }}
      />
    );
    expect(screen.getByText(/soften the penalty by 23%/)).toBeTruthy();
    expect(screen.getByText("Emergency Jobs Act")).toBeTruthy();
    expect(screen.getByText("Relief Payments Act")).toBeTruthy();
  });

  it("hides the response-credit line when nothing was forgiven", () => {
    render(<NationalMoodGauge data={PENALTY} />);
    expect(screen.queryByText(/soften the penalty/)).toBeNull();
  });

  it("falls back to a generic label when the incumbent party is unknown", () => {
    render(
      <NationalMoodGauge
        data={{
          ...PENALTY,
          incumbentPartyId: undefined,
          incumbentPartyName: undefined,
          incumbentPartyColor: undefined,
        }}
      />
    );
    expect(screen.getByText(/Toward the incumbent party/)).toBeTruthy();
  });
});
