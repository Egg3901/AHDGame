/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ArsenalTab } from "./ArsenalTab";
import type {
  DefenceContractView,
  DefenceSupplierView,
  MilitaryUnitView,
} from "../../useCabinetOffice";

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

describe("ArsenalTab — awarding a contract", () => {
  // The whole C2 loop is inert without this form: a minister could see an empty arsenal and
  // an empty contract list with no way to connect the two.
  it("awards to the selected plant with the ordered lots", async () => {
    const onAwardContract = vi.fn(async () => true);
    setup({ onAwardContract });

    fireEvent.change(screen.getByLabelText("Supplier"), { target: { value: "s1" } });
    fireEvent.change(screen.getByLabelText("Lots ordered"), { target: { value: "5" } });
    fireEvent.click(screen.getByText("Offer contract"));

    // The third argument is the minister's optional price and grade (suggestions #291/#292);
    // an untouched form sends neither, so the route quotes a fair price at the plant's ceiling.
    expect(onAwardContract).toHaveBeenCalledWith("s1", 5, {});
  });

  // Quoting off a different price than the route bills would make the confirmation a lie.
  it("quotes lots x the going rate before the minister commits", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Supplier"), { target: { value: "s1" } });
    fireEvent.change(screen.getByLabelText("Lots ordered"), { target: { value: "5" } });
    expect(screen.getByText("Total if fully delivered")).toBeTruthy();
    // 5 lots x $1,000.
    expect(screen.getByText(/5,000/)).toBeTruthy();
  });

  it("shows how many turns the plant needs to fill the order", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Supplier"), { target: { value: "s1" } });
    fireEvent.change(screen.getByLabelText("Lots ordered"), { target: { value: "5" } });
    expect(screen.getByText(/about 1 turn to fill/)).toBeTruthy();
  });

  it("refuses to submit with no plant chosen or a non-positive order", () => {
    const onAwardContract = vi.fn(async () => true);
    setup({ onAwardContract });
    const button = screen.getByText("Offer contract") as HTMLButtonElement;

    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Supplier"), { target: { value: "s1" } });
    fireEvent.change(screen.getByLabelText("Lots ordered"), { target: { value: "0" } });
    expect(button.disabled).toBe(true);

    fireEvent.click(screen.getByText("Offer contract"));
    expect(onAwardContract).not.toHaveBeenCalled();
  });

  // A zero GDP is exactly what would price a contract at nothing, so the form closes rather
  // than awarding free materiel.
  it("disables the form when a lot cannot be priced", () => {
    setup({ lotPricePerLot: null });
    expect(screen.getByText(/no usable GDP figure/)).toBeTruthy();
    expect(screen.queryByLabelText("Supplier")).toBeNull();
  });

  it("explains an empty supplier list rather than showing a dead picker", () => {
    setup({ suppliers: [] });
    expect(screen.getByText(/No eligible supplier/)).toBeTruthy();
    expect(screen.queryByLabelText("Supplier")).toBeNull();
  });

  it("hides the form from someone who does not hold the seat", () => {
    setup({ canAct: false });
    expect(screen.getByText(/Only the defence minister may award/)).toBeTruthy();
  });

  // A plant serving two domains splits its output, and a plant already under contract splits
  // it again — both change what the order is actually worth.
  it("warns when the chosen plant is already committed", () => {
    setup({ suppliers: [supplier({ alreadyContracted: true })] });
    fireEvent.change(screen.getByLabelText("Supplier"), { target: { value: "s1" } });
    expect(screen.getByText(/already has an order/)).toBeTruthy();
  });

  it("lets a minister pick air on a two-domain plant (ticket 1134)", async () => {
    const onAwardContract = vi.fn(async () => true);
    setup({
      onAwardContract,
      suppliers: [supplier({ strategyId: "standard", components: ["ground", "air"] })],
    });
    fireEvent.change(screen.getByLabelText("Supplier"), { target: { value: "s1" } });
    fireEvent.change(screen.getByLabelText("Domain"), { target: { value: "air" } });
    fireEvent.change(screen.getByLabelText("Lots ordered"), { target: { value: "5" } });
    fireEvent.click(screen.getByText("Offer contract"));
    expect(onAwardContract).toHaveBeenCalledWith("s1", 5, { component: "air" });
  });

  it("warns when the chosen plant is producing nothing", () => {
    setup({ suppliers: [supplier({ projectedLotsPerTurn: 0 })] });
    fireEvent.change(screen.getByLabelText("Supplier"), { target: { value: "s1" } });
    fireEvent.change(screen.getByLabelText("Lots ordered"), { target: { value: "5" } });
    expect(screen.getByText(/producing nothing right now/)).toBeTruthy();
  });
});

describe("ArsenalTab — contracting allowance", () => {
  it("refuses an order past the supplier's current allowance", () => {
    const onAwardContract = vi.fn(async () => true);
    setup({ onAwardContract });
    fireEvent.change(screen.getByLabelText("Supplier"), { target: { value: "s1" } });
    fireEvent.change(screen.getByLabelText("Lots ordered"), { target: { value: "7" } });

    expect(screen.getByText(/at most 6 more lots/)).toBeTruthy();
    expect((screen.getByText("Offer contract") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText("Offer contract"));
    expect(onAwardContract).not.toHaveBeenCalled();
  });

  it("accepts an order exactly at the allowance", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Supplier"), { target: { value: "s1" } });
    fireEvent.change(screen.getByLabelText("Lots ordered"), { target: { value: "6" } });
    expect(screen.queryByText(/at most 6 more lots/)).toBeNull();
    expect((screen.getByText("Offer contract") as HTMLButtonElement).disabled).toBe(false);
  });
});
