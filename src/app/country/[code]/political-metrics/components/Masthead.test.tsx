/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Masthead } from "./Masthead";

afterEach(cleanup);

function renderMasthead(overrides: Partial<Parameters<typeof Masthead>[0]> = {}) {
  const onCompare = vi.fn();
  render(
    <Masthead
      countryDisplayName="United States"
      overall={58.4}
      overallStatus="Stable"
      year={2019}
      turn={1}
      onCompare={onCompare}
      compareLabel="Compare countries"
      {...overrides}
    />
  );
  return { onCompare };
}

describe("Masthead", () => {
  it("names the country as the page title with a plain date line", () => {
    renderMasthead();
    expect(screen.getByRole("heading", { level: 1, name: "United States" })).toBeTruthy();
    expect(screen.getByText("Political metrics · 2019 · Turn 1")).toBeTruthy();
  });

  it("leads with the overall condition as a figure, its status word and what it means", () => {
    renderMasthead();
    expect(screen.getByText("58")).toBeTruthy();
    expect(screen.getByText("Stable").className).toContain("text-foreground");
    expect(screen.getByText(/the mean of the nine category scores, out of 100/)).toBeTruthy();
  });

  it("colours the status word only when it is bad", () => {
    renderMasthead({ overall: 47, overallStatus: "Strained" });
    expect(screen.getByText("Strained").className).toContain("text-warning");
    cleanup();
    renderMasthead({ overall: 18, overallStatus: "Critical" });
    expect(screen.getByText("Critical").className).toContain("text-error");
  });

  it("prints no registry line, badge or ticker", () => {
    renderMasthead({
      countryId: "US",
      registryLabel: "Executive Office · National Situation Registry",
      glyph: "US",
    });
    expect(screen.queryByText(/Registry/)).toBeNull();
    expect(screen.queryByText(/LIVE/)).toBeNull();
    expect(screen.queryByText("US")).toBeNull();
  });

  it("opens the comparison from its button", () => {
    const { onCompare } = renderMasthead();
    fireEvent.click(screen.getByRole("button", { name: "Compare countries" }));
    expect(onCompare).toHaveBeenCalledTimes(1);
  });

  it("puts a region's country and type ahead of the date line and compares it in words", () => {
    renderMasthead({
      countryDisplayName: "Georgia",
      overall: 71,
      sealLabel: "United States · State",
      comparison: { label: "national", value: 69.6 },
    });
    expect(
      screen.getByText("United States · State · Political metrics · 2019 · Turn 1")
    ).toBeTruthy();
    // 71 against a rounded 70: one point above, worded in the singular.
    expect(screen.getByText("Georgia is 1 point above the national score of 70.")).toBeTruthy();
  });

  it("says when a region matches the national score", () => {
    renderMasthead({
      countryDisplayName: "Georgia",
      overall: 70.2,
      comparison: { label: "national", value: 69.8 },
    });
    expect(screen.getByText("Georgia matches the national score of 70.")).toBeTruthy();
  });
});
