/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ArsenalTab } from "./ArsenalTab";
import type {
  DefenceContractView,
  DefenceSupplierView,
  MilitaryUnitView,
} from "../../useCabinetOffice";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) =>
    key === "openBoard" ? "Open country contract board" : "Publish and award government tenders.",
}));

afterEach(cleanup);

const unit = (over: Partial<MilitaryUnitView> = {}) =>
  ({
    _id: "u1",
    domain: "ground",
    type: "Infantry Division",
    equipment: { firepower: 0, protection: 0, support: 0 },
    ...over,
  }) as MilitaryUnitView;

const contract = (over: Partial<DefenceContractView> = {}): DefenceContractView => ({
  _id: "c1",
  corporationId: "corp1",
  sectorId: "s1",
  supplierName: "Uralvagon Industrial",
  component: "ground",
  lotsOrdered: 100,
  lotsDelivered: 25,
  pricePerLot: 1_000,
  awardedTurn: 3,
  ...over,
});

const supplier = (over: Partial<DefenceSupplierView> = {}): DefenceSupplierView => ({
  sectorId: "s1",
  corporationId: "corp1",
  corporationName: "Uralvagon Industrial",
  plantLabel: "Sverdlovsk",
  strategyId: "heavy_armor",
  component: "ground",
  components: ["ground"],
  projectedLotsPerTurn: 20,
  gradeCeiling: 2,
  alreadyContracted: false,
  // 85% of the 1,000 lot price below. Build cost is a share of price now (ticket #1134), so a
  // fixture where the two are unrelated quotes a band the server would never produce.
  unitProductionCost: 850,
  freeFactories: 4,
  totalFactories: 4,
  stateOwned: false,
  availableLots: 6,
  allowanceWindowEndTurn: 12,
  ...over,
});

function setup(over: Partial<React.ComponentProps<typeof ArsenalTab>> = {}) {
  return render(
    <ArsenalTab
      countryId="US"
      arsenal={{
        stock: { ground: 40, naval: 0, air: 0, rocket: 0, space: 0, marine: 0 },
        grade: { ground: 2, naval: 0, air: 0, rocket: 0, space: 0, marine: 0 },
      }}
      contracts={[contract()]}
      units={[unit()]}
      currencySymbol="$"
      canAct
      busy={false}
      suppliers={[supplier()]}
      lotPricePerLot={1_000}
      onAwardContract={vi.fn(async () => true)}
      onCancelContract={vi.fn()}
      {...over}
    />
  );
}

describe("ArsenalTab", () => {
  it("lists every arm of service, including ones with nothing in store", () => {
    setup();
    for (const label of ["Ground", "Naval", "Air", "Rocket", "Marine", "Space"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("names the grade of what is in store rather than a bare number", () => {
    setup();
    expect(screen.getByText("Modernised")).toBeTruthy();
  });

  // A domain with no units needs nothing — reporting "0 needed" there would read as
  // satisfied rather than as not-applicable.
  it("distinguishes a domain with no units from one that is fully equipped", () => {
    setup({ units: [] });
    expect(screen.getAllByText("no units").length).toBeGreaterThan(0);
  });

  it("reports what the current roster is still short of", () => {
    setup();
    expect(screen.getByText(/needed/)).toBeTruthy();
  });

  // Without a contract the arsenal never fills, which is the one thing a new minister needs
  // told rather than left to infer from an empty table.
  it("explains the consequence when there are no contracts", () => {
    setup({ contracts: [] });
    expect(screen.getByText(/never fills/i)).toBeTruthy();
  });

  it("shows a contract's supplier, progress and unit price", () => {
    setup();
    expect(screen.getByText("Uralvagon Industrial")).toBeTruthy();
    expect(screen.getByText(/25 \/ 100/)).toBeTruthy();
    expect(screen.getByText(/25% delivered/)).toBeTruthy();
  });

  // Cancelling is destructive and irreversible, so it takes two clicks.
  it("requires confirmation before cancelling a contract", () => {
    const onCancelContract = vi.fn();
    setup({ onCancelContract });
    // fireEvent, not a raw DOM .click(): the latter runs outside React's act() and the
    // state change that swaps in the Confirm button is never flushed.
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onCancelContract).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(onCancelContract).toHaveBeenCalledWith("c1");
  });

  it("offers no cancel control to a viewer who cannot act", () => {
    setup({ canAct: false });
    expect(screen.queryByRole("button", { name: /^cancel$/i })).toBeNull();
  });

  it("renders without an arsenal document at all", () => {
    expect(() => setup({ arsenal: undefined, contracts: undefined })).not.toThrow();
  });
});

describe("ArsenalTab bidding replacement", () => {
  it("links to this country's defence tenders instead of selecting a supplier", () => {
    setup({ countryId: "JP" });
    expect(
      screen.getByRole("link", { name: "Open country contract board" }).getAttribute("href")
    ).toBe("/country/jp/government-contracts?type=defence");
    expect(screen.queryByText("Award a contract")).toBeNull();
    expect(screen.queryByRole("button", { name: "Offer contract" })).toBeNull();
  });
});
