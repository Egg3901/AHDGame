/** @vitest-environment happy-dom */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MinisterialOrderPanel } from "./MinisterialOrderPanel";

vi.mock("@/components/ui", () => ({ Button: (p: any) => <button {...p} /> }));
vi.mock("@/contexts/useGameClock", () => ({
  useGameClock: () => ({ formatRemainingTurns: () => ({ text: "" }) }),
}));

afterEach(cleanup);

const base = {
  activeOrders: [],
  actionsRemaining: 2,
  canAct: true,
  positionId: "secretary_of_state",
  countryCode: "us",
  singleRegionFocus: null,
  regionData: [{ regionId: "US-CA", regionName: "California" }],
  onUpdate: () => {},
};

describe("MinisterialOrderPanel scope badge", () => {
  it("national order: 'National' badge and no region selector", () => {
    render(
      <MinisterialOrderPanel
        {...base}
        orders={[
          {
            id: "o1",
            name: "Diplomatic Offensive",
            description: "d",
            duration: 48,
            effects: [{ scope: "national" }],
          },
        ]}
      />
    );
    expect(screen.getByText("National")).toBeTruthy();
    expect(screen.queryByText("- Region -")).toBeNull();
  });

  it("regional order: 'Regional' badge and a region selector", () => {
    render(
      <MinisterialOrderPanel
        {...base}
        orders={[
          {
            id: "o2",
            name: "Local Drive",
            description: "d",
            duration: 48,
            effects: [{ scope: "regional" }],
          },
        ]}
      />
    );
    expect(screen.getByText("Regional")).toBeTruthy();
    expect(screen.getByText("- Region -")).toBeTruthy();
  });
});
