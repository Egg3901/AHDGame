/** @vitest-environment happy-dom */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useParams: () => ({ code: "us", positionId: "secretary_of_defense" }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
// eslint-disable-next-line @next/next/no-img-element -- test mock replaces next/image with a plain img
vi.mock("next/image", () => ({ default: (p: Record<string, unknown>) => <img alt="" {...p} /> }));
vi.mock("@/components/Avatar", () => ({ Avatar: () => <span /> }));
vi.mock("@/app/congress/components/CongressShared", () => ({ PartyChip: () => <span /> }));

// A panel that rendered would prove the blackout leaked, so give each a shout.
vi.mock("./components/MinisterialOrderPanel", () => ({
  MinisterialOrderPanel: () => <div>ORDERS</div>,
}));
vi.mock("./components/RegionalBreakdownTable", () => ({
  RegionalBreakdownTable: () => <div>BREAKDOWN</div>,
}));
vi.mock("./components/CabinetPositionRail", () => ({ CabinetPositionRail: () => <div>RAIL</div> }));

vi.mock("./useCabinetOffice", () => ({
  useCabinetOffice: () => ({
    loading: false,
    error: null,
    refetch: vi.fn(),
    data: {
      canView: false,
      canAct: false,
      liveYear: 1953,
      position: {
        id: "secretary_of_defense",
        name: "Secretary of Defense",
        department: "Department of Defense",
        sealImage: null,
        singleRegionFocus: null,
      },
      member: {
        characterId: "c1",
        characterName: "Jordan Ashton",
        party: "p1",
        partyName: "Unity",
        partyColor: "#fff",
        bannerImageUrl: null,
      },
      // The realm phrase as the briefing sends it, article included.
      restriction: { allowedTitles: ["President"], countryName: "the United States" },
    },
  }),
}));

import CabinetOfficePage from "./page";

afterEach(cleanup);

describe("CabinetOfficePage when the office is withheld", () => {
  it("replaces the office body with a restriction notice", () => {
    render(<CabinetOfficePage />);

    expect(screen.getByText("Office records restricted")).toBeTruthy();
  });

  it("names the offices that may read the seat", () => {
    render(<CabinetOfficePage />);

    expect(
      screen.getByText(
        "Only the seated Secretary of Defense, along with the President of the United States, may view this office."
      )
    ).toBeTruthy();
  });

  it("renders no tabs, so no tab body can be reached", () => {
    render(<CabinetOfficePage />);

    expect(screen.queryByText("Overview")).toBeNull();
    expect(screen.queryByText("Commands")).toBeNull();
    expect(screen.queryByText("Doctrine")).toBeNull();
  });

  it("renders none of the office panels", () => {
    render(<CabinetOfficePage />);

    expect(screen.queryByText("ORDERS")).toBeNull();
    expect(screen.queryByText("BREAKDOWN")).toBeNull();
  });

  it("hides the ministerial action counter rather than showing a zero", () => {
    render(<CabinetOfficePage />);

    expect(screen.queryByText(/Actions$/)).toBeNull();
  });

  it("keeps the seat and its holder on the letterhead", () => {
    render(<CabinetOfficePage />);

    expect(screen.getByRole("heading", { name: "Secretary of Defense" })).toBeTruthy();
    expect(screen.getByText("Jordan Ashton")).toBeTruthy();
  });
});
