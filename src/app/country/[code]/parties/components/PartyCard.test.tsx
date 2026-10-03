/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PartyCard } from "./PartyCard";
import type { Party } from "../partiesTypes";

vi.mock("next/image", () => ({ default: () => null }));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    className,
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const PARTY: Party = {
  id: "1",
  countryId: "US",
  name: "Democratic Party",
  abbreviation: "DEM",
  color: "#1d4ed8",
  discordInviteUrl: null,
  economicPosition: -2,
  socialPosition: 0,
  chair: null,
  viceChair: null,
  treasurer: null,
  treasury: 1_250_000,
  memberCount: 120,
  playerCount: 40,
  nppCount: 80,
  isDefault: true,
  tier: "major",
  regimeStatus: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function renderCard(momentum: number | null = 3) {
  return render(
    <PartyCard
      party={PARTY}
      effectiveCountry="us"
      rank={1}
      totalMembers={200}
      momentum={momentum}
    />
  );
}

afterEach(cleanup);

describe("PartyCard", () => {
  it("draws the party color once, as the swatch beside the name", () => {
    const { container } = renderCard();
    const painted = Array.from(container.querySelectorAll<HTMLElement>("[style]")).filter((el) =>
      el.getAttribute("style")?.includes("background")
    );
    expect(painted).toHaveLength(1);
    expect(painted[0].getAttribute("aria-hidden")).not.toBeNull();
    expect(painted[0].nextElementSibling?.textContent).toBe("Democratic Party");
  });

  it("keeps every figure, with the treasury in plain tabular sans", () => {
    renderCard();
    expect(screen.getByText("60.0%")).toBeTruthy();
    expect(screen.getByText("120")).toBeTruthy();
    expect(screen.getByText("40")).toBeTruthy();
    expect(screen.getByText("80")).toBeTruthy();
    const treasury = screen.getByText(
      (_, el) => el?.tagName === "DD" && !!el.getAttribute("title")
    );
    expect(treasury.className).toContain("tabular-nums");
    expect(treasury.className).not.toMatch(/font-mono|text-warning|text-gold/);
  });

  it("shows economic and social lean as plain words", () => {
    renderCard();
    const lean = screen.getByText("Lean Left");
    expect(lean.className).not.toMatch(/text-(info|error|primary|secondary|success|warning)/);
    expect(screen.getByText("Moderate")).toBeTruthy();
  });

  it("names the tier and links to the party headquarters", () => {
    renderCard(null);
    expect(screen.getByText(/Major party/)).toBeTruthy();
    expect(screen.getByText("No trend yet")).toBeTruthy();
    const hqLinks = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href") === "/country/us/parties/1");
    expect(hqLinks.length).toBeGreaterThanOrEqual(2);
  });
});
