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
vi.mock("./useMarketJson", () => ({
  useMarketJson: () => ({ data: { groups }, loading: false, error: "" }),
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
  it("explains an empty filter result", () => {
    mount("JP");
    expect(screen.getByText("No subsidiary groups match these filters.")).toBeTruthy();
  });
});
