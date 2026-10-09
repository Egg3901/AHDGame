/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NominationCard, type NominationDisplay } from "./NominationCard";

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: any) => <img {...props} />,
}));
vi.mock("@/components/time/LocalTime", () => ({ LocalTime: () => null }));
vi.mock("@/components/time/GameMonthTime", () => ({ GameMonthTime: () => null }));
vi.mock("@/contexts/useGameClock", () => ({
  useGameClock: () => ({
    formatRemaining: (d: string | null) =>
      d ? { text: "4h 12m", urgency: "warning" } : { text: "No timer", urgency: "normal" },
  }),
}));

function nomination(overrides: Partial<NominationDisplay> = {}): NominationDisplay {
  return {
    id: "n1",
    kind: "scotus",
    seatNumber: 3,
    positionName: "Supreme Court Seat #3",
    nomineeCharacterName: "Low Thia Khiang",
    proposedByPresidentName: "Flowery Dreemurr",
    nominee: {
      name: "Low Thia Khiang",
      href: "/character/40",
      avatarUrl: "https://cdn/n.png",
      partyName: "Liberty Party",
      partyColor: "#f59e0b",
    },
    nominator: {
      name: "Flowery Dreemurr",
      href: "/character/12",
      avatarUrl: null,
      partyName: null,
      partyColor: null,
    },
    votesFor: 13,
    votesAgainst: 9,
    votesAbstain: 1,
    votingEndsAt: "2026-10-09T23:00:00.000Z",
    proposedAt: "2026-10-01T00:00:00.000Z",
    myVote: "for",
    ...overrides,
  };
}

afterEach(cleanup);

describe("NominationCard", () => {
  it("links the card to the nomination and the people to their profiles", () => {
    render(<NominationCard nom={nomination()} />);
    expect(
      screen
        .getByRole("link", { name: "Low Thia Khiang, nominated for Supreme Court Seat 3" })
        .getAttribute("href")
    ).toBe("/congress/scotus-nominations/n1");
    expect(screen.getByRole("link", { name: "Low Thia Khiang" }).getAttribute("href")).toBe(
      "/character/40"
    );
    expect(screen.getByRole("link", { name: "Flowery Dreemurr" }).getAttribute("href")).toBe(
      "/character/12"
    );
  });

  it("shows the nominee portrait, party name, vote and countdown", () => {
    render(<NominationCard nom={nomination()} />);
    expect(screen.getByAltText("Low Thia Khiang").getAttribute("src")).toBe("https://cdn/n.png");
    expect(screen.getByText("Liberty Party")).toBeTruthy();
    expect(screen.getByText("You voted Yea")).toBeTruthy();
    expect(screen.getByText("Closes in 4h 12m")).toBeTruthy();
  });

  it("routes cabinet nominations to the cabinet page and degrades without resolved people", () => {
    render(
      <NominationCard
        nom={nomination({
          kind: "cabinet",
          positionName: "Director of Central Intelligence",
          nominee: undefined,
          nominator: undefined,
          myVote: null,
        })}
      />
    );
    expect(
      screen
        .getByRole("link", {
          name: "Low Thia Khiang, nominated for Director of Central Intelligence",
        })
        .getAttribute("href")
    ).toBe("/congress/nominations/n1");
    expect(screen.queryByRole("link", { name: "Low Thia Khiang" })).toBeNull();
    expect(screen.getByText("Cabinet nomination")).toBeTruthy();
  });
});
