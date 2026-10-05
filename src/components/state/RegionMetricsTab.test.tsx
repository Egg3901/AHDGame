/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { primaryMetricById } from "@/lib/resetMetrics/catalog";
import { RegionMetricsTab } from "./RegionMetricsTab";

const flags = vi.hoisted(() => ({
  loaded: true,
  failed: false,
  resetSystemVersions: { metrics: "v2", legislation: "v2", cabinet: "v2" },
  resetV2Countries: ["US", "UK", "JP"],
}));

vi.mock("@/hooks/useWorldFlags", () => ({ useWorldFlags: () => flags }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function regionalMetric() {
  const definition = primaryMetricById("01")!;
  return {
    ...definition,
    observation: {
      metricId: definition.id,
      path: definition.path,
      value: 5,
      status: "proxy",
      source: "1991 game-calibrated fixture",
      owner: definition.owner,
      note: "Opening estimate, not a historical observation.",
    },
    temporaryActionEffect: null,
    legislativeEffect: null,
    standingLaws: [],
    conditionScore: 70,
  };
}

describe("RegionMetricsTab", () => {
  it("uses the regional v2 board when metrics v2 is verified", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => ({
      ok: true,
      json: async () =>
        String(input).includes("/01?")
          ? {
              history: [{ turn: 1, value: 5 }],
              nationalValue: 6,
              regions: [
                { regionId: "PA", name: "Pennsylvania", value: 5 },
                { regionId: "NY", name: "New York", value: 6.5 },
                { regionId: "CA", name: "California", value: 4 },
              ],
            }
          : {
              version: "v2",
              countryId: "US",
              scope: "regional",
              regionId: "PA",
              asOfTurn: 1,
              governanceStyle: null,
              metrics: [regionalMetric()],
            },
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<RegionMetricsTab countryId="US" regionId="PA" regionName="Pennsylvania" />);

    expect(await screen.findByRole("heading", { name: "Pennsylvania" })).toBeTruthy();
    expect(screen.getByTestId("stat-masthead")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/country/US/reset-metrics?region=PA",
      expect.objectContaining({ cache: "no-store" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Open Economic" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Unemployment" }));
    expect(await screen.findByText("1 percentage point better than national")).toBeTruthy();
    expect(screen.getByText("2nd of 3 nationally")).toBeTruthy();
    expect(screen.queryByText("Regional breakdown")).toBeNull();
    expect(screen.queryByText("New York")).toBeNull();
  });

  it("fails closed instead of rendering v1 when v2 metadata is incomplete", () => {
    const previous = flags.resetV2Countries;
    flags.resetV2Countries = ["UK", "JP"];
    try {
      render(<RegionMetricsTab countryId="US" regionId="PA" regionName="Pennsylvania" />);
      expect(screen.getByRole("alert")).toHaveProperty(
        "textContent",
        expect.stringContaining("Legacy metrics were not loaded")
      );
    } finally {
      flags.resetV2Countries = previous;
    }
  });

  it("compares a regional v2 board with selected sibling regions", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/01")) {
        return {
          ok: true,
          json: async () => ({
            history: [{ turn: 1, value: 5 }],
            nationalValue: 6,
            regions: [
              { regionId: "PA", name: "Pennsylvania", value: 5 },
              { regionId: "NY", name: "New York", value: 6.5 },
            ],
          }),
        };
      }
      const regionId = url.includes("region=NY") ? "NY" : "PA";
      return {
        ok: true,
        json: async () => ({
          version: "v2",
          countryId: "US",
          scope: "regional",
          regionId,
          asOfTurn: 1,
          governanceStyle: null,
          metrics: [
            {
              ...regionalMetric(),
              observation: {
                ...regionalMetric().observation,
                value: regionId === "NY" ? 6.5 : 5,
              },
            },
          ],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<RegionMetricsTab countryId="US" regionId="PA" regionName="Pennsylvania" />);
    fireEvent.click(await screen.findByRole("button", { name: /Compare/ }));

    expect(await screen.findByText("Compare up to 3 state peers")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "New York" }));
    expect((await screen.findAllByText("New York")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Show Economic metrics" }));
    expect(await screen.findByText("6.5% of labor force")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/country/US/reset-metrics?region=NY",
      expect.objectContaining({ cache: "no-store" })
    );
  });
});
