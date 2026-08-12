/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PartyCampaignersCard } from "./PartyCampaignersCard";
import type { PartyData } from "./types";

function makeParty(overrides: Partial<PartyData> = {}): PartyData {
  return {
    id: "42",
    color: "#2563eb",
    campaigners: [{ id: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Ada Already" }],
    members: [
      { id: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Ada Already", homeState: "CA" },
      { id: "bbbbbbbbbbbbbbbbbbbbbbbb", name: "Ben Newcomer", homeState: "NY" },
      { id: "cccccccccccccccccccccccc", name: "Nia NPP", homeState: "TX", isNPP: true },
    ],
    ...overrides,
  } as unknown as PartyData;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PartyCampaignersCard", () => {
  it("renders the currently-assigned national campaigners", () => {
    render(<PartyCampaignersCard party={makeParty()} countryCode="US" onUpdate={vi.fn()} />);
    expect(screen.getByText("Ada Already")).toBeTruthy();
  });

  // Suggestion #269 widened the seat: Build Org AND NPP Management, in
  // exchange for National Committee confirmation.
  it("describes campaigners as Build Org + NPP Management, with Recruitment excluded", () => {
    render(<PartyCampaignersCard party={makeParty()} countryCode="US" onUpdate={vi.fn()} />);
    expect(screen.getByText(/spend national Political Strength to Build/i)).toBeTruthy();
    expect(screen.getByText(/NPP Management \(Influence Actions and NPP Move\)/i)).toBeTruthy();
    expect(screen.getByText(/Recruitment stays chair \/ vice-chair \/ admin/i)).toBeTruthy();
  });

  it("explains that additions need committee confirmation and removals do not", () => {
    render(<PartyCampaignersCard party={makeParty()} countryCode="US" onUpdate={vi.fn()} />);
    expect(screen.getByText(/opens a National Committee vote/i)).toBeTruthy();
    expect(screen.getByText(/Removing a name takes effect immediately/i)).toBeTruthy();
  });

  it("surfaces the server message after a save (e.g. nominations opened)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        campaignerIds: [],
        message: "Nominated 1 campaigner — the National Committee must confirm.",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PartyCampaignersCard party={makeParty()} countryCode="US" onUpdate={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/Search party members/i), {
      target: { value: "Ben" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Ben Newcomer/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));

    await waitFor(() => expect(screen.getByText(/National Committee must confirm/i)).toBeTruthy());
  });

  it("posts the selected character ids to the national campaigners endpoint on save", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ ok: true, campaignerIds: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    const onUpdate = vi.fn();

    render(<PartyCampaignersCard party={makeParty()} countryCode="US" onUpdate={onUpdate} />);

    // Add a second campaigner via the typeahead.
    fireEvent.change(screen.getByPlaceholderText(/Search party members/i), {
      target: { value: "Ben" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Ben Newcomer/ }));

    // Save.
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/country/us/parties/42/campaigners");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      campaignerIds: ["aaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbbbb"],
    });
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
  });
});
