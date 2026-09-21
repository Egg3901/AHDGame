/** @vitest-environment happy-dom */
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../messages/en/elections.json";
import { getCountryConfig } from "@/lib/constants/countries";
import type { MapOverviewResponse } from "@/lib/map/overviewTypes";
import { ATLAS_STORAGE_KEY } from "./atlasModel";
import { USMapWithModes } from "./USMapWithModes";

vi.mock("next/dynamic", () => ({
  default:
    () =>
    ({ onRegionClick }: { onRegionClick: (id: string) => void }) => (
      <button onClick={() => onRegionClick("CA")}>Select California on map</button>
    ),
}));
vi.mock("@/components/BackButton", () => ({ default: () => null }));
vi.mock("@/components/Avatar", () => ({
  Avatar: ({ name }: { name: string }) => <span>{name.charAt(0)}</span>,
}));
vi.mock("./useResourceMapData", () => ({ useResourceMapData: () => ({}) }));
vi.mock("./useFreightDemandData", () => ({
  useFreightDemandData: () => ({ states: {}, turn: null }),
}));
vi.mock("./StateLeanPanel", () => ({ StateLeanPanel: () => null }));
const data: MapOverviewResponse = {
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
  electoralVotesByState: { CA: 55, TX: 38, DC: 3 },
  officeholders: {
    CA: [
      {
        id: "governor",
        office: "governor",
        name: "Example Governor",
        avatarUrl: "/portrait.png",
        party: "1",
        partyName: "Example Party",
        color: "#123456",
        seats: 1,
      },
    ],
  },
};
function mount() {
  const open = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <USMapWithModes mapData={data} config={getCountryConfig("US")} onRegionClick={open} />
    </NextIntlClientProvider>
  );
  return open;
}
beforeEach(() => localStorage.clear());
afterEach(cleanup);
describe("US national atlas", () => {
  it("inspects a state in place and only navigates on the explicit state-page action", () => {
    const open = mount();
    fireEvent.change(screen.getByRole("combobox", { name: "Layer" }), {
      target: { value: "governor" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Select California on map" }));
    expect(screen.getByText("Example Governor")).toBeTruthy();
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Open state page/ }));
    expect(open).toHaveBeenCalledWith("CA");
  });
  it("shows electoral allocation even without presidential results", () => {
    mount();
    fireEvent.change(screen.getByRole("combobox", { name: "Layer" }), {
      target: { value: "electoralAllocation" },
    });
    expect(screen.getByText("96 electoral votes · 49 to win")).toBeTruthy();
    expect(screen.getByText("Washington, DC: 3 electoral votes")).toBeTruthy();
    expect(screen.queryByText("Presidential Results")).toBeNull();
  });
  it("filters the table and exposes a no-results state", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Data table" }));
    expect(screen.getAllByRole("row")).toHaveLength(3);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "texas" } });
    expect(screen.getAllByRole("row")).toHaveLength(2);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "missing" } });
    expect(screen.getByText("No states match your search.")).toBeTruthy();
  });
  it("restores the saved display without overwriting it with defaults", async () => {
    localStorage.setItem(
      ATLAS_STORAGE_KEY,
      JSON.stringify({ view: "table", labels: false, charts: false })
    );
    mount();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Data table" }).getAttribute("aria-pressed")).toBe(
        "true"
      )
    );
    expect(
      (screen.getByRole("checkbox", { name: "State labels" }) as HTMLInputElement).checked
    ).toBe(false);
    expect(JSON.parse(localStorage.getItem(ATLAS_STORAGE_KEY)!)).toEqual({
      view: "table",
      labels: false,
      charts: false,
    });
  });
});
