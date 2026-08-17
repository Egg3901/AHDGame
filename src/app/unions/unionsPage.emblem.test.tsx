/**
 * @vitest-environment happy-dom
 */
/**
 * Guards the union leaderboard's emblem contract: a union with a verified free
 * logo renders it, a union without one falls back to the sector emblem rather
 * than borrowing someone else's mark. Also pins that membership (a real
 * headcount) and approval have replaced the retired Organizing score here.
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
    members: 1650,
    approval: 35,
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
    members: 7200,
    approval: 72,
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
  it("shows the real FDGB emblem, no borrowed logo for the AEU, and real membership/approval", async () => {
    const { container } = render(<UnionsPage />);
    await waitFor(() => expect(screen.getByText("Amalgamated Engineering Union")).toBeTruthy());

    const imgs = [...container.querySelectorAll("img")].map((i) => i.getAttribute("src") ?? "");
    // FDGB has a verified free emblem.
    expect(imgs.some((s) => s.includes("FDGB_Emblem.svg"))).toBe(true);
    // The British AEU is deliberately excluded (its article carries the
    // Australian union's logo), so exactly one emblem image renders.
    expect(imgs.filter((s) => s.includes("Special:FilePath")).length).toBe(1);

    // Organizing is retired; Membership (headcount) and Approval (%) replace it.
    expect(screen.getByText("Membership")).toBeTruthy();
    expect(screen.getByText("Approval")).toBeTruthy();
    expect(screen.queryByText("Organizing")).toBeNull();
    expect(screen.getByText("1,650")).toBeTruthy();
    expect(screen.getByText("35%")).toBeTruthy();
    expect(screen.getByText("7,200")).toBeTruthy();
    expect(screen.getByText("72%")).toBeTruthy();
  });
});
