import { describe, expect, it } from "vitest";
import { householdPurchaseOrders } from "./householdRules";
import { settleProducerMarket } from "./rules";

describe("funded household baskets", () => {
  it("allocates one real wallet across products and retains unspent cash when a supplier is absent", () => {
    const orders = householdPurchaseOrders({
      accountId: "household",
      cash: 100,
      spendFraction: 0.8,
      products: [
        { commodity: "food", book: "world", maximumUnitPrice: 2, weight: 1 },
        { commodity: "healthcare_services", book: "state:example", maximumUnitPrice: 4, weight: 1 },
      ],
    });
    expect(orders.reduce((sum, order) => sum + order.maximumSpend!, 0)).toBe(80);
    const result = settleProducerMarket({
      turn: 1,
      accounts: [
        { id: "household", cash: 100 },
        { id: "supplier", cash: 0 },
      ],
      orders,
      offers: [
        {
          id: "food",
          accountId: "supplier",
          commodity: "food",
          book: "world",
          units: 100,
          unitPrice: 1,
        },
      ],
    });
    // Cheaper food does not authorize spending the absent healthcare allocation.
    expect(result.accounts.find((account) => account.id === "household")!.cash).toBe(80);
    expect(result.trades[0]).toMatchObject({ units: 20, unitPrice: 1, amount: 20 });
  });

  it("caps an order independently from the wallet and rejects synthetic or duplicated budgets", () => {
    expect(() =>
      householdPurchaseOrders({
        accountId: "household",
        cash: 100,
        spendFraction: 1.1,
        products: [],
      })
    ).toThrow();
    const product = { commodity: "food", book: "world", maximumUnitPrice: 2, weight: 1 };
    expect(() =>
      householdPurchaseOrders({
        accountId: "household",
        cash: 100,
        spendFraction: 1,
        products: [product, product],
      })
    ).toThrow();
    const result = settleProducerMarket({
      turn: 1,
      accounts: [
        { id: "household", cash: 100 },
        { id: "supplier", cash: 0 },
      ],
      orders: [
        {
          id: "limited",
          accountId: "household",
          commodity: "food",
          book: "world",
          units: 100,
          maximumUnitPrice: 2,
          maximumSpend: 10,
        },
      ],
      offers: [
        {
          id: "food",
          accountId: "supplier",
          commodity: "food",
          book: "world",
          units: 100,
          unitPrice: 2,
        },
      ],
    });
    expect(result.trades[0]).toMatchObject({ units: 5, amount: 10 });
  });
});
