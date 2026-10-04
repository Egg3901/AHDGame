import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  censorshipReachAvailability,
  isFairnessDoctrineInEffect,
  isMediaOwnershipBillAvailable,
  mediaAudienceAccessLimitUnitsByOutlet,
} from "@/lib/mediaRegulation/rules";
import { COMMODITY_TYPES, type CommodityType } from "@/lib/constants/commodities";
import { computeClearingFactors, type SectorClearingInput } from "@/lib/market/clearing";
import { settlePoliticalAdMarket } from "@/lib/politicalMedia/market";

const outlets = [
  { stateId: "CA", countryId: "US", corporationId: "network-a", deliveredAdvertisingUnits: 80 },
  { stateId: "CA", countryId: "US", corporationId: "network-b", deliveredAdvertisingUnits: 20 },
];

const audienceLimitCases = [0, 1, 2, 3, 4, 5, 6].map((policyOptionIndex) => {
  const limitUnits = mediaAudienceAccessLimitUnitsByOutlet(outlets, policyOptionIndex);
  const networkAAvailability = Math.min(1, (limitUnits.get("CA:network-a") ?? 80) / 80);
  const networkBAvailability = Math.min(1, (limitUnits.get("CA:network-b") ?? 20) / 20);
  return {
    policyOptionIndex,
    networkAAvailability: round(networkAAvailability),
    networkBAvailability: round(networkBAvailability),
    networkAAccessLimitedUnitsAgainstPriorBudget: round(80 * networkAAvailability),
    networkBAvailableUnits: round(20 * networkBAvailability),
    filledAgainstStrongPoliticalDemand: clearFundedPoliticalResidual(
      networkAAvailability,
      networkBAvailability
    ),
  };
});

const censorshipCases = [
  { name: "open press", pressFreedom: 100, stateMediaControl: 0 },
  { name: "restricted press", pressFreedom: 50, stateMediaControl: 65 },
  { name: "state controlled press", pressFreedom: 10, stateMediaControl: 100 },
].map((state) => ({
  ...state,
  privateOutletAvailability: round(censorshipReachAvailability(state)),
}));

const ownershipTriggerCases = [
  {
    label: "at national threshold",
    outlets: [
      { stateId: "CA", countryId: "US", corporationId: "network-a", deliveredAdvertisingUnits: 65 },
      { stateId: "CA", countryId: "US", corporationId: "network-b", deliveredAdvertisingUnits: 35 },
    ],
  },
  {
    label: "above national threshold",
    outlets: [
      { stateId: "CA", countryId: "US", corporationId: "network-a", deliveredAdvertisingUnits: 66 },
      { stateId: "CA", countryId: "US", corporationId: "network-b", deliveredAdvertisingUnits: 34 },
    ],
  },
  {
    label: "one state is concentrated but national share is below threshold",
    outlets: [
      { stateId: "CA", countryId: "US", corporationId: "network-a", deliveredAdvertisingUnits: 66 },
      { stateId: "CA", countryId: "US", corporationId: "network-b", deliveredAdvertisingUnits: 34 },
      { stateId: "NY", countryId: "US", corporationId: "network-a", deliveredAdvertisingUnits: 10 },
      { stateId: "NY", countryId: "US", corporationId: "network-b", deliveredAdvertisingUnits: 90 },
    ],
  },
  {
    label: "foreign output is excluded from US concentration",
    outlets: [
      { stateId: "CA", countryId: "US", corporationId: "network-a", deliveredAdvertisingUnits: 66 },
      { stateId: "CA", countryId: "US", corporationId: "network-b", deliveredAdvertisingUnits: 34 },
      {
        stateId: "CN-11",
        countryId: "CN",
        corporationId: "network-a",
        deliveredAdvertisingUnits: 1_000,
      },
    ],
  },
].map((scenario) => ({
  label: scenario.label,
  billAvailable: isMediaOwnershipBillAvailable(scenario.outlets),
}));

const fairnessEraCases = [1986, 1987].map((currentYear) => ({
  currentYear,
  regulatedPolicyOptionIndex: 2,
  fairnessDoctrineInEffect: isFairnessDoctrineInEffect(currentYear, 2),
}));

const fresh1991RuleContext = {
  currentYear: 1991,
  representativePolicyOptionIndex: 3,
  fairnessDoctrineInEffect: isFairnessDoctrineInEffect(1991, 2),
  ownershipBillAvailableAtMeasured80To20Share: isMediaOwnershipBillAvailable(outlets),
  audienceAvailabilityAtRepresentativeOption: audienceLimitCases[3]?.networkAAvailability ?? 1,
};

const report = {
  title: "Media regulation advertising availability diagnostic",
  method:
    "Runs the production media regulation rules against a measured prior-turn US advertising split and authored press metrics. This is a rule sensitivity report, not a world simulation or a 1991 seed target.",
  assumptions: {
    priorDeliveredAdvertisingUnitsByOutlet: { "network-a": 80, "network-b": 20 },
    currentTurnPhysicalAdvertisingUnits: { "network-a": 80, "network-b": 20 },
    missingHistoryBehavior: "audience access enforcement fails open for that state",
    audienceAccessLimitDefinition:
      "each owner's access limit is measured against prior delivered advertising; unserved audience remains unserved",
    ownershipBillThresholdScope: "national US aggregate, with foreign delivery excluded",
    enactedAudienceAccessLimitScope:
      "each US state audience market; no ownership divestiture is modeled",
  },
  audienceLimitCases,
  censorshipCases,
  ownershipTriggerCases,
  fairnessEraCases,
  fresh1991RuleContext,
  accounting: {
    deliveryIsBoundedBeforeCommercialAndFundedPoliticalClearing: true,
    noAdvertisingUnitsAreCreated: true,
    accessLimitUsesPriorAudienceBudgetNotPostLimitShare: true,
    unmeasuredHistoryDoesNotInventConcentration: true,
    fundedPoliticalBuyerDebitEqualsSellerReceipt: audienceLimitCases.every(
      (scenario) => scenario.filledAgainstStrongPoliticalDemand.payoutMatchesDeliveredAnchor
    ),
    partialPoliticalFillRetainsUnfilledBudget: audienceLimitCases.every(
      (scenario) => scenario.filledAgainstStrongPoliticalDemand.refundAnchor > 0
    ),
  },
};

async function main() {
  const output = new URL("./mediaRegulationRules.report.json", import.meta.url);
  await mkdir(dirname(output.pathname), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
}

void main();

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function clearFundedPoliticalResidual(networkAAvailability: number, networkBAvailability: number) {
  const basePrices = Object.fromEntries(
    COMMODITY_TYPES.map((commodity) => [commodity, 1])
  ) as Record<CommodityType, number>;
  const sectors: SectorClearingInput[] = [
    {
      sectorId: "network-a",
      revenue: 80,
      supplyRates: { advertising: 1 },
      posture: 0,
      editorialAdvertisingAvailability: networkAAvailability,
    },
    {
      sectorId: "network-b",
      revenue: 20,
      supplyRates: { advertising: 1 },
      posture: 0,
      editorialAdvertisingAvailability: networkBAvailability,
    },
  ];
  const clearingBySectorId = computeClearingFactors({
    sectors,
    balances: new Map([["advertising", { supply: 100, demand: 50 }]]),
    priceRatioByCommodity: new Map([["advertising", 1]]),
    basePrices,
    plantsEnabled: false,
  });
  const commercialUnits =
    (clearingBySectorId.get("network-a")?.soldByCommodity?.advertising ?? 0) * 80 +
    (clearingBySectorId.get("network-b")?.soldByCommodity?.advertising ?? 0) * 20;
  const settlement = settlePoliticalAdMarket({
    orders: [
      {
        orderId: "funded-political-order",
        countryId: "US",
        stateId: "CA",
        createdTurn: 1,
        budgetAnchor: 10_000,
      },
    ],
    offers: sectors.map((input) => ({
      input,
      clearing: clearingBySectorId.get(input.sectorId),
      corporationId: input.sectorId,
      countryId: "US",
      stateId: "CA",
      basePrice: 1,
      priceRatio: 1,
      sellerCurrencyCode: "AHD",
      sellerLocalPerAnchor: 1,
      offeredUnits: input.sectorId === "network-a" ? 80 : 20,
    })),
    clearingBySectorId,
    clearingEnabled: true,
    qualityPremiumEnabled: false,
    turn: 1,
  });
  const politicalUnits = settlement.allocations[0]?.deliveredUnits ?? 0;
  const availableUnits = 80 * networkAAvailability + 20 * networkBAvailability;
  const allocation = settlement.allocations[0];
  const deliveredAnchor = allocation?.deliveredAnchor ?? 0;
  const sellerReceiptAnchor = [...settlement.sellerPayoutLocalByCorpId.values()].reduce(
    (sum, amount) => sum + amount,
    0
  );
  return {
    rawProducedUnits: 100,
    availableUnits: round(availableUnits),
    commercialUnits: round(commercialUnits),
    fundedPoliticalUnits: round(politicalUnits),
    totalUnits: round(commercialUnits + politicalUnits),
    remainingProducedUnits: round(Math.max(0, 100 - commercialUnits - politicalUnits)),
    overflowUnits: round(Math.max(0, commercialUnits + politicalUnits - availableUnits)),
    deliveredPoliticalAnchor: round(deliveredAnchor),
    refundAnchor: round(allocation?.unfilledAnchor ?? 0),
    sellerReceiptAnchor: round(sellerReceiptAnchor),
    payoutMatchesDeliveredAnchor: Math.abs(deliveredAnchor - sellerReceiptAnchor) < 1e-6,
  };
}
