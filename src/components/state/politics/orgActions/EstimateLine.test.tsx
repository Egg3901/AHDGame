/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EstimateLine } from "./EstimateLine";

describe("EstimateLine", () => {
  it("renders a labelled build estimate", () => {
    render(
      <EstimateLine label="Build" costPS={5} gain={{ sign: "+", value: 1.25, unit: "Org" }} />
    );
    expect(screen.getByText(/Build: Est\. 5 PS · \+1\.25 Org/)).toBeTruthy();
  });

  it("renders a contest estimate with a suffix", () => {
    render(
      <EstimateLine
        label="Contest"
        tone="contest"
        costPS={6}
        gain={{ sign: "−", value: 0.8, unit: "Org" }}
        suffix="vs SSP"
      />
    );
    expect(screen.getByText(/Contest: Est\. 6 PS · −0\.80 Org vs SSP/)).toBeTruthy();
  });

  it("omits the label prefix when no label is given", () => {
    render(<EstimateLine costPS={5} gain={{ sign: "+", value: 1, unit: "Org" }} />);
    expect(screen.getByText(/^Est\. 5 PS · \+1\.00 Org$/)).toBeTruthy();
  });

  // Build Org costs money as well as PS from 2026-09-02; a line that shows only
  // the PS understates the price on the compact surfaces.
  it("shows the cash cost alongside the PS in the country's currency", () => {
    render(
      <EstimateLine
        label="Build"
        costPS={2}
        costCash={{ amount: 5625, currencyCode: "GBP" }}
        gain={{ sign: "+", value: 1.25, unit: "Org" }}
      />
    );
    expect(screen.getByText(/Build: Est\. 2 PS · £5,625 · \+1\.25 Org/)).toBeTruthy();
  });

  it("omits the cash segment for an action that costs no money", () => {
    render(<EstimateLine costPS={5} gain={{ sign: "+", value: 1, unit: "Org" }} />);
    expect(screen.getByText(/^Est\. 5 PS · \+1\.00 Org$/)).toBeTruthy();
  });
});
