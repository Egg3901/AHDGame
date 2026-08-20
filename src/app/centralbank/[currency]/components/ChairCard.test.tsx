/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChairCard } from "./ChairCard";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/components/Avatar", () => ({
  Avatar: () => <div data-testid="avatar" />,
}));

const baseProps = {
  chairTitle: "Chair",
  chairAppointedAt: null,
  chairInfamy: 0,
  chairTermExpiresAtTurn: null,
  currentTurn: 100,
  currentInflation: 2,
  targetInflation: 2,
  latestGdp: 2,
};

describe("ChairCard", () => {
  it("renders the Autonomous Chair (AI) badge and plain-text name when chairMode === 'npp'", () => {
    render(
      <ChairCard
        {...baseProps}
        chair={{
          characterId: "npp-1",
          name: "Technocrat Alpha",
        }}
        chairMode="npp"
      />
    );
    expect(screen.getByText("Technocrat Alpha")).toBeTruthy();
    expect(screen.getByText("Autonomous Chair (AI)")).toBeTruthy();
    // No character link rendered for the npp variant
    expect(screen.queryByRole("link", { name: "Technocrat Alpha" })).toBeNull();
  });

  it("renders the player character link (no AI badge) when chairMode is absent (backward compat)", () => {
    render(
      <ChairCard
        {...baseProps}
        chair={{
          characterId: "c-1",
          sequentialId: 42,
          name: "Alex Smith",
        }}
      />
    );
    expect(screen.getByText("Alex Smith")).toBeTruthy();
    expect(screen.queryByText("Autonomous Chair (AI)")).toBeNull();
    expect(screen.getByRole("link", { name: "Alex Smith" })).toBeTruthy();
  });

  it("renders the player character link when chairMode === 'character'", () => {
    render(
      <ChairCard
        {...baseProps}
        chair={{
          characterId: "c-1",
          sequentialId: 42,
          name: "Alex Smith",
        }}
        chairMode="character"
      />
    );
    expect(screen.getByText("Alex Smith")).toBeTruthy();
    expect(screen.queryByText("Autonomous Chair (AI)")).toBeNull();
    expect(screen.getByRole("link", { name: "Alex Smith" })).toBeTruthy();
  });

  // Ticket #1144: persistPendingProposal leaves chairMode npp + chairNppId, so
  // the query still returns the caretaker. The pending offer must win, and the
  // nominee must get Accept/Decline (PR #602 only rendered those when chair was
  // already null).
  it("shows the pending offer and nominee controls even when an NPP caretaker is still seated", () => {
    render(
      <ChairCard
        {...baseProps}
        chair={{
          characterId: "npp-1",
          name: "Hanna Technocrat",
        }}
        chairMode="npp"
        chairSelectionPending={{
          characterId: "6a7899a8a705a10f4d8278b1",
          characterName: "Poppy",
          pool: "political",
          proposedAt: "2026-08-20T08:00:00.000Z",
          acceptanceTurnsRemaining: 22,
        }}
        viewerIsChairNominee
        countryCode="US"
      />
    );
    expect(screen.getByText("Poppy")).toBeTruthy();
    expect(screen.getByText("Accept appointment")).toBeTruthy();
    expect(screen.getByText("Decline")).toBeTruthy();
    expect(screen.queryByText("Hanna Technocrat")).toBeNull();
    expect(screen.queryByText("Autonomous Chair (AI)")).toBeNull();
  });
});
