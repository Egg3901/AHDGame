/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { primaryMetricById } from "@/lib/resetMetrics/catalog";
import { ResetMetricsPage } from "./ResetMetricsPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function metric(id: string, value: number) {
  const definition = primaryMetricById(id)!;
  return {
    ...definition,
    observation: {
      metricId: id,
      path: definition.path,
      value,
      status: "proxy",
      source: "1991 game-calibrated fixture",
      owner: definition.owner,
      note: "Opening estimate, not a historical observation.",
    },
  };
}

describe("v2 metrics page", () => {
  it("shows the world-bound national and regional boards with descriptors", async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes("?region=")
          ? {
              version: "v2",
              countryId: "US",
              scope: "regional",
              regionId: "CT",
              asOfTurn: 1,
              metrics: [metric("01", 5)],
            }
          : {
              version: "v2",
              countryId: "US",
              scope: "national",
              regionId: null,
              asOfTurn: 1,
              metrics: [metric("07", 3)],
            },
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ResetMetricsPage country="US" />);
    expect(await screen.findByText("National conditions")).toBeTruthy();
    expect(screen.getByText("Connecticut conditions")).toBeTruthy();
    expect(screen.getByText("As of turn 1")).toBeTruthy();
    expect(screen.getAllByText("Game-calibrated proxy")).toHaveLength(2);
    expect(screen.getByText("A balanced range is preferred")).toBeTruthy();
    expect(screen.getByText("Lower is generally better")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows an error instead of silently falling back to v1", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503 }))
    );
    render(<ResetMetricsPage country="UK" />);
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("temporarily unavailable")
    );
    expect(screen.queryByText("National conditions")).toBeNull();
  });
});
