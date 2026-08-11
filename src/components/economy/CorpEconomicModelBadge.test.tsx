/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { CorpEconomicModelBadge } from "./CorpEconomicModelBadge";
import type { EconomicModelView } from "@/lib/economicModels/present";

const view = (over: Partial<EconomicModelView> = {}): EconomicModelView => ({
  current: "militaryIndustrial",
  currentName: "Military-Industrial Complex",
  intensity: 100,
  band: "Dominant",
  signatureSectors: [],
  ...over,
});

function mockFetch(v: EconomicModelView | null) {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        v ? { ok: true, json: async () => v } : { ok: false, status: 404, json: async () => ({}) }
      )
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CorpEconomicModelBadge", () => {
  it("shows Favored + a positive margin for an aligned (primary) sector", async () => {
    mockFetch(view());
    render(<CorpEconomicModelBadge countryId="US" sectorType="defense" />);
    await waitFor(() => expect(screen.getByText(/Favored under/)).toBeTruthy());
    expect(screen.getByText(/\+8% margin/)).toBeTruthy();
  });

  it("shows Disfavored + a negative margin for an off-model sector", async () => {
    mockFetch(view());
    render(<CorpEconomicModelBadge countryId="US" sectorType="agriculture" />);
    await waitFor(() => expect(screen.getByText(/Disfavored under/)).toBeTruthy());
    expect(screen.getByText(/-2% margin/)).toBeTruthy();
  });

  it("renders nothing when the country has no model (404)", async () => {
    mockFetch(null);
    const { container } = render(<CorpEconomicModelBadge countryId="US" sectorType="defense" />);
    await waitFor(() => expect(container.querySelector("span")).toBeNull());
  });

  it("renders nothing for a Mixed economy (neutral)", async () => {
    mockFetch(view({ current: "mixed", currentName: "Mixed / Balanced Economy", band: "Mixed" }));
    const { container } = render(<CorpEconomicModelBadge countryId="US" sectorType="defense" />);
    // wait a tick for the fetch microtask, then assert nothing rendered
    await waitFor(() => expect(container.querySelector("span")).toBeNull());
  });
});
