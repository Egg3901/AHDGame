/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";
import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { NationDropdown } from "./NationDropdown";
import { RegisteredCountriesProvider } from "@/contexts/RegisteredCountriesContext";
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

vi.mock("@/hooks/useActiveCharters", () => ({
  useActiveCharters: () => null,
}));

vi.mock("@/hooks/useActiveReferendumCampaign", () => ({
  useActiveReferendumCampaign: () => false,
}));

function openDropdown() {
  fireEvent.click(screen.getByRole("button", { name: /china/i }));
}

describe("NationDropdown — Cabinet Office entry", () => {
  it("links to the viewer's cabinet office page, between Home and My Party", () => {
    render(
      <NationDropdown
        countryId="CN"
        userCountry="CN"
        currentParty={{ id: "1", name: "Chinese Communist Party", countryId: "CN" }}
        cabinetOffice={{
          positionId: "finance_minister",
          positionName: "Minister of Finance",
          countryCode: "cn",
        }}
      />
    );
    openDropdown();

    const officeLink = screen.getByRole("link", { name: /cabinet office/i });
    expect(officeLink.getAttribute("href")).toBe(
      "/country/cn/executive/cabinet/finance_minister/office"
    );

    // Renders after the home-nation link and before the My Party link.
    const partyLink = screen.getByRole("link", { name: /my party/i });
    expect(
      officeLink.compareDocumentPosition(partyLink) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("hides the entry when the viewer holds no cabinet seat", () => {
    render(<NationDropdown countryId="CN" userCountry="CN" cabinetOffice={null} />);
    openDropdown();

    expect(screen.queryByRole("link", { name: /cabinet office/i })).toBeNull();
  });
});

describe("NationDropdown — National Details sub-sections", () => {
  it("renders the four section headers and groups links under them", () => {
    render(<NationDropdown countryId="UK" userCountry="UK" />);
    fireEvent.click(screen.getByRole("button", { name: /united kingdom/i }));
    // Flat titles render as sub-section headers (distinct from link labels);
    // CollapsibleNavSection renders them as a styled <div>.
    for (const h of ["Government", "Politics", "Other"]) {
      const header = screen
        .getAllByText(h)
        .find((el) => el.tagName === "DIV" && el.className.includes("text-[11px]"));
      expect(header).toBeTruthy();
    }
    // Economy is a collapsible toggle, collapsed by default.
    const economyToggle = screen.getByRole("button", { name: /Economy/i });
    expect(economyToggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("link", { name: /National Budget/i })).toBeNull();
    // Expanding reveals the Economy links (National Budget lives under it).
    fireEvent.click(economyToggle);
    expect(economyToggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: /National Budget/i })).toBeTruthy();
    // Referendums link absent when no active campaign.
    expect(screen.queryByRole("link", { name: /^Referendums$/i })).toBeNull();
  });

  it("lists country-scoped Unions inside the Economy group when enabled", () => {
    render(<NationDropdown countryId="UK" userCountry="UK" unionsEnabled />);
    fireEvent.click(screen.getByRole("button", { name: /united kingdom/i }));
    fireEvent.click(screen.getByRole("button", { name: /Economy/i }));
    const unions = screen.getByRole("link", { name: /^Unions$/i });
    expect(unions.getAttribute("href")).toBe("/country/uk/unions");
  });
});

describe("NationDropdown — runtime display overrides (ticket #1255)", () => {
  it("names a reunified Germany 'Germany' in the button and the National Details header", () => {
    // The live world's shape: DD survived the German Question, DE was absorbed,
    // and `countryState` carries displayNameOverride "Germany". The dropdown
    // must read that, not the compiled "East Germany".
    rtlRender(
      <NextIntlClientProvider locale="en" messages={enNav}>
        <RegisteredCountriesProvider
          value={{
            registered: ["US", "DD"],
            enabled: ["US", "DD"],
            preset: "1953-default",
            displayOverrides: { DD: { name: "Germany", flagEmoji: "🇩🇪" } },
          }}
        >
          <NationDropdown countryId="DD" userCountry="DD" />
        </RegisteredCountriesProvider>
      </NextIntlClientProvider>
    );
    // The collapsed button label.
    expect(screen.getByRole("button", { name: /germany/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /germany/i }));
    // The National Details header interpolates the override too.
    expect(screen.getByText(/National Details: Germany/i)).toBeTruthy();
    // And the compiled half-name is gone from the surface entirely.
    expect(screen.queryByText(/East Germany/i)).toBeNull();
  });
});
