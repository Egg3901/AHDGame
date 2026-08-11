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
});
