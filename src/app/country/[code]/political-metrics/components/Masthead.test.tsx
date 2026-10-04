/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Masthead } from "./Masthead";

afterEach(cleanup);

function renderMasthead(overrides: Partial<Parameters<typeof Masthead>[0]> = {}) {
  const onCompare = vi.fn();
  const { container } = render(
    <Masthead
      countryId="US"
      countryDisplayName="United States"
      overall={58.4}
      overallStatus="Stable"
      year={2019}
      turn={1}
      onCompare={onCompare}
      compareLabel="⇄ Compare countries"
      {...overrides}
    />
  );
  return { onCompare, container };
}

describe("Masthead", () => {
  it("names the country as the page title", () => {
    renderMasthead();
    expect(screen.getByRole("heading", { level: 1, name: "United States" })).toBeTruthy();
  });

  it("keeps the registry readout around the title", () => {
    renderMasthead();
    expect(screen.getByText("Executive Office · National Situation Registry")).toBeTruthy();
    expect(screen.getByText(/LIVE · SERIES 2019/)).toBeTruthy();
    expect(screen.getByText("TURN 1")).toBeTruthy();
    expect(screen.getByText("DEPT OF NATIONAL STATISTICS")).toBeTruthy();
  });

  it("leads with the overall condition as a figure, its outlined status tag and its meaning", () => {
    renderMasthead();
    const figure = screen.getByText("58");
    expect(figure.className).toContain("text-5xl");
    expect(screen.getByText("/100")).toBeTruthy();
    const tag = screen.getByText("STABLE");
    expect(tag.className).toContain("border");
    expect(tag.className).toContain("font-mono");
    expect(screen.getByText(/the mean of the nine category scores, out of 100/)).toBeTruthy();
  });

  it("tones the figure and the tag by the score band", () => {
    renderMasthead();
    expect(screen.getByText("58").className).toContain("text-success-muted");
    expect(screen.getByText("STABLE").className).toContain("border-success-muted");
    cleanup();
    renderMasthead({ overall: 47, overallStatus: "Strained" });
    expect(screen.getByText("47").className).toContain("text-warning");
    expect(screen.getByText("STRAINED").className).toContain("border-warning");
    cleanup();
    renderMasthead({ overall: 18, overallStatus: "Critical" });
    expect(screen.getByText("CRITICAL").className).toContain("text-error");
  });

  it("opens the comparison from its button", () => {
    const { onCompare } = renderMasthead();
    fireEvent.click(screen.getByRole("button", { name: "⇄ Compare countries" }));
    expect(onCompare).toHaveBeenCalledTimes(1);
  });

  it("falls back to the plain compare label", () => {
    renderMasthead({ compareLabel: undefined });
    expect(screen.getByRole("button", { name: "⇄ Compare" })).toBeTruthy();
  });

  it("sets nothing under 12px", () => {
    const { container } = renderMasthead();
    expect(container.innerHTML).not.toMatch(/text-body-xs|text-\[(?:[0-9]|1[01])px\]/);
  });

  it("names a region's registry and compares it with the national figure", () => {
    renderMasthead({
      countryDisplayName: "Georgia",
      overall: 67.6,
      registryLabel: "Georgia · State situation registry",
      sealLabel: "United States · State",
      glyph: "GA",
      comparison: { label: "national", value: 70 },
    });
    expect(screen.getByRole("heading", { level: 1, name: "Georgia" })).toBeTruthy();
    expect(screen.getByText("Georgia · State situation registry")).toBeTruthy();
    expect(screen.getByText("United States · State")).toBeTruthy();
    // 67.6 shows as 68 and 70.0 as 70, so the delta beside them reads -2, not -2.4.
    expect(screen.getByText("68")).toBeTruthy();
    expect(screen.getByText(/national 70/)).toBeTruthy();
    const delta = screen.getByText("(-2)");
    expect(delta.className).toContain("text-error");
    expect(screen.queryByText("(-2.4)")).toBeNull();
    // The glyph badge did not come back; the name is the title.
    expect(screen.queryByText("GA")).toBeNull();
  });
});
