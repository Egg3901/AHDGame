/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { UnionsClient } from "./UnionsClient";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ code: "us" }),
}));

vi.mock("@/contexts/RegisteredCountriesContext", () => ({
  useActivePreset: () => "1953-default",
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('UnionsClient, labourSystemMode below "full"', () => {
  it("shows a clear not-enabled state instead of a broken error page with fake stats", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Player-run unions are not enabled." }), {
        status: 403,
        headers: { "content-type": "application/json" },
      })
    ) as unknown as typeof fetch;

    render(<UnionsClient />);

    await waitFor(() =>
      expect(screen.getByText("Unions aren't live in this world yet")).toBeTruthy()
    );

    // The old bug: a stats bar claiming real numbers, and copy asserting
    // unions already exist everywhere, rendered directly above an error.
    expect(screen.queryByText("Led")).toBeNull();
    expect(screen.queryByText(/already has a union/)).toBeNull();
    expect(screen.queryByText("Couldn't load unions")).toBeNull();
  });
});

describe('UnionsClient, labourSystemMode at "full"', () => {
  it("still shows the normal country-scoped chrome when the feature is enabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ unions: [], bannedCountries: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<UnionsClient />);

    await waitFor(() => expect(screen.getByText("Led")).toBeTruthy());
    expect(screen.getByText(/already has a union/)).toBeTruthy();
    expect(screen.queryByText("Unions aren't live in this world yet")).toBeNull();
    // Country scoping: the request carries the route country and the header
    // names the nation.
    // Upper-case: the API matches country ids exactly, and an unmatched code
    // falls back to "every country in the world".
    expect(fetchMock).toHaveBeenCalledWith("/api/unions/leaderboard?country=US");
    expect(screen.getByText("United States Unions")).toBeTruthy();
    // Era context chip from the active preset.
    expect(screen.getByText("1953 era")).toBeTruthy();
  });

  it("renders union rows with sector context and abbreviation badge", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          unions: [
            {
              unionId: "u1",
              name: "United Auto Workers",
              countryId: "US",
              countryName: "United States",
              sectorLabel: "Automobiles",
              leaderName: "Walter Reuther",
              isVacant: false,
              members: 42500,
              approval: 61,
              treasury: 1250,
              demandedWageLevel: 1.25,
            },
          ],
          bannedCountries: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    ) as unknown as typeof fetch;

    render(<UnionsClient />);

    await waitFor(() => expect(screen.getByText("United Auto Workers")).toBeTruthy());
    expect(screen.getByText("Automobiles")).toBeTruthy();
    expect(screen.getByText("UAW")).toBeTruthy();
    expect(screen.getByText("Walter Reuther")).toBeTruthy();
    // Membership, Approval, and Funds columns: thousands separator and %.
    expect(screen.getByText("42,500")).toBeTruthy();
    expect(screen.getByText("61%")).toBeTruthy();
    expect(screen.getByText("1,250")).toBeTruthy();
  });

  it("shows total membership, average approval, and total funds in the header strip", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          unions: [
            {
              unionId: "u1",
              name: "United Auto Workers",
              countryId: "US",
              countryName: "United States",
              sectorLabel: "Automobiles",
              leaderName: "Walter Reuther",
              isVacant: false,
              members: 40000,
              approval: 60,
              treasury: 1000,
              demandedWageLevel: null,
            },
            {
              unionId: "u2",
              name: "Steelworkers Guild",
              countryId: "US",
              countryName: "United States",
              sectorLabel: "Manufacturing",
              leaderName: null,
              isVacant: true,
              members: 10000,
              approval: 40,
              treasury: 500,
              demandedWageLevel: null,
            },
          ],
          bannedCountries: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    ) as unknown as typeof fetch;

    render(<UnionsClient />);

    await waitFor(() => expect(screen.getByText("Total Membership")).toBeTruthy());
    expect(screen.getByText("50,000")).toBeTruthy();
    expect(screen.getByText("Avg Approval")).toBeTruthy();
    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.getByText("Total Funds")).toBeTruthy();
    expect(screen.getByText("1,500")).toBeTruthy();
  });
});
