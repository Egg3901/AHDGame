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

  it("describes campaigners as Build Org spenders, not NPP Management (ticket #1028)", () => {
    render(<PartyCampaignersCard party={makeParty()} countryCode="US" onUpdate={vi.fn()} />);
    expect(screen.getByText(/spend national Political Strength to Build Org/i)).toBeTruthy();
    expect(screen.getByText(/NPP Management \(Influence Actions\)/i)).toBeTruthy();
    expect(screen.queryByText(/use NPP Influence Actions/i)).toBeNull();
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
