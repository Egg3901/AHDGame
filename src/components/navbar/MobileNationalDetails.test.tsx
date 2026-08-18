/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { MobileNationalDetails } from "./MobileNationalDetails";
import enNav from "../../../messages/en/nav.json";

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={enNav}>
      {ui}
    </NextIntlClientProvider>
  );
}

vi.mock("next/navigation", () => ({ usePathname: () => "/country/uk/economy" }));

describe("MobileNationalDetails", () => {
  it("renders every section as a collapsible, chevron-affordanced button", () => {
    renderWithIntl(<MobileNationalDetails countryId="UK" onNavigate={() => {}} />);
    for (const title of ["Government", "Politics", "Economy", "Other"]) {
      const toggle = screen.getByRole("button", { name: new RegExp(`^${title}$`, "i") });
      expect(toggle.getAttribute("aria-expanded")).not.toBeNull();
    }
  });

  it("starts every section collapsed", () => {
    renderWithIntl(<MobileNationalDetails countryId="UK" onNavigate={() => {}} />);
    for (const title of ["Government", "Politics", "Economy", "Other"]) {
      expect(
        screen
          .getByRole("button", { name: new RegExp(`^${title}$`, "i") })
          .getAttribute("aria-expanded")
      ).toBe("false");
    }
  });

  it("expands a collapsed section on click and reveals its links", () => {
    renderWithIntl(<MobileNationalDetails countryId="UK" onNavigate={() => {}} />);
    expect(screen.queryByRole("link", { name: /^Politicians$/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^Politics$/i }));
    expect(screen.getByRole("link", { name: /^Politicians$/i })).toBeTruthy();
  });

  it("renders the Referendums link only when a campaign is active, inside the expanded Politics group", () => {
    renderWithIntl(
      <MobileNationalDetails countryId="UK" hasActiveReferendumCampaign onNavigate={() => {}} />
    );
    fireEvent.click(screen.getByRole("button", { name: /^Politics$/i }));
    expect(screen.getByRole("link", { name: /^Referendums$/i })).toBeTruthy();
  });

  it("marks the link for the current path as the active page", () => {
    renderWithIntl(<MobileNationalDetails countryId="UK" onNavigate={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^Economy$/i }));
    expect(screen.getByRole("link", { name: /^Economy$/i }).getAttribute("aria-current")).toBe(
      "page"
    );

    fireEvent.click(screen.getByRole("button", { name: /^Politics$/i }));
    expect(
      screen.getByRole("link", { name: /^Politicians$/i }).getAttribute("aria-current")
    ).toBeNull();
  });
});
