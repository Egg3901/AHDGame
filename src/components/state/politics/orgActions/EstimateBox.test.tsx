/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EstimateBox } from "./EstimateBox";
import type { BuildOrgFactors } from "@/components/state/politics/FactorBreakdown";

const FACTORS: BuildOrgFactors = {
  base: 2,
  headroom: 0.5,
  ownDiminishing: 0.5,
  psLeverage: 1,
  catchup: 1,
};

describe("EstimateBox", () => {
  it("renders Build projection with Cost/Org gain and ladder subtext", () => {
    render(
      <EstimateBox
        variant="projection"
        tone="build"
        cost={{ effectivePS: 7, basePS: 5, ladderPS: 2 }}
        gain={{ label: "Estimated Gain", value: 1.25, sign: "+", unit: "Org" }}
        factors={FACTORS}
      />
    );
    expect(screen.getByText("This click")).toBeTruthy();
    expect(screen.getByText("Cost")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText(/base 5 \+ ladder 2/)).toBeTruthy();
    expect(screen.getByText("Org gain")).toBeTruthy();
    expect(screen.getByText(/\+1\.25/)).toBeTruthy();
  });

  it("hides the ladder subtext when ladderPS is 0", () => {
    render(
      <EstimateBox
        variant="projection"
        tone="build"
        cost={{ effectivePS: 5, basePS: 5, ladderPS: 0 }}
        gain={{ label: "Estimated Gain", value: 1, sign: "+", unit: "Org" }}
        factors={FACTORS}
      />
    );
    expect(screen.queryByText(/ladder \d/)).toBeNull();
    expect(screen.getByText(/Base cost/i)).toBeTruthy();
  });

  it("renders Contest with a negative effect and floor-clamped note", () => {
    render(
      <EstimateBox
        variant="projection"
        tone="contest"
        cost={{ effectivePS: 6, basePS: 5, ladderPS: 1 }}
        gain={{ label: "Estimated Effect", value: 0.8, sign: "−", unit: "Org", clamped: true }}
        factors={FACTORS}
      />
    );
    expect(screen.getByText("Effect")).toBeTruthy();
    expect(screen.getByText(/−0\.80/)).toBeTruthy();
    expect(screen.getByText(/Floor-clamped/i)).toBeTruthy();
  });

  it("uses last-click labels for the last variant", () => {
    render(
      <EstimateBox
        variant="last"
        tone="build"
        cost={{ effectivePS: 5, basePS: 5, ladderPS: 0 }}
        gain={{ label: "Gain", value: 1, sign: "+", unit: "Org" }}
        factors={FACTORS}
      />
    );
    expect(screen.getByText("Last click")).toBeTruthy();
    expect(screen.getByText("Cost")).toBeTruthy();
  });

  it("hides the funds row when no funds prop is given, shows it when present", () => {
    const { rerender } = render(
      <EstimateBox
        variant="projection"
        tone="build"
        cost={{ effectivePS: 5, basePS: 5, ladderPS: 0 }}
        gain={{ label: "Estimated Gain", value: 1, sign: "+", unit: "Org" }}
        factors={FACTORS}
      />
    );
    expect(screen.queryByText("Estimated Funds")).toBeNull();
    rerender(
      <EstimateBox
        variant="projection"
        tone="build"
        cost={{ effectivePS: 5, basePS: 5, ladderPS: 0 }}
        funds={{ amount: 1000, currencyCode: "USD" }}
        gain={{ label: "Estimated Gain", value: 1, sign: "+", unit: "Org" }}
        factors={FACTORS}
      />
    );
    expect(screen.getByText("Estimated Funds")).toBeTruthy();
  });
});
