/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { HistorySparkline } from "./HistorySparkline";
import { ModifiersPanel } from "./ModifiersPanel";

afterEach(cleanup);

describe("ModifiersPanel", () => {
  it("lists law rows with signed points, the structural row, target, and direction", () => {
    render(
      <ModifiersPanel
        modifiers={{
          laws: [
            {
              lawId: "uk.health.universalCare.primary",
              title: "National Health Service Act",
              levelName: "Universal Comprehensive Service",
              level: 4,
              points: 50,
            },
          ],
          regionalLaws: [],
          cabinet: 0,
          labour: 0,
          cabinetBySource: [],
          cabinetAtCap: false,
          cabinetCap: 8,
          driftHalfLifeTurns: 34,
          residual: -12.3,
          target: 74,
          direction: "up",
        }}
      />
    );
    expect(screen.getByText("National Health Service Act")).toBeTruthy();
    expect(screen.getByText("+50")).toBeTruthy();
    expect(screen.getByText("Structural conditions")).toBeTruthy();
    expect(screen.getByText("−12.3")).toBeTruthy();
    expect(screen.getByText("74")).toBeTruthy();
    expect(screen.getByText("▲ rising")).toBeTruthy();
  });
});

describe("HistorySparkline", () => {
  it("renders a polyline and endpoint labels for two or more points", () => {
    const { container } = render(
      <HistorySparkline
        points={[
          { turn: 24, value: 61.2 },
          { turn: 48, value: 62.8 },
        ]}
      />
    );
    expect(container.querySelector("polyline")).toBeTruthy();
    expect(screen.getByText(/Turn 24/)).toBeTruthy();
    expect(screen.getByText("62.8")).toBeTruthy();
  });

  it("renders nothing for fewer than two points", () => {
    const { container } = render(<HistorySparkline points={[{ turn: 24, value: 61.2 }]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("ModifiersPanel cabinet attribution (ticket #1142)", () => {
  // The reporter saw a negative "Cabinet, orders and estates" line on a US
  // infrastructure metric and asked which cabinet action could be doing it. On
  // prod the answer was the energy channel alone, saturated by a units bug that
  // is now fixed. The panel has to be able to say that.
  const MODIFIERS = {
    laws: [],
    regionalLaws: [],
    labour: 0,
    residual: 0,
    cabinet: -1.5,
    cabinetBySource: [{ source: "energy" as const, value: -1.5, atCap: true }],
    cabinetAtCap: false,
    cabinetCap: 8,
    driftHalfLifeTurns: 34,
    target: 60,
    direction: "down" as const,
  };

  it("names the channel instead of one aggregate label", () => {
    render(<ModifiersPanel modifiers={MODIFIERS} />);
    expect(screen.getByText("Energy estates")).toBeTruthy();
  });

  it("marks a channel sitting at its own ceiling", () => {
    render(<ModifiersPanel modifiers={MODIFIERS} />);
    expect(screen.getByText("at ceiling")).toBeTruthy();
  });

  it("omits channels that contribute nothing", () => {
    render(<ModifiersPanel modifiers={MODIFIERS} />);
    expect(screen.queryByText("Ministerial orders")).toBeNull();
    expect(screen.queryByText("Estates")).toBeNull();
  });
});

describe("ModifiersPanel — region-scope channels", () => {
  const BASE = {
    laws: [],
    regionalLaws: [],
    residual: 0,
    cabinet: 0,
    labour: 0,
    cabinetBySource: [],
    cabinetAtCap: false,
    cabinetCap: 8,
    driftHalfLifeTurns: 34,
    target: 50,
    direction: "flat" as const,
  };

  it("lists the region's own programmes under their own heading", () => {
    render(
      <ModifiersPanel
        modifiers={{
          ...BASE,
          regionalLaws: [
            {
              lawId: "us.infrastructure.transit.primary",
              title: "State Transit Authority Act",
              levelName: "Regional Network",
              level: 4,
              points: 25,
            },
          ],
        }}
      />
    );
    expect(screen.getByText("Regional programmes")).toBeTruthy();
    expect(screen.getByText("State Transit Authority Act")).toBeTruthy();
    // Halved from the raw 50-point ladder, so the rows reconcile with the target.
    expect(screen.getByText("+25")).toBeTruthy();
  });

  it("hides the regional heading at national scope", () => {
    render(<ModifiersPanel modifiers={BASE} />);
    expect(screen.queryByText("Regional programmes")).toBeNull();
  });

  it("surfaces the labour-relations channel when it is moving the target", () => {
    render(<ModifiersPanel modifiers={{ ...BASE, labour: -1.5 }} />);
    expect(screen.getByText("Labour relations")).toBeTruthy();
    expect(screen.getByText("−1.5")).toBeTruthy();
  });

  it("omits the labour row when the channel contributes nothing", () => {
    render(<ModifiersPanel modifiers={BASE} />);
    expect(screen.queryByText("Labour relations")).toBeNull();
  });

  it("names the figure as the law-and-structure target, not the engine's full target", () => {
    render(<ModifiersPanel modifiers={BASE} />);
    // The engine also applies macro and service-delivery terms that are never
    // persisted, so calling this "Target" would overclaim.
    expect(screen.getByText(/Law and structure target/)).toBeTruthy();
    expect(screen.getByText(/not included in the figure above/)).toBeTruthy();
  });
});
