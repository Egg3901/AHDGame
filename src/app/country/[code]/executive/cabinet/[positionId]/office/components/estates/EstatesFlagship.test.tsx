/** @vitest-environment happy-dom */
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { EstatesFlagship } from "./EstatesFlagship";
import type { EstateView, EstateSummaryView } from "../../useCabinetOffice";

afterEach(cleanup);

function estate(p: Partial<EstateView>): EstateView {
  return {
    _id: "e1",
    countryId: "US",
    portfolioKey: "education",
    positionId: "secretary_of_education",
    archetypeId: "public_school",
    name: "Lincoln High",
    icon: "school",
    fundingLevel: "standard",
    tier: 0,
    condition: 100,
    outputBase: 5000,
    upkeepBase: 60,
    siteScope: "region",
    siteId: "US-CA",
    createdTurn: 1,
    effectiveOutput: 5000,
    effectiveUpkeep: 60,
    ...p,
  };
}

const summary: EstateSummaryView = {
  count: 2,
  totalUpkeep: 200,
  envelope: 150_000_000_000,
  portfolioKey: "education",
  bySite: { "US-CA": { "education.highSchoolGradRate": 0.02 } },
};

const regions = [
  { id: "US-CA", name: "California" },
  { id: "US-NY", name: "New York" },
];

function renderFlagship(estates: EstateView[], canAct = true, onUpdate = vi.fn()) {
  return render(
    <EstatesFlagship
      countryCode="us"
      positionId="secretary_of_education"
      portfolioKey="education"
      estates={estates}
      estateSummary={summary}
      canAct={canAct}
      currencySymbol="$"
      regions={regions}
      targetCountries={[]}
      onUpdate={onUpdate}
    />
  );
}

describe("EstatesFlagship", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });

  it("renders the roster with an estate name and the Open button", () => {
    renderFlagship([estate({}), estate({ _id: "e2", name: "Roosevelt High" })]);
    expect(screen.getByText("Lincoln High")).toBeTruthy();
    expect(screen.getByText("Open estate")).toBeTruthy();
  });

  it("opens the panel and posts an open request", async () => {
    renderFlagship([estate({})]);
    fireEvent.click(screen.getByText("Open estate"));
    expect(screen.getByText("Open a new facility")).toBeTruthy();
    fireEvent.click(screen.getByText("Authorize · 1 action"));
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledWith(
      "/api/country/us/executive/cabinet/secretary_of_education/estates/open",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("disables Open when canAct is false", () => {
    renderFlagship([estate({})], false);
    expect((screen.getByText("Open estate") as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the budget tab envelope when switched", () => {
    renderFlagship([estate({})]);
    fireEvent.click(screen.getByText("Budget"));
    expect(screen.getByText("Portfolio discretionary budget")).toBeTruthy();
  });
});
