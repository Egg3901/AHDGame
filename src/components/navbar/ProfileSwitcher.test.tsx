/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProfileSwitcher } from "./ProfileSwitcher";

vi.mock("@/components/CountryFlag", () => ({
  CountryFlag: ({ country }: { country: string }) => <span data-testid={`flag-${country}`} />,
}));

const characters = [
  { id: "c1", name: "Alice", countryId: "US", isActive: true },
  { id: "c2", name: "Bob", countryId: "DE", isActive: false },
];

const imperialCharacter = { id: "i1", name: "Emperor" };

const baseProps = {
  characters,
  imperialCharacter,
  isImperialMode: false,
  charactersLabel: "Characters",
  imperialLabel: "Imperial",
  activeLabel: "Active",
};

describe("ProfileSwitcher", () => {
  it("desktop renders flags, an Active pill, and a switch link for inactive characters", () => {
    render(
      <ProfileSwitcher
        {...baseProps}
        variant="desktop"
        characterSwitchHref={(id) => `/switch/${id}`}
        imperialHref="/imperial/i1"
      />
    );

    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByText("Characters")).toBeTruthy();
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByText("Bob")).toBeTruthy();
    expect(screen.getByTestId("flag-US")).toBeTruthy();
    expect(screen.getByTestId("flag-DE")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Emperor")).toBeTruthy();

    const bobLink = screen.getByText("Bob").closest("a");
    expect(bobLink?.getAttribute("href")).toBe("/switch/c2");
    const aliceLink = screen.getByText("Alice").closest("a");
    expect(aliceLink?.getAttribute("href")).toBe("/profile");
  });

  it("mobile calls onSelectCharacter and onSelectImperial instead of linking", () => {
    const onSelectCharacter = vi.fn();
    const onSelectImperial = vi.fn();
    const onNavigate = vi.fn();
    render(
      <ProfileSwitcher
        {...baseProps}
        variant="mobile"
        onSelectCharacter={onSelectCharacter}
        onSelectImperial={onSelectImperial}
        onNavigate={onNavigate}
      />
    );

    fireEvent.click(screen.getByText("Bob"));
    expect(onSelectCharacter).toHaveBeenCalledWith("c2");
    expect(onNavigate).toHaveBeenCalled();

    fireEvent.click(screen.getByText("Emperor"));
    expect(onSelectImperial).toHaveBeenCalledWith("imperial");
  });

  it("imperial mode marks the imperial row active and routes characters back", () => {
    const onSelectImperial = vi.fn();
    render(
      <ProfileSwitcher
        {...baseProps}
        variant="mobile"
        isImperialMode
        imperialHref="/imperial/i1"
        onSelectImperial={onSelectImperial}
      />
    );

    const emperorLink = screen.getByText("Emperor").closest("a");
    expect(emperorLink?.getAttribute("href")).toBe("/imperial/i1");
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText("Alice"));
    expect(onSelectImperial).toHaveBeenCalledWith("character");
  });
});
