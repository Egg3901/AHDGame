// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import FreightMarketExplainer from "./FreightMarketExplainer";

describe("FreightMarketExplainer", () => {
  it("explains cargo classes, shared capacity, and why sold percentages differ", () => {
    render(<FreightMarketExplainer />);

    expect(screen.getByText(/one shared service market/i)).toBeTruthy();
    expect(
      screen.getByText(/not separate freight products or reserved capacity pools/i)
    ).toBeTruthy();
    expect(screen.getByText(/three times as much TEU/i)).toBeTruthy();
    expect(
      screen.getByText(/sector's sold percentage shows only the share captured/i)
    ).toBeTruthy();
  });
});
