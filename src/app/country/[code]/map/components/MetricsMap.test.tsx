/** @vitest-environment happy-dom */
import { fireEvent, render, screen, waitFor, cleanup, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../messages/en/elections.json";
import type { MapOverviewResponse } from "@/lib/map/overviewTypes";
import type { MapMetricsResponse } from "@/lib/map/metricTypes";
import { MetricsMap } from "./MetricsMap";
vi.mock("next/dynamic", () => ({
  default:
    () =>
    ({ onRegionClick }: { onRegionClick: (id: string) => void }) => (
      <button onClick={() => onRegionClick("CA")}>Select California</button>
    ),
}));
vi.mock("./AtlasPanels", () => ({ OfficeholderCard: () => null }));
const overview: MapOverviewResponse = {
  regions: [
    { id: "CA", name: "California", population: 100, seats: 5, grouping: "West" },
    { id: "TX", name: "Texas", population: 200, seats: 3, grouping: "South" },
  ],
  house: {},
  senate: {},
  governor: {},
  partyOrg: {},
  approval: {},
  lean: {},
  presidential: {},
};
const payload: MapMetricsResponse = {
  definitions: [
    {
      id: "gdp",
      name: "State GDP",
      category: "economy",
      description: "GDP in dollars",
      prefix: "$",
      suffix: "",
      decimals: 0,
      source: "state",
    },
    {
      id: "score.health.outcomes",
      name: "Population Health Outcomes",
      category: "health",
      description: "Health performance",
      prefix: "",
      suffix: " / 100",
      decimals: 1,
      source: "score",
    },
  ],
  states: { CA: { gdp: 250_000_000, "score.health.outcomes": 70 }, TX: { gdp: 500_000_000 } },
};
const fetchMock = vi.fn();
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => payload });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function mount() {
  const open = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <MetricsMap mapData={overview} onOpen={open} />
    </NextIntlClientProvider>
  );
  return open;
}
describe("Metrics map", () => {
  it("compares actual state values, sorts the chosen metric and never navigates implicitly", async () => {
    const open = mount();
    await screen.findByRole("button", { name: "Select California" });
    fireEvent.click(screen.getByRole("button", { name: "Select California" }));
    expect(screen.getByText("$250,000,000")).toBeTruthy();
    expect(open).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Compare with"), { target: { value: "TX" } });
    expect(screen.getAllByText("$500M").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Data table" }));
    const rows = screen.getAllByRole("row");
    expect(within(rows[1]).getByText("Texas")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open state page" }));
    expect(open).toHaveBeenCalledWith("CA");
  });
  it("finds a metric by category/search, labels scores honestly, and retains missing values", async () => {
    mount();
    await screen.findByRole("button", { name: "Select California" });
    fireEvent.click(screen.getByText("Browse metrics"));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search metrics..." }), {
      target: { value: "health" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Population Health Outcomes/ }));
    expect(
      screen.getByText("Performance score out of 100, not a percentage or a physical measurement.")
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Data table" }));
    const rows = screen.getAllByRole("row");
    expect(within(rows[1]).getByText("70 / 100")).toBeTruthy();
    expect(within(rows[2]).getAllByText("Not available")).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem("ahd-us-metric-map-v1")!).metricId).toBe(
      "score.health.outcomes"
    );
  });
  it("retries a failed request and aborts on unmount", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    mount();
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("button", { name: "Select California" });
    const signal = fetchMock.mock.calls[1][1].signal;
    cleanup();
    expect(signal.aborted).toBe(true);
  });
  it("restores a saved metric only when available", async () => {
    localStorage.setItem(
      "ahd-us-metric-map-v1",
      JSON.stringify({ metricId: "score.health.outcomes" })
    );
    mount();
    await waitFor(() =>
      expect(
        screen.getByText(
          "Performance score out of 100, not a percentage or a physical measurement."
        )
      ).toBeTruthy()
    );
  });
});
