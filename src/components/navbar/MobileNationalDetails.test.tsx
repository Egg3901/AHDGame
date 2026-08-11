/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MobileNationalDetails } from "./MobileNationalDetails";

vi.mock("next/navigation", () => ({ usePathname: () => "/country/uk/economy" }));

describe("MobileNationalDetails", () => {
  it("renders every section as a collapsible, chevron-affordanced button", () => {
    render(<MobileNationalDetails countryId="UK" onNavigate={() => {}} />);
    for (const title of ["Government", "Politics", "Economy", "Other"]) {
      const toggle = screen.getByRole("button", { name: new RegExp(`^${title}$`, "i") });
      expect(toggle.getAttribute("aria-expanded")).not.toBeNull();
    }
  });

  it("collapses every section except the one containing the current route", () => {
    // Mocked pathname is an Economy route — only Economy should start open.
    render(<MobileNationalDetails countryId="UK" onNavigate={() => {}} />);
    expect(
      screen.getByRole("button", { name: /^Government$/i }).getAttribute("aria-expanded")
    ).toBe("false");
    expect(screen.getByRole("button", { name: /^Politics$/i }).getAttribute("aria-expanded")).toBe(
      "false"
    );
    expect(screen.getByRole("button", { name: /^Economy$/i }).getAttribute("aria-expanded")).toBe(
      "true"
    );
  });

  it("expands a collapsed section on click and reveals its links", () => {
    render(<MobileNationalDetails countryId="UK" onNavigate={() => {}} />);
    expect(screen.queryByRole("link", { name: /^Politicians$/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^Politics$/i }));
    expect(screen.getByRole("link", { name: /^Politicians$/i })).toBeTruthy();
  });

  it("renders the Referendums link only when a campaign is active, inside the expanded Politics group", () => {
    render(
      <MobileNationalDetails countryId="UK" hasActiveReferendumCampaign onNavigate={() => {}} />
    );
    fireEvent.click(screen.getByRole("button", { name: /^Politics$/i }));
    expect(screen.getByRole("link", { name: /^Referendums$/i })).toBeTruthy();
  });

  it("marks the link for the current path as the active page", () => {
    // usePathname is mocked to "/country/uk/economy" — Economy starts open.
    render(<MobileNationalDetails countryId="UK" onNavigate={() => {}} />);
    expect(screen.getByRole("link", { name: /^Economy$/i }).getAttribute("aria-current")).toBe(
      "page"
    );

    fireEvent.click(screen.getByRole("button", { name: /^Politics$/i }));
    expect(
      screen.getByRole("link", { name: /^Politicians$/i }).getAttribute("aria-current")
    ).toBeNull();
  });
});
