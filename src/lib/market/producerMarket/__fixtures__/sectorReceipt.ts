import { advanceProducerEconomy } from "../production";

export function sectorReceipt() {
  const result = advanceProducerEconomy({
    turn: 7,
    accounts: [
      { id: "corp", cash: 1000 },
      { id: "households", cash: 1000 },
    ],
    producers: [
      {
        id: "finance",
        accountId: "corp",
        capacityUnits: 100,
        activeFraction: 1,
        outputMultiplier: 0.02,
        inputs: [],
        outputs: [
          {
            commodity: "financial_services",
            book: "world",
            unitsPerOutput: 1,
            policy: { kind: "manual", unitPrice: 3 },
            referenceUnitPrice: 3,
            storable: false,
          },
        ],
        labourCost: 20,
        otherOperatingCost: 0,
        labourRecipientAccountId: "households",
        operatingRecipientAccountId: "households",
        inputStock: [],
        outputStock: [],
      },
    ],
    externalOrders: [
      {
        id: "buyer",
        accountId: "households",
        commodity: "financial_services",
        book: "world",
        units: 2,
        maximumUnitPrice: 3,
      },
    ],
  });
  return { ...result.producers[0], worldEpoch: "example", turn: 7 };
}
