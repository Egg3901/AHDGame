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
});
