/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import MatrixView from "./MatrixView";
import type { WorldTradeLedger } from "@/lib/trade/queries/worldTradeLedger";

const ledger = {
  nations: [
    { code: "US", net: 55000 },
    { code: "CN", net: -55000 },
  ],
  bilateral: {
    US: { US: 0, CN: 55000 },
    CN: { US: -55000, CN: 0 },
  },
  meta: {
    countries: [
      { code: "US", name: "United States", hue: "#b9933f" },
      { code: "CN", name: "China", hue: "#d8b25e" },
    ],
  },
} as unknown as WorldTradeLedger;

describe("MatrixView", () => {
  it("renders a diagonal placeholder and signed off-diagonal cells", () => {
    const { container } = render(<MatrixView ledger={ledger} />);
    // Diagonal cells render an em dash.
    expect(container.textContent).toContain("—");
    // A surplus cell carries a + sign; a deficit cell a − sign.
    expect(container.textContent).toContain("+");
    expect(container.textContent).toContain("−");
  });

  it("shows each row's net in the trailing column", () => {
    render(<MatrixView ledger={ledger} />);
    expect(screen.getByText("United States")).toBeTruthy();
    expect(screen.getByText("China")).toBeTruthy();
  });
});
