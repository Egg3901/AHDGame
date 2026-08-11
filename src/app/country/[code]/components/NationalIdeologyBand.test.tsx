/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { NationalIdeologyBand, type NationalAxesData } from "./NationalIdeologyBand";

// Default: the economic-model route 404s (no model yet) so the E1 field shows
// "Not yet determined". Individual tests override fetch for the model-present case.
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) })
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function makeData(partial?: Partial<NationalAxesData>): NationalAxesData {
  return {
    axes: { economic: -1.2, social: -0.8, lawCount: 23, economicCount: 20, socialCount: 17 },
    movers: [
      {
        typeKey: "health",
        title: "Public Health Insurance Expansion",
        enactedAt: "2026-06-04T00:00:00.000Z",
        enactedYear: 2026,
        economic: -3,
        social: null,
        economicBefore: -1.1,
        economicAfter: -1.2,
        socialBefore: null,
        socialAfter: null,
      },
    ],
    drift: {
      points: [
        {
          enactedAt: "2026-01-01T00:00:00.000Z",
          enactedYear: 2026,
          economicAvg: -1,
          socialAvg: -0.5,
        },
        {
          enactedAt: "2026-06-04T00:00:00.000Z",
          enactedYear: 2026,
          economicAvg: -1.2,
          socialAvg: -0.8,
        },
      ],
    },
    ...partial,
  };
}

describe("NationalIdeologyBand", () => {
  it("renders both axes with bucket labels, provenance, and the movers feed", () => {
    render(<NationalIdeologyBand countryId="US" data={makeData()} loading={false} />);
    expect(screen.getByText("National Ideology")).toBeTruthy();
    expect(screen.getByText("Economic Axis")).toBeTruthy();
    expect(screen.getByText("Social Axis")).toBeTruthy();
    expect(screen.getByText(/23 implemented national laws/)).toBeTruthy();
    expect(screen.getByText("Recently moved the needle")).toBeTruthy();
    expect(screen.getByText("Public Health Insurance Expansion")).toBeTruthy();
    expect(screen.getByText(/avg -1\.1 → -1\.2/)).toBeTruthy();
  });

  it("shows 'Not yet determined' in the E1 field before the model is classified (404)", async () => {
    render(<NationalIdeologyBand countryId="US" data={makeData()} loading={false} />);
    expect(screen.getByText("Economic Model")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Not yet determined")).toBeTruthy());
  });

  it("renders the real economic model name + band in the E1 field when classified", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          current: "agrarian",
          currentName: "Agrarian Economy",
          intensity: 64,
          band: "Established",
          signatureSectors: ["Agriculture", "Extraction & Mining", "Logistics"],
          effects: {
            corpMarginFavoredPct: 5.1,
            corpMarginSecondaryPct: 1.9,
            corpMarginOffModelPct: -1.3,
            sectorGdpWeightPct: 24,
            secondaryGdpWeightPct: 13,
            spendingEfficiencyPct: 12,
            synergies: [{ label: "Food Security", delta: 6.4 }],
          },
        }),
      })
    );
    render(<NationalIdeologyBand countryId="CN" data={makeData()} loading={false} />);
    await waitFor(() => expect(screen.getByText("Agrarian Economy")).toBeTruthy());
    expect(screen.getByText(/Established · 64/)).toBeTruthy();
    // the specific boosted sectors are named with their bonuses
    expect(screen.getByText("Agriculture")).toBeTruthy(); // primary
    expect(screen.getByText("Extraction & Mining, Logistics")).toBeTruthy(); // secondaries
    expect(screen.getByText("+5.1% margin")).toBeTruthy();
    expect(screen.getByText(/Off-model corps/)).toBeTruthy();
    expect(screen.getByText("Food Security")).toBeTruthy();
  });

  it("shows a muted per-axis empty state instead of a fake centered dot", () => {
    render(
      <NationalIdeologyBand
        countryId="US"
        data={makeData({
          axes: { economic: -1.2, social: null, lawCount: 5, economicCount: 5, socialCount: 0 },
          movers: [],
        })}
        loading={false}
      />
    );
    expect(screen.getByText("No positions yet")).toBeTruthy();
    expect(screen.queryByText("Recently moved the needle")).toBeNull();
  });

  it("shows the band-level empty state when no law carries any axis", () => {
    render(
      <NationalIdeologyBand
        countryId="US"
        data={makeData({
          axes: { economic: null, social: null, lawCount: 0, economicCount: 0, socialCount: 0 },
          movers: [],
          drift: { points: [] },
        })}
        loading={false}
      />
    );
    expect(
      screen.getByText(/No implemented national laws carry ideology positions yet/)
    ).toBeTruthy();
    expect(screen.getByText("Economic Model")).toBeTruthy(); // E1 field still renders
  });

  it("renders a skeleton while loading", () => {
    const { container } = render(<NationalIdeologyBand countryId="US" data={null} loading />);
    expect(screen.queryByText("Economic Axis")).toBeNull();
    expect(container.querySelector("[aria-hidden]")).toBeTruthy();
  });

  it("hides the band entirely on fetch failure instead of claiming an empty law book", () => {
    const { container } = render(
      <NationalIdeologyBand countryId="US" data={null} loading={false} />
    );
    expect(container.firstChild).toBeNull();
  });
});
