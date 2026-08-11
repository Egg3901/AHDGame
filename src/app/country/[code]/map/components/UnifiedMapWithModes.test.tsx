/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UnifiedMapWithModes } from "./UnifiedMapWithModes";
import { COUNTRY_MAP_CONFIGS } from "./countryMapConfigs";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import type { MapOverviewResponse } from "@/lib/map/overviewTypes";
import { regionUrl } from "@/lib/urls";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/components/BackButton", () => ({
  default: () => <button data-testid="back-button">Back</button>,
}));
vi.mock("@/components/ui", () => ({
  SectionLabel: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="section-label">{children}</div>
  ),
}));
vi.mock("./useResourceMapData", () => ({
  useResourceMapData: () => ({}),
}));

describe("UnifiedMapWithModes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // UnifiedMapWithModes fetches /api/game/turn/status on mount for era-aware
    // map rendering (CN pre-handover map). Stub it so happy-dom doesn't try a
    // real network call.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({}), { status: 200 })))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the DE header subtitle and all mode tabs from config", () => {
    render(
      <UnifiedMapWithModes
        mapData={null}
        config={COUNTRY_CONFIGS.DE}
        countryConfig={COUNTRY_MAP_CONFIGS.DE}
        onRegionClick={vi.fn()}
      />
    );
    expect(screen.getByText(COUNTRY_MAP_CONFIGS.DE.headerSubtitle)).toBeTruthy();
    for (const m of COUNTRY_MAP_CONFIGS.DE.modes) {
      expect(screen.getByRole("button", { name: m.label })).toBeTruthy();
    }
  });

  it("starts on the country's defaultMode and shows its description", () => {
    const config = COUNTRY_MAP_CONFIGS.UK;
    render(
      <UnifiedMapWithModes
        mapData={null}
        config={COUNTRY_CONFIGS.UK}
        countryConfig={config}
        onRegionClick={vi.fn()}
      />
    );
    const defaultMode = config.modes.find((m) => m.id === config.defaultMode);
    expect(defaultMode).toBeDefined();
    expect(screen.getByText(defaultMode!.description)).toBeTruthy();
  });

  it("switches mode and shows the new description when a tab is clicked", () => {
    const config = COUNTRY_MAP_CONFIGS.DE;
    render(
      <UnifiedMapWithModes
        mapData={null}
        config={COUNTRY_CONFIGS.DE}
        countryConfig={config}
        onRegionClick={vi.fn()}
      />
    );
    const approvalMode = config.modes.find((m) => m.id === "approval");
    expect(approvalMode).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: approvalMode!.label }));
    expect(screen.getByText(approvalMode!.description)).toBeTruthy();
  });

  it("shows the lean-axis tabs only on the lean mode", () => {
    const config = COUNTRY_MAP_CONFIGS.JP;
    render(
      <UnifiedMapWithModes
        mapData={null}
        config={COUNTRY_CONFIGS.JP}
        countryConfig={config}
        onRegionClick={vi.fn()}
      />
    );
    expect(screen.queryByText("Combined")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: config.modes.find((m) => m.id === "lean")!.label })
    );
    expect(screen.getByText("Combined")).toBeTruthy();
    expect(screen.getByText("Economic")).toBeTruthy();
    expect(screen.getByText("Social")).toBeTruthy();
  });

  it("shows the resource sub-tabs only on the resources mode", () => {
    const config = COUNTRY_MAP_CONFIGS.UK;
    render(
      <UnifiedMapWithModes
        mapData={null}
        config={COUNTRY_CONFIGS.UK}
        countryConfig={config}
        onRegionClick={vi.fn()}
      />
    );
    expect(screen.queryByText("Capacity")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: config.modes.find((m) => m.id === "resources")!.label,
      })
    );
    expect(screen.getByText("Capacity")).toBeTruthy();
    expect(screen.getByText("Contracted %")).toBeTruthy();
    expect(screen.getByText("Open-access %")).toBeTruthy();
  });

  it("drives the region list from the live roster (mapData.regions), dropping unowned regions", () => {
    const config = COUNTRY_MAP_CONFIGS.DE;
    const owned = config.regions[0];
    const unowned = config.regions[1];
    // Live roster carries only the first Land — the second is no longer owned.
    const mapData = {
      regions: [{ id: owned.id, name: owned.name, seats: 0, grouping: "" }],
    } as unknown as MapOverviewResponse;
    const { container } = render(
      <UnifiedMapWithModes
        mapData={mapData}
        config={COUNTRY_CONFIGS.DE}
        countryConfig={config}
        onRegionClick={vi.fn()}
      />
    );
    // Only the right-pane list emits region-page links, so href membership is an
    // unambiguous probe of which regions the list renders.
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain(regionUrl("DE", owned.id));
    expect(hrefs).not.toContain(regionUrl("DE", unowned.id));
  });

  it("falls back to the static roster when the live roster is empty or absent", () => {
    const config = COUNTRY_MAP_CONFIGS.DE;
    const { container } = render(
      <UnifiedMapWithModes
        mapData={{ regions: [] } as unknown as MapOverviewResponse}
        config={COUNTRY_CONFIGS.DE}
        countryConfig={config}
        onRegionClick={vi.fn()}
      />
    );
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    // Every configured region still links — an empty/absent roster never blanks the list.
    for (const r of config.regions) {
      expect(hrefs).toContain(regionUrl("DE", r.id));
    }
  });

  it("renders the right-pane region list with each region's secondary label", () => {
    const config = COUNTRY_MAP_CONFIGS.CN;
    render(
      <UnifiedMapWithModes
        mapData={null}
        config={COUNTRY_CONFIGS.CN}
        countryConfig={config}
        onRegionClick={vi.fn()}
      />
    );
    expect(screen.getByText(config.regionListHeading)).toBeTruthy();
    for (const region of config.regions) {
      // Region names appear in both the SVG map cell labels and the right-pane
      // list, so accept ≥1 occurrence rather than insisting on uniqueness.
      expect(screen.getAllByText(region.name).length).toBeGreaterThan(0);
      expect(screen.getByText(region.secondaryLabel)).toBeTruthy();
    }
  });
});
