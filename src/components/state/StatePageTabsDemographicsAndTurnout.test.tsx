/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { DemographicsAndTurnoutTab } from "./StatePageTabsDemographicsAndTurnout";
import type { SerializedStateDemographics, Layer1Config } from "./StatePageTabsTypes";
import type { DemographicCategory } from "@/lib/db/types";

const popPayload = {
  population: 5000000,
  houseDistricts: 6,
  ages: { male: Array(101).fill(4), female: Array(101).fill(4) },
  populationMetrics: {
    populationGrowth: 0.2,
    medianAge: 40,
    sexRatio: 50,
    dependencyRatio: 0.5,
    realizedMigrationRate: 0.1,
  },
  censusSeatChange: null,
};

describe("DemographicsAndTurnoutTab empty-state", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => popPayload } as Response)
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("still renders the live population panel when census/polling data is absent", async () => {
    render(
      <DemographicsAndTurnoutTab
        stateId="XX"
        demographics={null}
        categories={[]}
        censusData={null}
        turnoutData={null}
        countryId="US"
      />
    );
    // Live cohort data is a separate layer from census/polling demographics —
    // it must still surface even when the latter is unconfigured.
    await waitFor(() => expect(screen.getByText(/Live Population/i)).toBeTruthy());
    // The empty-state note clarifies it is the census/polling layer that's absent.
    expect(screen.getByText("No census or polling data")).toBeTruthy();
  });
});

describe("DemographicsAndTurnoutTab electorate dossier", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => popPayload } as Response)
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("renders the electorate dossier from the bucket profile", async () => {
    render(
      <DemographicsAndTurnoutTab
        stateId="PA"
        demographics={
          {
            _id: "PA",
            stateId: "PA",
            categoryWeights: {},
            groups: { g1: { population: 100, economicLean: 1.2, socialLean: -0.8, turnout: 62 } },
            lastUpdated: null,
          } as unknown as SerializedStateDemographics
        }
        categories={
          [
            {
              _id: "voterGroups",
              name: "Voter Groups",
              groups: [
                { id: "g1", name: "Test Archetype", defaultEconomicLean: 1, defaultSocialLean: -1 },
              ],
            },
          ] as unknown as DemographicCategory[]
        }
        censusData={{ race: { white: 60, black: 40 } } as unknown as Layer1Config}
        turnoutData={null}
        countryId="US"
        bucketProfile={[
          {
            dim: "race",
            dimLabel: "Background",
            buckets: [
              {
                id: "race:white",
                label: "White voters",
                sharePct: 60,
                economicLean: 1.2,
                socialLean: -0.8,
                turnout: 62,
              },
              {
                id: "race:black",
                label: "Black voters",
                sharePct: 40,
                economicLean: -2.1,
                socialLean: -1.4,
                turnout: 55,
              },
            ],
          },
        ]}
        regionParties={[
          {
            partyId: "1",
            name: "Democratic",
            abbreviation: "DEM",
            color: "#3b82f6",
            economicPosition: -3,
            socialPosition: -3,
          },
          {
            partyId: "2",
            name: "Republican",
            abbreviation: "GOP",
            color: "#ef4444",
            economicPosition: 3,
            socialPosition: 3,
          },
        ]}
      />
    );
    await waitFor(() => expect(screen.getByText(/Electorate — strategy board/)).toBeTruthy());
    // Bucket labels, not archetype names — the roster row and the dossier heading.
    expect(screen.getAllByText("White voters").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Black voters").length).toBeGreaterThan(0);
    expect(screen.queryByText("Test Archetype")).toBeNull();
    // Real projection band + preferred-party tile render in the default Simple view.
    expect(screen.getByText("State Projection")).toBeTruthy();
    expect(screen.getByText("Leaning toward")).toBeTruthy();
    // Analyst-only detail is hidden until the view toggles.
    expect(screen.queryByText("Economic lean")).toBeNull();
    fireEvent.click(screen.getByText("analyst"));
    expect(screen.getByText("Economic lean")).toBeTruthy();
    expect(screen.getByText("Social lean")).toBeTruthy();
  });

  it("says there is no breakdown yet when the region has no Layer-1 substrate", async () => {
    // The archetype roster used to fill this slot. It described a projection of
    // the electorate, so where there is no substrate the honest answer is that
    // there is nothing to show, not a different set of numbers.
    render(
      <DemographicsAndTurnoutTab
        stateId="PA"
        demographics={
          {
            _id: "PA",
            stateId: "PA",
            categoryWeights: {},
            groups: { g1: { population: 100, economicLean: 1.2, socialLean: -0.8, turnout: 62 } },
            lastUpdated: null,
          } as unknown as SerializedStateDemographics
        }
        categories={
          [
            {
              _id: "voterGroups",
              name: "Voter Groups",
              groups: [
                { id: "g1", name: "Test Archetype", defaultEconomicLean: 1, defaultSocialLean: -1 },
              ],
            },
          ] as unknown as DemographicCategory[]
        }
        censusData={{ race: { white: 60, black: 40 } } as unknown as Layer1Config}
        turnoutData={null}
        countryId="US"
        bucketProfile={null}
      />
    );
    await waitFor(() =>
      expect(screen.getByText(/No electorate breakdown for this region yet/)).toBeTruthy()
    );
    expect(screen.queryByText("Test Archetype")).toBeNull();
    expect(screen.queryByText("Polling Archetypes")).toBeNull();
  });
});
