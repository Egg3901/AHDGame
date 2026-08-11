/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { RegimeStabilityPanel } from "../RegimeStabilityPanel";

function mockFetchOk(body: Record<string, unknown>): void {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    json: async () => body,
  });
}

describe("RegimeStabilityPanel", () => {
  beforeEach(() => {
    global.fetch = vi.fn() as unknown as typeof fetch;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders nothing for a non-OPS country (active: false)", async () => {
    mockFetchOk({ active: false });

    const { container } = render(<RegimeStabilityPanel countryCode="US" />);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
    expect(container.querySelector('[data-testid="regime-stability-panel"]')).toBeNull();
  });

  it("renders the band LABEL (not the raw number) for an OPS country", async () => {
    mockFetchOk({
      active: true,
      band: "discontent",
      stage: "discontent",
      underStrain: false,
      recentTransitions: [],
    });

    render(<RegimeStabilityPanel countryCode="CN" />);

    await waitFor(() => {
      expect(screen.getByTestId("regime-band-label").textContent).toMatch(/discontent/i);
    });
    // No raw scalar values in the panel text
    const panel = screen.getByTestId("regime-stability-panel");
    expect(panel.textContent ?? "").not.toMatch(/\b\d+\.\d/);
  });

  it("shows 'Regime under strain' at Stage 3 (internalChallenge)", async () => {
    mockFetchOk({
      active: true,
      band: "crisis",
      stage: "internalChallenge",
      underStrain: true,
      recentTransitions: [],
    });

    render(<RegimeStabilityPanel countryCode="CN" />);

    await waitFor(() => {
      expect(screen.getByTestId("regime-under-strain").textContent).toMatch(/under strain/i);
    });
  });

  it("shows 'Regime under strain' at Stage 4 (collapse)", async () => {
    mockFetchOk({
      active: true,
      band: "collapsing",
      stage: "collapse",
      underStrain: true,
      recentTransitions: [],
    });

    render(<RegimeStabilityPanel countryCode="CN" />);

    await waitFor(() => {
      expect(screen.getByTestId("regime-under-strain")).toBeTruthy();
    });
  });

  it("does NOT show 'Regime under strain' at Stage 1 or 2", async () => {
    mockFetchOk({
      active: true,
      band: "discontent",
      stage: "crisis", // Stage 2
      underStrain: false,
      recentTransitions: [],
    });

    render(<RegimeStabilityPanel countryCode="CN" />);

    await waitFor(() => {
      expect(screen.getByTestId("regime-stability-panel")).toBeTruthy();
    });
    expect(screen.queryByTestId("regime-under-strain")).toBeNull();
  });

  it("renders recent transitions as plain stage-to-stage lines (no turn-number prefix)", async () => {
    mockFetchOk({
      active: true,
      band: "discontent",
      stage: "discontent",
      underStrain: false,
      recentTransitions: [
        { turn: 200, from: "stable", to: "discontent", at: new Date().toISOString(), reason: "x" },
        { turn: 150, from: "discontent", to: "stable", at: new Date().toISOString(), reason: "y" },
      ],
    });

    render(<RegimeStabilityPanel countryCode="CN" />);

    await waitFor(() => {
      expect(screen.getByTestId("regime-recent-transitions")).toBeTruthy();
    });
    const list = screen.getByTestId("regime-recent-transitions");
    // Public-facing list — no diagnostic 'Turn N:' prefix.
    expect(list.textContent ?? "").not.toMatch(/Turn 200/);
    expect(list.textContent ?? "").not.toMatch(/Turn 150/);
    // But the from→to text is still present.
    expect(list.textContent).toMatch(/Stable.*Public discontent/);
  });

  it("renders an in-character flavor blurb under the stage chip when stage is non-stable", async () => {
    mockFetchOk({
      active: true,
      band: "crisis",
      stage: "crisis",
      underStrain: false,
      recentTransitions: [],
    });

    render(<RegimeStabilityPanel countryCode="CN" />);

    await waitFor(() => {
      expect(screen.getByTestId("regime-stage-blurb")).toBeTruthy();
    });
    expect(screen.getByTestId("regime-stage-blurb").textContent).toMatch(/protests/i);
  });

  it("does NOT render the flavor blurb at stage=stable", async () => {
    mockFetchOk({
      active: true,
      band: "strong",
      stage: "stable",
      underStrain: false,
      recentTransitions: [],
    });

    render(<RegimeStabilityPanel countryCode="CN" />);

    await waitFor(() => {
      expect(screen.getByTestId("regime-stability-panel")).toBeTruthy();
    });
    expect(screen.queryByTestId("regime-stage-blurb")).toBeNull();
  });
});
