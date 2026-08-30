// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OrderOfBattlePanel, type OrderOfBattleView } from "./OrderOfBattlePanel";

describe("OrderOfBattlePanel", () => {
  it("keeps a long formation list inside a scrollable region", () => {
    const view: OrderOfBattleView = {
      title: "FRIENDLY ORDER OF BATTLE",
      enemyBand: null,
      enemyCountries: [],
      unopposed: false,
      forces: Array.from({ length: 20 }, (_, index) => ({
        id: `unit-${index}`,
        name: `Formation ${index}`,
        type: "Infantry",
        domain: "ground",
        posture: "reserve",
        readiness: 80,
        strengthPct: 100,
      })),
    };

    render(<OrderOfBattlePanel view={view} />);

    const roster = screen.getByTestId("order-of-battle-roster");
    expect(roster.style.maxHeight).toBe("32rem");
    expect(roster.style.overflowY).toBe("auto");
  });
});
