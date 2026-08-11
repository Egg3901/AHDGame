/**
 * @vitest-environment happy-dom
 */
/**
 * Guards the union leaderboard's emblem contract: a union with a verified free
 * logo renders it, a union without one falls back to the sector emblem rather
 * than borrowing someone else's mark, and the score reads as Organizing.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import UnionsPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  useParams: () => ({}),
}));

const ROWS = [
  {
    unionId: "1",
    name: "Free German Trade Union Federation",
    countryName: "East Germany",
    sectorType: "telecommunications",
    sectorLabel: "Telecommunications",
    leaderName: null,
    isVacant: true,
    membershipPressure: 16.5,
    treasury: 259,
    demandedWageLevel: null,
  },
  {
    unionId: "2",
    name: "Amalgamated Engineering Union",
    countryName: "United Kingdom",
    sectorType: "manufacturing",
    sectorLabel: "Manufacturing",
    leaderName: "Someone",
    isVacant: false,
    membershipPressure: 72,
    treasury: 900,
    demandedWageLevel: null,
  },
];

beforeEach(() => {
  global.fetch = vi.fn(async (url: string) => {
    if (String(url).includes("/api/character/me")) {
      return { ok: false, json: async () => ({}) } as unknown as Response;
    }
    return {
      ok: true,
      json: async () => ({ unions: ROWS, bannedCountries: [], availableCountries: [] }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
});

describe("unions leaderboard render", () => {
  it("shows the real FDGB emblem, no borrowed logo for the AEU, and Organizing bands", async () => {
    const { container } = render(<UnionsPage />);
    await waitFor(() => expect(screen.getByText("Amalgamated Engineering Union")).toBeTruthy());

    const imgs = [...container.querySelectorAll("img")].map((i) => i.getAttribute("src") ?? "");
    // FDGB has a verified free emblem.
    expect(imgs.some((s) => s.includes("FDGB_Emblem.svg"))).toBe(true);
    // The British AEU is deliberately excluded (its article carries the
    // Australian union's logo), so exactly one emblem image renders.
    expect(imgs.filter((s) => s.includes("Special:FilePath")).length).toBe(1);

    expect(screen.getByText("Organizing")).toBeTruthy();
    expect(screen.queryByText("Membership")).toBeNull();
    expect(screen.getByText("Unorganized")).toBeTruthy();
    expect(screen.getByText("Strong")).toBeTruthy();
  });
});
