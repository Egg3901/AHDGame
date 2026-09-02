/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { LawsTab } from "./StatePageTabsLaws";
import type { State } from "@/lib/db/types";

const GA = { _id: "GA", name: "Georgia", countryId: "US" } as State;

const TAX_RATES = {
  incomeTax: 5,
  salesTax: 4,
  domesticCorporateTax: 6,
  foreignCorporateTax: 7,
  propertyTax: 1,
};

function record(overrides: Record<string, unknown>) {
  return {
    legislationTypeId: `id-${Math.random()}`,
    name: "A Law",
    policyDomain: "governance",
    policyOptionName: "Some Option",
    hasEconomic: false,
    hasSocial: false,
    economic: 0,
    social: 0,
    metricEffects: [],
    ...overrides,
  };
}

/** Wire the two fetches LawsTab makes: policy records, then the region budget. */
function mockFetch(records: unknown[], taxRates: unknown = TAX_RATES) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url.includes("/policy")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(records) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ taxRates }) });
    })
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LawsTab domain labelling", () => {
  beforeEach(() => {
    mockFetch([
      record({ policyDomain: "tax", name: "State Sales Tax" }),
      record({ policyDomain: "economy", name: "Productivity Act" }),
      record({ policyDomain: "education", name: "Schools Act" }),
    ]);
  });

  it("labels the tax and economy domains instead of printing raw internal keys", async () => {
    render(<LawsTab state={GA} />);
    // Live regression: GA carries `tax` and `economy` rows, and the tab's own
    // eight-entry label table had neither, so both headings rendered as the
    // raw key.
    expect(await screen.findByText("Taxation")).toBeTruthy();
    expect(screen.getByText("Economy")).toBeTruthy();
    expect(screen.queryByText("tax")).toBeNull();
    expect(screen.queryByText("economy")).toBeNull();
  });
});

describe("LawsTab tax-rate fallback panel", () => {
  it("hides the fallback rate panel when tax-domain records are present", async () => {
    mockFetch([record({ policyDomain: "tax", name: "State Sales Tax" })]);
    render(<LawsTab state={GA} />);
    await screen.findByText("Taxation");
    // The five us.tax.state* laws arrive as ordinary records now; rendering the
    // panel too would list every state rate twice.
    expect(screen.queryByText("State income tax rate")).toBeNull();
  });

  it("keeps the fallback rate panel for a country whose state taxes are not catalog laws", async () => {
    mockFetch([record({ policyDomain: "education", name: "Schools Act" })]);
    render(<LawsTab state={GA} />);
    await waitFor(() => expect(screen.getByText("State income tax rate")).toBeTruthy());
  });

  it("renders neither when there are no records and no rates", async () => {
    mockFetch([], null);
    render(<LawsTab state={GA} />);
    await waitFor(() =>
      expect(screen.getByText(/No state-level policy has been set yet/)).toBeTruthy()
    );
  });
});
