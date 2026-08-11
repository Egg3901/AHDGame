/** @vitest-environment happy-dom */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { CabinetOfficeLayout } from "./CabinetOfficeLayout";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
// eslint-disable-next-line @next/next/no-img-element -- test mock replaces next/image with a plain img
vi.mock("next/image", () => ({ default: (p: Record<string, unknown>) => <img alt="" {...p} /> }));
vi.mock("@/components/Avatar", () => ({ Avatar: () => <span data-testid="avatar" /> }));
vi.mock("@/app/congress/components/CongressShared", () => ({
  PartyChip: ({ partyName }: { partyName: string }) => <span>{partyName}</span>,
}));

afterEach(cleanup);

const member = {
  characterId: "c1",
  characterName: "Jane Doe",
  party: "p1",
  partyName: "Unity",
  partyColor: "#fff",
  ministerialActions: 3,
  bannerImageUrl: null,
};

const baseProps = {
  positionName: "Secretary of Defense",
  department: "Department of Defense",
  countryId: "US" as const,
  member,
  identityGlyph: "US",
  identitySerif: "mono" as const,
  group: "Security & Foreign",
  tabs: [
    { id: "overview" as const, label: "Overview" },
    { id: "flagship" as const, label: "Military" },
  ],
  activeTab: "overview" as const,
  statStrip: <div data-testid="strip" />,
};

describe("CabinetOfficeLayout (dossier masthead)", () => {
  it("shows position, department, minister and X/4 actions", () => {
    render(<CabinetOfficeLayout {...baseProps} onSelectTab={() => {}} />);
    expect(screen.getByText("Secretary of Defense")).toBeTruthy();
    expect(screen.getByText("Jane Doe")).toBeTruthy();
    expect(screen.getByText(/3\/4/)).toBeTruthy();
    expect(screen.getByTestId("strip")).toBeTruthy();
  });

  it("renders the glyph chop when no seal image is provided", () => {
    render(<CabinetOfficeLayout {...baseProps} onSelectTab={() => {}} />);
    expect(screen.getAllByText("US").length).toBeGreaterThan(0);
  });

  it("renders Vacant when there is no member", () => {
    render(<CabinetOfficeLayout {...baseProps} member={null} onSelectTab={() => {}} />);
    expect(screen.getByText("Vacant")).toBeTruthy();
  });

  it("fires onSelectTab when a tab is clicked", () => {
    const onSelectTab = vi.fn();
    render(<CabinetOfficeLayout {...baseProps} onSelectTab={onSelectTab} />);
    fireEvent.click(screen.getByText("Military"));
    expect(onSelectTab).toHaveBeenCalledWith("flagship");
  });
});
