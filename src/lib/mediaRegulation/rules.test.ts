import { describe, expect, it } from "vitest";
import {
  capDeliveredMediaUnits,
  mediaPoliticalResidualLimit,
  censorshipReachAvailability,
  currentTurnDeliveredAdvertisingUnits,
  isFairnessDoctrineBroadcastOutlet,
  isFairnessDoctrineInEffect,
  isMediaOwnershipBillAvailable,
  mediaAudienceAccessLimitUnitsByOutlet,
} from "./rules";

describe("media regulation availability", () => {
  it("counts current political reach from applied seller receipts, not planned units", () => {
    expect(
      currentTurnDeliveredAdvertisingUnits({
        snapshotTurn: 12,
        currentTurn: 12,
        physicalSoldUnits: 80,
        plannedPoliticalUnits: 20,
        settledPoliticalUnits: 10,
      })
    ).toBe(70);
    expect(
      currentTurnDeliveredAdvertisingUnits({
        snapshotTurn: 11,
        currentTurn: 12,
        physicalSoldUnits: 80,
        plannedPoliticalUnits: 20,
        settledPoliticalUnits: 10,
      })
    ).toBeNull();
    expect(
      currentTurnDeliveredAdvertisingUnits({
        snapshotTurn: 12,
        currentTurn: 12,
        physicalSoldUnits: 80,
        plannedPoliticalUnits: 20,
        settledPoliticalUnits: 0,
      })
    ).toBe(60);
  });

  it("ends the enacted US fairness doctrine at the 1987 repeal boundary", () => {
    expect(isFairnessDoctrineInEffect(1986, 2)).toBe(true);
    expect(isFairnessDoctrineInEffect(1987, 2)).toBe(false);
    expect(isFairnessDoctrineInEffect(1953, 3)).toBe(false);
    expect(isFairnessDoctrineInEffect(undefined, 0)).toBe(false);
    expect(isFairnessDoctrineBroadcastOutlet("media", "legacy_broadcast")).toBe(true);
    expect(isFairnessDoctrineBroadcastOutlet("media", "radio_network")).toBe(true);
    expect(isFairnessDoctrineBroadcastOutlet("media", "newspaper")).toBe(false);
    expect(isFairnessDoctrineBroadcastOutlet("media_entertainment", "film_studio")).toBe(false);
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

  it("limits prior audience access for corporations above the enacted threshold", () => {
    const result = mediaAudienceAccessLimitUnitsByOutlet(
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

    expect(result.get("CA:dominant")).toBeCloseTo(55);
    expect(result.has("CA:other")).toBe(false);
    expect(result.has("NY:dominant")).toBe(false);
  });

  it("limits a dominant outlet to 35 units of an 80/20 prior audience budget", () => {
    const result = mediaAudienceAccessLimitUnitsByOutlet(
      [
        {
          stateId: "CA",
          countryId: "US",
          corporationId: "dominant",
          deliveredAdvertisingUnits: 80,
        },
        { stateId: "CA", countryId: "US", corporationId: "other", deliveredAdvertisingUnits: 20 },
      ],
      0
    );

    expect(result.get("CA:dominant")).toBeCloseTo(35);
  });

  it("fails open for incomplete seller history and unregulated policy options", () => {
    const incomplete = mediaAudienceAccessLimitUnitsByOutlet(
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
      mediaAudienceAccessLimitUnitsByOutlet(
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
});

describe("audience ownership limits", () => {
  const rows = (units: number[], demand: number[] = units) =>
    units.map((units, index) => ({
      sectorId: String(index),
      stateId: "CA",
      corporationId: String(index),
      units,
      demandUnits: demand[index],
    }));
  it("caps an owner at the cap share of audience demand, not of rivals' delivery", () => {
    const limits = new Map<string, number>();
    const units = [...capDeliveredMediaUnits(rows([70, 30]), 0.65, undefined, limits).values()];
    expect(units[0]).toBeCloseTo(65);
    expect(units[1]).toBe(30);
    expect(limits.get("CA:0")).toBeCloseTo(65);
  });
  it("lets a sole seller serve up to the cap share of demand", () => {
    // The delivered-share rule left a sole seller with nothing.
    expect([...capDeliveredMediaUnits(rows([100], [100]), 0.65).values()]).toEqual([65]);
    expect([...capDeliveredMediaUnits(rows([50], [100]), 0.65).values()]).toEqual([50]);
  });
  it("does not tie a dominant seller to a small competitor's output", () => {
    // Old rule: 5 * 0.65 / 0.35 = 9.3 units for the dominant seller.
    const units = [...capDeliveredMediaUnits(rows([70, 5], [90, 10]), 0.65).values()];
    expect(units[0]).toBeCloseTo(65);
    expect(units[1]).toBe(5);
  });
  it("measures against the larger of the state's own demand and its book demand", () => {
    const units = [
      ...capDeliveredMediaUnits(rows([100], [20]), 0.65, new Map([["CA", 200]])).values(),
    ];
    expect(units).toEqual([100]);
    const bookOnly = [
      ...capDeliveredMediaUnits(rows([100], [100]), 0.65, new Map([["CA", 0]])).values(),
    ];
    expect(bookOnly).toEqual([65]);
  });
  it("combines split outlets under one owner and keeps states separate", () => {
    const result = capDeliveredMediaUnits(
      [
        ...rows([40, 30, 30]).map((row, index) => ({
          ...row,
          corporationId: index < 2 ? "same" : "other",
        })),
        { sectorId: "NY", stateId: "NY", corporationId: "same", units: 100, demandUnits: 50 },
      ],
      0.65
    );
    expect(result.get("0")! + result.get("1")!).toBeCloseTo(65);
    expect(result.get("0")! / result.get("1")!).toBeCloseTo(40 / 30);
    expect(result.get("2")).toBe(30);
    expect(result.get("NY")).toBeCloseTo(32.5);
  });
  it("bounds political delivery even when no other political seller is paid", () => {
    const extra = mediaPoliticalResidualLimit(20, 100, 0.65);
    expect((20 + extra) / (100 + extra)).toBeCloseTo(0.65);
    expect(mediaPoliticalResidualLimit(65, 100, 0.65)).toBe(0);
    expect(mediaPoliticalResidualLimit(0, 0, 0.65)).toBe(0);
  });
});
