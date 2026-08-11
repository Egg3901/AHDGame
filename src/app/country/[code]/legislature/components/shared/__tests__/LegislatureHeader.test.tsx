/**
 * Unit tests for LegislatureHeader component
 * Tests shared header with hero image, stats strip, and optional chamber switcher
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import LegislatureHeader from "../LegislatureHeader";

describe("LegislatureHeader", () => {
  const baseProps = {
    countryId: "UK" as const,
    title: "House of Commons",
    subtitle: "650 MPs",
    heroImage: "/images/commons.jpg",
    heroAlt: "House of Commons chamber",
    stats: {
      majorityParty: { name: "Labour", color: "#E4003B", seats: 326 },
      totalSeats: 650,
      leader: { label: "Prime Minister", name: "John Smith", id: "pm1" },
      minorityLeader: { label: "Opposition Leader", name: "Jane Doe", id: "opp1" },
    },
  };

  it("should render UK header without chamber switcher", () => {
    render(<LegislatureHeader {...baseProps} />);

    // Check title and subtitle
    expect(screen.getByText("House of Commons")).toBeTruthy();
    expect(screen.getByText("650 MPs")).toBeTruthy();

    // Check hero image
    const img = screen.getByAltText("House of Commons chamber");
    expect(img).toBeTruthy();
    // next/image wraps src in /_next/image?url=... — check the original is present
    expect(img.getAttribute("src")).toContain("commons.jpg");

    // Check stats strip
    expect(screen.getByText("Majority Party")).toBeTruthy();
    expect(screen.getByText("Labour")).toBeTruthy();
    expect(screen.getByText("326 / 650")).toBeTruthy();

    // Check leaders
    expect(screen.getByText("Prime Minister")).toBeTruthy();
    expect(screen.getByText("John Smith")).toBeTruthy();
    expect(screen.getByText("Opposition Leader")).toBeTruthy();
    expect(screen.getByText("Jane Doe")).toBeTruthy();

    // Should NOT have chamber switcher
    expect(screen.queryByRole("tablist")).toBeFalsy();
  });

  it("should render US header with chamber switcher", () => {
    const usProps = {
      countryId: "US" as const,
      title: "United States Congress",
      subtitle: "118th Congress",
      heroImage: "/images/capitol.jpg",
      heroAlt: "US Capitol building",
      stats: {
        majorityParty: { name: "Republican", color: "#E81B23", seats: 53 },
        totalSeats: 100,
        leader: { label: "Senate Leader", name: "Mitch McConnell", id: "sen1" },
        minorityLeader: { label: "Minority Leader", name: "Chuck Schumer", id: "sen2" },
      },
      chamberSwitcher: {
        active: "senate",
        onSwitch: vi.fn(),
        options: [
          { key: "senate", label: "Senate" },
          { key: "house", label: "House" },
        ],
      },
    };

    render(<LegislatureHeader {...usProps} />);

    // Check chamber switcher exists
    const tablist = screen.getByRole("tablist");
    expect(tablist).toBeTruthy();
    expect(tablist.getAttribute("aria-label")).toBe("Chamber");

    // Check Senate tab is active
    const senateTab = screen.getByRole("tab", { name: /senate/i });
    const houseTab = screen.getByRole("tab", { name: /house/i });
    expect(senateTab.getAttribute("aria-selected")).toBe("true");
    expect(houseTab.getAttribute("aria-selected")).toBe("false");
  });

  it("should call onSwitch when chamber tab is clicked", () => {
    const onSwitch = vi.fn();

    const usProps = {
      countryId: "US" as const,
      title: "United States Congress",
      subtitle: "118th Congress",
      heroImage: "/images/capitol.jpg",
      heroAlt: "US Capitol building",
      stats: {
        majorityParty: { name: "Republican", color: "#E81B23", seats: 53 },
        totalSeats: 100,
        leader: { label: "Senate Leader", name: "Mitch McConnell", id: "sen1" },
        minorityLeader: null,
      },
      chamberSwitcher: {
        active: "senate",
        onSwitch,
        options: [
          { key: "senate", label: "Senate" },
          { key: "house", label: "House" },
        ],
      },
    };

    render(<LegislatureHeader {...usProps} />);

    // Click House tab
    const houseTab = screen.getByRole("tab", { name: /house/i });
    fireEvent.click(houseTab);

    expect(onSwitch).toHaveBeenCalledWith("house");
  });

  it("should render party color correctly", () => {
    render(<LegislatureHeader {...baseProps} />);

    const partyName = screen.getByText("Labour");
    // Color can be hex or rgb depending on browser, just check it's set
    expect(partyName.style.color).toBeTruthy();
    expect(partyName.style.color.toLowerCase()).toMatch(/#e4003b|rgb\(228,\s*0,\s*59\)/i);
  });

  it("should render leader links correctly", () => {
    render(<LegislatureHeader {...baseProps} />);

    const pmLink = screen.getByRole("link", { name: "John Smith" });
    expect(pmLink.getAttribute("href")).toBe("/character/pm1");

    const oppLink = screen.getByRole("link", { name: "Jane Doe" });
    expect(oppLink.getAttribute("href")).toBe("/character/opp1");
  });

  it("should display 'Vacant' when leader is null", () => {
    const propsWithVacantLeader = {
      ...baseProps,
      stats: {
        ...baseProps.stats,
        leader: null,
        minorityLeader: null,
      },
    };

    render(<LegislatureHeader {...propsWithVacantLeader} />);

    const vacantElements = screen.getAllByText("Vacant");
    expect(vacantElements).toHaveLength(2);
  });

  it("should apply correct styling classes", () => {
    const { container } = render(<LegislatureHeader {...baseProps} />);

    // Check main header exists and has key classes
    const header = container.querySelector("header");
    expect(header).toBeTruthy();
    expect(header?.className).toContain("rounded-2xl");
    expect(header?.className).toContain("border-card-border");

    // Check hero section exists
    const heroSection = container.querySelector('[class*="h-[175px]"]');
    expect(heroSection).toBeTruthy();
  });

  it("should have proper accessibility attributes", () => {
    render(<LegislatureHeader {...baseProps} />);

    // Hero image should have alt text
    const img = screen.getByAltText("House of Commons chamber");
    expect(img).toBeTruthy();

    // Stats labels should be uppercase
    const majorityLabel = screen.getByText("Majority Party");
    expect(majorityLabel.className).toContain("uppercase");
  });
});
