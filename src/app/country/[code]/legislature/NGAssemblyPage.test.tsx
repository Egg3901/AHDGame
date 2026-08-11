/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { NGAssemblyPage } from "./NGAssemblyPage";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

function jsonResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function membersFor(chamber: string) {
  const seats = chamber === "senate" ? 109 : 360;
  const majorityName = "Social Democratic Party";
  return {
    totalSeats: seats,
    filledSeats: seats,
    vacantSeats: 0,
    composition: [
      {
        partyId: "6",
        partyName: majorityName,
        partyColor: "#0a0",
        economicPosition: -1,
        seats: seats - 40,
      },
      {
        partyId: "7",
        partyName: "National Republican Convention",
        partyColor: "#a00",
        economicPosition: 1,
        seats: 40,
      },
    ],
    members: [
      {
        characterId: "",
        sequentialId: 1,
        characterName: `${majorityName} bloc`,
        constituency: "North West",
        party: "6",
        partyName: majorityName,
        partyColor: "#0a0",
        isNPP: true,
        seatsHeld: seats - 40,
      },
    ],
  };
}

function mockFetch() {
  global.fetch = vi.fn().mockImplementation((url: unknown) => {
    const u = String(url);
    if (u.includes("/members")) {
      const chamber = u.includes("chamber=senate") ? "senate" : "house";
      return Promise.resolve(jsonResponse(membersFor(chamber)));
    }
    if (u.includes("/bills"))
      return Promise.resolve(
        jsonResponse({
          bills: [],
          canPropose: false,
          adminOverride: false,
          total: 0,
          page: 1,
          limit: 20,
        })
      );
    if (u.includes("/leaders"))
      return Promise.resolve(
        jsonResponse({ primeMinister: null, oppositionLeader: null, speaker: null })
      );
    if (u.includes("/presiding-officers"))
      return Promise.resolve(jsonResponse({ speaker: null, senatePresident: null }));
    // Leadership tab: NgChamberLeadershipPanel renders both presiding-officer
    // roles from this endpoint, both vacant here.
    if (u.includes("/ng-chamber-leadership"))
      return Promise.resolve(
        jsonResponse({
          roles: [
            {
              role: "speaker_ng_reps",
              label: "Speaker of the House of Representatives",
              leader: null,
              election: null,
              nominations: [],
              canRun: false,
              eligibilityLabel: "Members of the House of Representatives",
              isMember: false,
            },
            {
              role: "president_ng_senate",
              label: "President of the Senate",
              leader: null,
              election: null,
              nominations: [],
              canRun: false,
              eligibilityLabel: "Senators",
              isMember: false,
            },
          ],
          viewer: { characterId: null, party: null, isAdmin: false },
        })
      );
    return Promise.resolve(jsonResponse({}));
  }) as unknown as typeof fetch;
}

describe("NGAssemblyPage", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders the House composition and toggles to the Senate", async () => {
    mockFetch();
    render(<NGAssemblyPage countryId="NG" />);
    await waitFor(() => expect(screen.getByText("National Assembly")).toBeTruthy());
    await waitFor(() =>
      expect(screen.getAllByText(/House of Representatives/).length).toBeGreaterThan(0)
    );

    screen.getByRole("tab", { name: /Senate/ }).click();
    await waitFor(() => expect(screen.getAllByText(/Senate/).length).toBeGreaterThan(0));
  });

  it("shows both presiding officers as Vacant on the Leadership tab", async () => {
    mockFetch();
    render(<NGAssemblyPage countryId="NG" />);
    await waitFor(() => expect(screen.getByText("National Assembly")).toBeTruthy());
    screen.getByRole("button", { name: "Leadership" }).click();
    const speakerCard = await waitFor(() =>
      screen.getByText("Speaker of the House of Representatives").closest("div")
    );
    const senateCard = screen.getByText("President of the Senate").closest("div");
    expect(within(speakerCard!).getByText("Vacant")).toBeTruthy();
    expect(within(senateCard!).getByText("Vacant")).toBeTruthy();
  });
});
