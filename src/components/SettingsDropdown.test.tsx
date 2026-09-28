/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from "vitest";
import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SettingsDropdown } from "./SettingsDropdown";
import enNav from "../../messages/en/nav.json";

function render(ui: React.ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enNav}>
      {ui}
    </NextIntlClientProvider>
  );
}

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
  it("opens from an avatar trigger showing the username initial", () => {
    render(
      <SettingsDropdown user={baseUser} onSignOut={vi.fn()} pageCountry="US" userCountry="US" />
    );

    fireEvent.click(screen.getByLabelText("User menu"));

    expect(screen.getByText("Profile Settings")).toBeTruthy();
    expect(screen.queryByText("Admin Panel")).toBeNull();
    expect(screen.queryByText("Mod Panel")).toBeNull();
    expect(screen.getByText("Sign Out")).toBeTruthy();
  });

  it("groups entries under Account and View sections", () => {
    render(
      <SettingsDropdown user={baseUser} onSignOut={vi.fn()} pageCountry="US" userCountry="US" />
    );

    fireEvent.click(screen.getByLabelText("User menu"));

    expect(screen.getByText("Account")).toBeTruthy();
    expect(screen.getByText("View")).toBeTruthy();
    expect(screen.getByText("testuser")).toBeTruthy();
    // Avatar initial appears in the trigger and the signed-in header.
    expect(screen.getAllByText("T").length).toBeGreaterThanOrEqual(2);
  });

  it("opens the nation picker and returns via back", () => {
    render(
      <SettingsDropdown user={baseUser} onSignOut={vi.fn()} pageCountry="US" userCountry="US" />
    );

    fireEvent.click(screen.getByLabelText("User menu"));
    fireEvent.click(screen.getByText("Switch nation view"));

    expect(screen.getByText("Select Nation")).toBeTruthy();

    fireEvent.click(screen.getByText("Back"));
    expect(screen.getByText("Profile Settings")).toBeTruthy();
  });

  it("does not expose account sign-out for the fixed local session", () => {
    render(
      <SettingsDropdown
        user={{ ...baseUser, singleplayer: true }}
        onSignOut={vi.fn()}
        pageCountry="US"
        userCountry="US"
      />
    );

    fireEvent.click(screen.getByLabelText("User menu"));
    expect(screen.queryByText("Sign Out")).toBeNull();
  });
});
