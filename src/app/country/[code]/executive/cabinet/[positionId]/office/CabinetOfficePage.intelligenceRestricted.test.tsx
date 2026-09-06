/** @vitest-environment happy-dom */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

/**
 * The intelligence seat is withheld exactly like the defence seat.
 *
 * `CabinetOfficePage.restricted.test.tsx` already proves the blackout for the
 * defence office, but it proves it generically ("renders no tabs"). The
 * intelligence console is the one office whose body is a picture of OTHER
 * countries, so the cost of it leaking is not the department's own numbers but
 * everything the service has learned about everyone else. That is worth its own
 * regression, pinned to this seat, so a later change to the tab machinery cannot
 * quietly surface it while the generic assertion still passes.
 */
vi.mock("next/navigation", () => ({
  useParams: () => ({ code: "us", positionId: "director_of_intelligence" }),
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
vi.mock("./components/CabinetPositionRail", () => ({ CabinetPositionRail: () => <div>RAIL</div> }));

// If the console rendered at all, the blackout leaked. Give it a shout.
vi.mock("./components/IntelligenceTab", () => ({
  default: () => <div>INTELLIGENCE CONSOLE</div>,
}));

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
        id: "director_of_intelligence",
        name: "Director of Central Intelligence",
        department: "Central Intelligence Agency",
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
      restriction: { allowedTitles: ["President"], countryName: "the United States" },
    },
  }),
}));

import CabinetOfficePage from "./page";

afterEach(cleanup);

describe("the intelligence office when it is withheld", () => {
  it("never renders the console body", () => {
    render(<CabinetOfficePage />);
    expect(screen.queryByText("INTELLIGENCE CONSOLE")).toBeNull();
  });

  it("renders no Intelligence tab to reach it by", () => {
    render(<CabinetOfficePage />);
    expect(screen.queryByRole("button", { name: /intelligence/i })).toBeNull();
  });

  it("leaks no assessment vocabulary onto the page", () => {
    // The tier labels and section headings are the shape of what the service
    // knows. None of them belong on a page the viewer may not read.
    render(<CabinetOfficePage />);
    const body = document.body.textContent ?? "";
    for (const probe of [
      "Nuclear Assessments",
      "Military Assessments",
      "Economic Assessments",
      "Networks",
      "Recent Operations",
    ]) {
      expect(body).not.toContain(probe);
    }
  });

  it("still names who may read the seat, so the blackout is explicable", () => {
    render(<CabinetOfficePage />);
    expect(document.body.textContent ?? "").toContain("President");
  });
});
