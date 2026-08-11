/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SettingsDropdown } from "./SettingsDropdown";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/contexts/RegisteredCountriesContext", () => ({
  useEnabledCountries: () => ["US", "UK"],
}));

vi.mock("@/components/CountryFlag", () => ({
  CountryFlag: () => <span data-testid="flag" />,
}));

const baseUser = {
  username: "testuser",
  isAdmin: true,
  isModerator: true,
  patreonTier: null,
  isPatronActive: false,
};

describe("SettingsDropdown", () => {
  it("shows Profile Settings but not Admin/Mod panels (staff-only)", () => {
    render(
      <SettingsDropdown user={baseUser} onSignOut={vi.fn()} pageCountry="US" userCountry="US" />
    );

    fireEvent.click(screen.getByLabelText("Settings"));

    expect(screen.getByText("Profile Settings")).toBeTruthy();
    expect(screen.queryByText("Admin Panel")).toBeNull();
    expect(screen.queryByText("Mod Panel")).toBeNull();
  });
});
