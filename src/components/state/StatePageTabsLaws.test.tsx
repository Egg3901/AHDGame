/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { LawsTab } from "./StatePageTabsLaws";
import type { State } from "@/lib/db/types";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

const GA = { _id: "GA", name: "Georgia", countryId: "US" } as State;

const TAX_RATES = {
  incomeTax: 5,
  salesTax: 4,
  domesticCorporateTax: 6,
  foreignCorporateTax: 7,
  propertyTax: 1,
};

let seq = 0;
function record(overrides: Record<string, unknown>) {
  return {
    legislationTypeId: `type-${seq++}`,
    name: "A Law",
    policyDomain: "governance",
    policyOptionName: "Some Option",
    hasEconomic: false,
    hasSocial: false,
    economic: 0,
    social: 0,
    metricEffects: [],
    weightedEffects: [],
    ...overrides,
  };
}

/**
 * LawsTab makes three fetches: policy records, the region budget, and the
 * region policy record. `/policy/record` must be matched BEFORE `/policy`, or
 * the record fetch silently receives the records array — which is exactly the
 * shape that used to crash the statute book.
 */
function mockFetch(
  records: unknown[],
  taxRates: unknown = TAX_RATES,
  recordPayload: unknown = null
) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url.includes("policy/record")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(recordPayload) });
      }
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
  it("labels the tax and economy domains instead of printing raw internal keys", async () => {
    mockFetch([
      record({ policyDomain: "tax", name: "State Sales Tax" }),
      record({ policyDomain: "economy", name: "Productivity Act" }),
      record({ policyDomain: "education", name: "Schools Act" }),
    ]);
    render(<LawsTab state={GA} />);

    // Live regression: GA carries `tax` and `economy` rows, and the tab's own
    // eight-entry label table had neither, so both headings rendered as the raw
    // internal key.
    expect(await screen.findByText(/Title I — Taxation/)).toBeTruthy();
    expect(screen.getByText(/— Economy$/)).toBeTruthy();
    expect(screen.queryByText(/— tax$/)).toBeNull();
    expect(screen.queryByText(/— economy$/)).toBeNull();
  });

  it("renders the statute book grammar, not a bare accordion", async () => {
    mockFetch([record({ policyDomain: "education", name: "Schools Act" })]);
    render(<LawsTab state={GA} />);

    // The masthead names the region, and titles are numbered, which is the
    // whole point of sharing the national renderer.
    //
    // BOTH awaited: the masthead and the statute body do not land in the same
    // paint, so awaiting only the masthead and then reading the title
    // synchronously is a race. It held on a fast machine and lost on CI, where
    // the assertion ran against the skeleton loaders.
    expect(await screen.findByText(/Code of State Law · Georgia/)).toBeTruthy();
    expect(await screen.findByText(/Title I — Education/)).toBeTruthy();
  });
});

describe("LawsTab tax-rate fallback panel", () => {
  it("hides the fallback rate panel when tax-domain records are present", async () => {
    mockFetch([record({ policyDomain: "tax", name: "State Sales Tax" })]);
    render(<LawsTab state={GA} />);
    await screen.findByText(/Title I — Taxation/);
    // The five us.tax.state* laws arrive as ordinary records now; rendering the
    // panel too would list every state rate twice.
    expect(screen.queryByText("State income tax rate")).toBeNull();
  });

  it("keeps the fallback rate panel for a country whose state taxes are not catalog laws", async () => {
    mockFetch([record({ policyDomain: "education", name: "Schools Act" })]);
    render(<LawsTab state={GA} />);
    await waitFor(() => expect(screen.getByText("State income tax rate")).toBeTruthy());
  });

  it("shows the region empty state when there are no records and no rates", async () => {
    mockFetch([], null);
    render(<LawsTab state={GA} />);
    await waitFor(() =>
      expect(screen.getByText(/No laws of its own on the books in Georgia yet/)).toBeTruthy()
    );
  });
});

describe("LawsTab record payload", () => {
  it("survives a record payload that carries no provenance map", async () => {
    // A partial or malformed payload must degrade to the "standing law"
    // subline rather than take the whole statute book down.
    mockFetch([record({ policyDomain: "education", name: "Schools Act" })], TAX_RATES, {
      points: [],
      events: [],
      era: null,
    });
    render(<LawsTab state={GA} />);
    expect(await screen.findByText(/Title I — Education/)).toBeTruthy();
    expect(screen.getByText("Schools Act")).toBeTruthy();
  });
});
