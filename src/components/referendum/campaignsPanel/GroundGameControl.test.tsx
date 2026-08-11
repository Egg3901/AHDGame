/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GroundGameControl } from "./GroundGameControl";

const base = {
  countryId: "UK",
  referendumId: "r1",
  target: "whole" as const,
  targetName: "Whole electorate",
  saturation: 0,
  labels: { yes: "Reunify", no: "Stay in UK" },
};

describe("GroundGameControl", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ yesShare: 55 }) });
  });
  afterEach(() => vi.restoreAllMocks());

  it("renders the preset cards with an icon, mode-keyed cost, and swing on the right", () => {
    const { container, rerender } = render(<GroundGameControl {...base} mode="volunteer" />);
    expect(screen.getByText(/Press conference/)).toBeTruthy();
    expect(screen.getByText(/Mass rally/)).toBeTruthy();
    expect(screen.getAllByText(/AP/).length).toBeGreaterThan(0); // volunteer → Actions
    expect(container.querySelectorAll('[data-ref="gg-icon"]').length).toBe(5); // one per preset
    expect(screen.getByText("≈3.10%")).toBeTruthy(); // mass rally (mobilize) — base-dependent
    expect(screen.getByText("+0.50%")).toBeTruthy(); // press conference (persuade) — exact
    rerender(<GroundGameControl {...base} mode="official" />);
    expect(screen.getAllByText(/PS/).length).toBeGreaterThan(0); // official → PS
  });

  it("shows the targeting + saturation line", () => {
    render(
      <GroundGameControl
        {...base}
        mode="volunteer"
        targetName="Catholic community"
        saturation={0.4}
      />
    );
    expect(screen.getByText(/Catholic community/)).toBeTruthy();
    expect(screen.getByText(/saturation 40%/)).toBeTruthy();
  });

  it("POSTs the chosen preset + target to the ground-game route", () => {
    render(<GroundGameControl {...base} mode="volunteer" />);
    fireEvent.click(screen.getByRole("button", { name: /Mass rally/i }));
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/country/uk/referendum/r1/ground-game",
      expect.objectContaining({ method: "POST" })
    );
  });
});
