import { describe, expect, it } from "vitest";
import {
  censorshipReachAvailability,
  isFairnessDoctrineInEffect,
  isMediaOwnershipBillAvailable,
  mediaOwnershipAvailabilityByOutlet,
  mediaRegulationAvailabilityByOutlet,
} from "./rules";

describe("media regulation availability", () => {
  it("ends the enacted US fairness doctrine at the 1987 repeal boundary", () => {
    expect(isFairnessDoctrineInEffect(1986, 2)).toBe(true);
    expect(isFairnessDoctrineInEffect(1987, 2)).toBe(false);
    expect(isFairnessDoctrineInEffect(1953, 3)).toBe(false);
    expect(isFairnessDoctrineInEffect(undefined, 0)).toBe(false);
  });

  it("offers the national ownership bill only after measured US concentration exceeds 65%", () => {
    expect(
      isMediaOwnershipBillAvailable([
        { stateId: "CA", countryId: "US", corporationId: "a", deliveredAdvertisingUnits: 65 },
        { stateId: "CA", countryId: "US", corporationId: "b", deliveredAdvertisingUnits: 35 },
      ])
    ).toBe(false);
    expect(
      isMediaOwnershipBillAvailable([
        { stateId: "CA", countryId: "US", corporationId: "a", deliveredAdvertisingUnits: 90 },
        { stateId: "CA", countryId: "US", corporationId: "b", deliveredAdvertisingUnits: 10 },
        { stateId: "NY", countryId: "US", corporationId: "a", deliveredAdvertisingUnits: 10 },
        { stateId: "NY", countryId: "US", corporationId: "b", deliveredAdvertisingUnits: 90 },
      ])
    ).toBe(false);
    expect(
      isMediaOwnershipBillAvailable([
        { stateId: "CA", countryId: "US", corporationId: "a", deliveredAdvertisingUnits: 66 },
        { stateId: "CA", countryId: "US", corporationId: "b", deliveredAdvertisingUnits: 34 },
        { stateId: "CA", countryId: "CN", corporationId: "a", deliveredAdvertisingUnits: 1_000 },
      ])
    ).toBe(true);
    expect(
      isMediaOwnershipBillAvailable([
        { stateId: "CA", countryId: "US", corporationId: "a", deliveredAdvertisingUnits: 66 },
        { stateId: "CA", countryId: "US", corporationId: "b", deliveredAdvertisingUnits: 34 },
      ])
    ).toBe(true);
    expect(
      isMediaOwnershipBillAvailable([
        { stateId: "CA", countryId: "US", corporationId: "a", deliveredAdvertisingUnits: 99 },
        { stateId: "CA", countryId: "US", corporationId: "b", deliveredAdvertisingUnits: null },
      ])
    ).toBe(false);
  });

  it("keeps open and missing press metrics neutral and bounds authoritarian censorship", () => {
    expect(censorshipReachAvailability({ pressFreedom: 100, stateMediaControl: 0 })).toBe(1);
    expect(censorshipReachAvailability({})).toBe(1);
    expect(censorshipReachAvailability({ pressFreedom: 0, stateMediaControl: 100 })).toBe(0.5);
  });

  it("caps only corporations above the enacted ownership limit in each state audience market", () => {
    const result = mediaOwnershipAvailabilityByOutlet(
      [
        {
          stateId: "CA",
          countryId: "US",
          corporationId: "dominant",
          deliveredAdvertisingUnits: 70,
        },
        { stateId: "CA", countryId: "US", corporationId: "other", deliveredAdvertisingUnits: 30 },
        { stateId: "NY", countryId: "US", corporationId: "dominant", deliveredAdvertisingUnits: 1 },
        { stateId: "NY", countryId: "US", corporationId: "other", deliveredAdvertisingUnits: 99 },
      ],
      2
    );

    expect(result.get("CA:dominant")).toBeCloseTo(0.55 / 0.7);
    expect(result.has("CA:other")).toBe(false);
    expect(result.has("NY:dominant")).toBe(false);
  });

  it("fails open for incomplete seller history and unregulated policy options", () => {
    const incomplete = mediaOwnershipAvailabilityByOutlet(
      [
        {
          stateId: "CA",
          countryId: "US",
          corporationId: "dominant",
          deliveredAdvertisingUnits: 90,
        },
        {
          stateId: "CA",
          countryId: "US",
          corporationId: "unmeasured",
          deliveredAdvertisingUnits: null,
        },
      ],
      0
    );

    expect(incomplete.size).toBe(0);
    expect(
      mediaOwnershipAvailabilityByOutlet(
        [
          {
            stateId: "CA",
            countryId: "US",
            corporationId: "dominant",
            deliveredAdvertisingUnits: 90,
          },
        ],
        5
      ).size
    ).toBe(0);
  });

  it("composes ownership caps and press controls for the same pre-clearing offer", () => {
    const result = mediaRegulationAvailabilityByOutlet({
      policyOptionIndex: 0,
      outlets: [
        {
          stateId: "CA",
          countryId: "US",
          corporationId: "dominant",
          deliveredAdvertisingUnits: 90,
        },
        { stateId: "CA", countryId: "US", corporationId: "other", deliveredAdvertisingUnits: 10 },
      ],
      stateConditionsById: new Map([["CA", { pressFreedom: 60, stateMediaControl: 70 }]]),
    });

    expect(result.get("CA:dominant")).toBeCloseTo(0.74 * (0.35 / 0.9));
    expect(result.get("CA:other")).toBeCloseTo(0.74);
  });

  it("limits ownership only under the US media act, while censorship stays state based", () => {
    const result = mediaRegulationAvailabilityByOutlet({
      policyOptionIndex: 0,
      outlets: [
        {
          stateId: "CA",
          countryId: "US",
          corporationId: "dominant",
          deliveredAdvertisingUnits: 90,
        },
        { stateId: "CA", countryId: "US", corporationId: "other", deliveredAdvertisingUnits: 10 },
        {
          stateId: "CN-11",
          countryId: "CN",
          corporationId: "dominant",
          deliveredAdvertisingUnits: 90,
        },
        {
          stateId: "CN-11",
          countryId: "CN",
          corporationId: "other",
          deliveredAdvertisingUnits: 10,
        },
      ],
      stateConditionsById: new Map([
        ["CA", { pressFreedom: 100, stateMediaControl: 0 }],
        ["CN-11", { pressFreedom: 0, stateMediaControl: 100 }],
      ]),
    });

    expect(result.get("CA:dominant")).toBeCloseTo(0.35 / 0.9);
    expect(result.get("CN-11:dominant")).toBe(0.5);
  });
});
