/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BilateralView from "./BilateralView";
import type { WorldTradeLedger } from "@/lib/trade/queries/worldTradeLedger";

const ledger = {
  flows: {
    steel: { US: { CN: 80000 } },
    electronics: { CN: { US: 25000 } },
  },
  meta: {
    countries: [
      { code: "US", name: "United States", hue: "#b9933f" },
      { code: "CN", name: "China", hue: "#d8b25e" },
      { code: "DE", name: "Germany", hue: "#c9a24b" },
    ],
  },
} as unknown as WorldTradeLedger;

describe("BilateralView", () => {
  it("settles the default pair and lists the commodity breakdown", () => {
    render(<BilateralView ledger={ledger} />);
    expect(screen.getByText("net balance")).toBeTruthy();
    expect(screen.getByText("Steel & Metals")).toBeTruthy();
    expect(screen.getByText("Electronics & Semiconductors")).toBeTruthy();
  });

  it("updates the reporter when a chip is clicked", () => {
    render(<BilateralView ledger={ledger} />);
    // Reporter picker is the first group; click its Germany chip.
    const deChips = screen.getAllByRole("button", { name: /DE/ });
    fireEvent.click(deChips[0]);
    expect(deChips[0].getAttribute("aria-pressed")).toBe("true");
  });
});
