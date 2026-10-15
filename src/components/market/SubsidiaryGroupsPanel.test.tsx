/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en/corporations.json";
import { SubsidiaryGroupsPanel } from "./SubsidiaryGroupsPanel";
vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({ formatAmount: (n: number) => `A${n}` }),
}));
vi.mock("@/contexts/RegisteredCountriesContext", () => ({
  useCountryDisplayName: () => (id: string) => id,
}));
vi.mock("@/components/corporation/CorporationLogo", () => ({
  CorporationLogo: ({ name }: { name: string }) => <span>{name} icon</span>,
}));
const groups = [
  {
    isNpp: false,
    id: "A",
    pathId: "1",
    name: "Harbor Group",
    parentName: "Harbor",
    countryId: "US",
    members: [{ name: "Hidden logistics" }],
    countries: ["US"],
    industries: ["logistics"],
    equityValueAnchor: 100,
    cashAnchor: 20,
    revenueAnchor: 30,
    sectorCount: 2,
  },
  {
    isNpp: false,
    id: "B",
    pathId: "2",
    name: "Nested Group",
    parentName: "Nested",
    countryId: "UK",
    members: [{ name: "Nested bank" }],
    countries: ["US", "UK"],
    industries: ["banking"],
    equityValueAnchor: 200,
    cashAnchor: 40,
    revenueAnchor: 60,
    sectorCount: 4,
  },
];
type Listing = Omit<
  (typeof groups)[number],
  "equityValueAnchor" | "cashAnchor" | "revenueAnchor"
> & { equityValueAnchor: number | null; cashAnchor: number | null; revenueAnchor: number | null };
let listings: Listing[] = groups;
vi.mock("./useMarketJson", () => ({
  useMarketJson: () => ({ data: { groups: listings }, loading: false, error: "" }),
}));
function mount(country = "global") {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SubsidiaryGroupsPanel country={country} />
    </NextIntlClientProvider>
  );
}
beforeEach(() => {
  cleanup();
  groups[0].isNpp = false;
  listings = groups;
});
describe("subsidiary group listings", () => {
  it("searches members, filters industries and links the nested group's own overview", () => {
    mount();
    expect(screen.getByRole("link", { name: /Nested Group/ }).getAttribute("href")).toBe(
      "/corporation/2/group"
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hidden" } });
    expect(screen.queryByRole("link", { name: /Nested Group/ })).toBeNull();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Industry" }), {
      target: { value: "banking" },
    });
    expect(screen.queryByRole("link", { name: /Harbor Group/ })).toBeNull();
  });
  it("uses country footprint and sorts by equity value", () => {
    mount("US");
    expect(screen.getAllByRole("link")[0].textContent).toContain("Nested Group");
    fireEvent.click(screen.getByRole("button", { name: "Descending" }));
    expect(screen.getAllByRole("link")[0].textContent).toContain("Harbor Group");
  });
  it("hides NPP-led groups until requested", () => {
    groups[0].isNpp = true;
    mount();
    expect(screen.queryByRole("link", { name: /Harbor Group/ })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /Show NPP groups/ }));
    expect(screen.getByRole("link", { name: /Harbor Group/ })).toBeTruthy();
  });
  it("paginates larger listings and resets the page when searching", () => {
    listings = Array.from({ length: 12 }, (_, index) => ({
      ...groups[0],
      id: `group-${index}`,
      pathId: String(index + 10),
      name: `Group ${index + 1}`,
    }));
    mount();
    expect(screen.getAllByRole("link")).toHaveLength(10);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getAllByRole("link")).toHaveLength(2);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Group 12" } });
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Previous" }).hasAttribute("disabled")).toBe(true);
  });
  it("keeps unavailable amounts last in both sort directions and never formats them as zero", () => {
    listings = [
      { ...groups[0], cashAnchor: null, revenueAnchor: null, equityValueAnchor: null },
      groups[1],
    ];
    mount();
    expect(screen.getAllByText("Unavailable")).toHaveLength(3);
    expect(screen.getAllByRole("link")[0].textContent).toContain("Nested Group");
    fireEvent.change(screen.getByRole("combobox", { name: "Sort by" }), {
      target: { value: "cashAnchor" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Descending" }));
    expect(screen.getAllByRole("link")[0].textContent).toContain("Nested Group");
    expect(screen.queryByText("A0")).toBeNull();
  });
  it("stabilizes tied names and amounts with the corporation ID", () => {
    listings = [
      { ...groups[1], name: "Same", equityValueAnchor: null },
      { ...groups[0], name: "Same", equityValueAnchor: null },
    ];
    mount();
    expect(screen.getAllByRole("link")[0].getAttribute("href")).toBe("/corporation/1/group");
    fireEvent.change(screen.getByRole("combobox", { name: "Sort by" }), {
      target: { value: "name" },
    });
    expect(screen.getAllByRole("link")[0].getAttribute("href")).toBe("/corporation/1/group");
  });
  it("explains an empty filter result", () => {
    mount("JP");
    expect(screen.getByText("No subsidiary groups match these filters.")).toBeTruthy();
  });
});
