/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/contexts/RegisteredCountriesContext", () => ({
  useRegisteredCountries: () => ["US", "UK", "RU"],
}));

vi.mock("@/components/PlayerSelector", () => ({
  PlayerSelector: () => null,
}));

const UK_REGIONS = [
  { id: "SEE", name: "South East England" },
  { id: "LON", name: "London" },
];

const US_STATES = [
  { id: "NY", name: "New York" },
  { id: "CA", name: "California" },
];

function mockStatesApi() {
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = String(input).toLowerCase();
    if (url.includes("/api/country/uk/states")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ states: UK_REGIONS }) });
    }
    if (url.includes("/api/country/us/states")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ states: US_STATES }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ states: [] }) });
  }) as unknown as typeof fetch;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CharacterStateManager — Change Home Region", () => {
  it("populates the region list from the selected country, not a hardcoded US table", async () => {
    mockStatesApi();
    const { CharacterStateManager } = await import("./CharacterStateManager");
    render(<CharacterStateManager />);

    const regionSelect = await screen.findByLabelText(/New Home (State|Region)/i);
    await waitFor(() => {
      expect(within(regionSelect).getByRole("option", { name: /New York/ })).toBeTruthy();
    });

    // Sourced from the API, so it holds exactly what the API returned — not the
    // 50-entry hardcoded table this component used to carry.
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/api/country/US/states"));
    expect(within(regionSelect).queryByRole("option", { name: /Wyoming/ })).toBeNull();
  });

  it("offers UK regions once the country is switched to the United Kingdom", async () => {
    mockStatesApi();
    const { CharacterStateManager } = await import("./CharacterStateManager");
    render(<CharacterStateManager />);

    const countrySelect = await screen.findByLabelText(/^Country$/i);
    fireEvent.change(countrySelect, { target: { value: "UK" } });

    const regionSelect = await screen.findByLabelText(/New Home (State|Region)/i);
    await waitFor(() => {
      expect(within(regionSelect).getByRole("option", { name: /South East England/ })).toBeTruthy();
    });
    // The US-only hardcoded list must be replaced, not merely supplemented.
    expect(within(regionSelect).queryByRole("option", { name: /New York/ })).toBeNull();
  });
});

describe("CharacterStateManager — Change Home Country", () => {
  /**
   * The region picker used to render only when the target country was the US
   * (`countryHasStates(id) => id === "US"`), so relocating anyone to any other
   * country sent no `homeState` at all. `update-country` then falls back to
   * `character.homeState` — the player's OLD country's region — and its
   * `{ _id, countryId }` lookup could never match, so the move always 400'd.
   */
  it("offers a region to land in when moving a player to a non-US country", async () => {
    mockStatesApi();
    const { CharacterStateManager } = await import("./CharacterStateManager");
    render(<CharacterStateManager />);

    const countrySelect = await screen.findByLabelText(/^New Country$/i);
    fireEvent.change(countrySelect, { target: { value: "UK" } });

    const regionSelect = await screen.findByLabelText(/^Home Region$/i);
    await waitFor(() => {
      expect(within(regionSelect).getByRole("option", { name: /South East England/ })).toBeTruthy();
    });
  });
});
