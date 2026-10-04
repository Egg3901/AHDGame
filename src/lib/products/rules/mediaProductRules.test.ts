import { describe, expect, it } from "vitest";
import { MEDIA_PRODUCT_KINDS, getMediaProductKind, tailDemandFactor } from "../mediaProductCatalog";
import {
  advanceMediaProduct,
  mediaDevelopmentThresholdAnchor,
  mediaProductAdvertisingReceiptAnchor,
  settledMediaAdvertisingAnchor,
  mediaLaunchQuality,
  mediaProductBrand,
  mediaProductBrandBonus,
  mediaProductQualityForStage,
  aggregateMediaProductSectorEffects,
  startMediaProduct,
  chooseNppMediaProduct,
  shouldRetireChronicMediaDevelopment,
} from "./mediaProductRules";

describe("media product lifecycle rules", () => {
  it("gives newspaper, radio, television, publishing, and studio distinct coverage and cadence", () => {
    const supported = ["newspaper_edition", "radio_program", "television_series", "book", "film"];
    const profiles = supported.map((id) => getMediaProductKind(id)!);
    expect(profiles.every(Boolean)).toBe(true);
    expect(new Set(profiles.map((profile) => profile.coverage)).size).toBe(profiles.length);
    expect(new Set(profiles.map((profile) => profile.durations.development)).size).toBe(
      profiles.length
    );
    expect(MEDIA_PRODUCT_KINDS.find((kind) => kind.id === "streaming_original")?.modelId).toBe(
      "streaming_platform"
    );
  });

  it("starts only an enabled, named slate on real capacity", () => {
    const kind = getMediaProductKind("newspaper_edition")!;
    expect(
      startMediaProduct({
        enabled: false,
        activeDevelopment: null,
        kind,
        title: "Daily",
        productId: "product",
        turn: 1,
        capacityBookAnchor: 100,
        allocationShare: 1,
      })
    ).toBeNull();
    expect(
      startMediaProduct({
        enabled: true,
        activeDevelopment: null,
        kind,
        title: "Daily",
        productId: "product",
        turn: 1,
        capacityBookAnchor: 0,
        allocationShare: 1,
      })
    ).toBeNull();
    expect(mediaDevelopmentThresholdAnchor(100)).toBe(5);
    expect(mediaDevelopmentThresholdAnchor(0)).toBe(1);
  });

  it("attributes brand only from delivered advertising that fits available operating cash", () => {
    expect(
      settledMediaAdvertisingAnchor({
        requestedAnchor: 500,
        availableCashAnchor: 0,
        deliveredValueAnchor: 400,
      })
    ).toBe(0);
    expect(
      settledMediaAdvertisingAnchor({
        requestedAnchor: 500,
        availableCashAnchor: 120,
        deliveredValueAnchor: 400,
      })
    ).toBe(120);
    expect(mediaProductAdvertisingReceiptAnchor(300, 0.5)).toBe(150);
    expect(mediaProductAdvertisingReceiptAnchor(0, 0.5)).toBe(0);
  });

  it("requires paid R&D and model cadence before launch, then freezes quality and actual ad brand", () => {
    const kind = getMediaProductKind("newspaper_edition")!;
    const project = startMediaProduct({
      enabled: true,
      activeDevelopment: null,
      kind,
      title: "Morning Ledger",
      productId: "product-1",
      turn: 10,
      capacityBookAnchor: 100,
      allocationShare: 0.5,
    })!;
    const first = advanceMediaProduct({
      product: project,
      kind,
      receipt: {
        projectId: project.id,
        turn: 11,
        amountAnchor: 2.5,
        deliveredAdvertisingAnchor: 0,
      },
      sectorQuality: 60,
      relevantTechnologyUnlocked: false,
    })!;
    expect(first.product.stage).toBe("development");
    const launch = advanceMediaProduct({
      product: first.product,
      kind,
      receipt: {
        projectId: project.id,
        turn: 12,
        amountAnchor: 2.5,
        deliveredAdvertisingAnchor: 400,
      },
      sectorQuality: 60,
      relevantTechnologyUnlocked: false,
    })!;
    expect(launch.product.stage).toBe("launch");
    expect(launch.product.launchQuality).toBe(70);
    expect(launch.product.productBrand).toBe(200);
    expect(
      advanceMediaProduct({
        product: launch.product,
        kind,
        receipt: {
          projectId: project.id,
          turn: 12,
          amountAnchor: 2.5,
          deliveredAdvertisingAnchor: 400,
        },
        sectorQuality: 60,
        relevantTechnologyUnlocked: false,
      })
    ).toBeNull();
  });

  it("adds four-pillar baseline, paid research, and the relevant model technology once", () => {
    const withoutTech = mediaLaunchQuality({
      sectorQuality: 70,
      developmentPaidAnchor: 100,
      paidThresholdAnchor: 100,
      relevantTechnologyUnlocked: false,
    });
    const withTech = mediaLaunchQuality({
      sectorQuality: 70,
      developmentPaidAnchor: 100,
      paidThresholdAnchor: 100,
      relevantTechnologyUnlocked: true,
    });
    expect(withoutTech).toEqual({ quality: 80, bonus: 10 });
    expect(withTech).toEqual({ quality: 85, bonus: 15 });
  });

  it("uses paid owner advertising for brand and applies bounded coverage and lifecycle effects", () => {
    expect(mediaProductBrand(1_000, 10)).toBe(100);
    expect(mediaProductBrandBonus(100, 0.15)).toBeLessThan(mediaProductBrandBonus(100, 0.8));
    expect(mediaProductBrandBonus(1e15, 1)).toBe(10);
    const kind = getMediaProductKind("television_series")!;
    expect(mediaProductQualityForStage(60, { stage: "growth", qualityBonus: 10, kind })).toBe(66);
    expect(mediaProductQualityForStage(60, { stage: "retired", qualityBonus: 10, kind })).toBe(60);
  });

  it("blends multiple catalog titles over existing output shares without adding units", () => {
    const kind = getMediaProductKind("television_series")!;
    const result = aggregateMediaProductSectorEffects({
      baseQuality: 60,
      projects: [
        {
          kind,
          project: {
            id: "one",
            kindId: kind.id,
            stage: "mature",
            allocationShare: 0.6,
            qualityBonus: 10,
            productBrand: 10_000,
            startedTurn: 0,
            stageStartedTurn: 0,
            developmentPaidAnchor: 1,
            paidThresholdAnchor: 1,
            elapsedDevelopmentTurns: 1,
            elapsedThresholdTurns: 1,
            developmentAdvertisingAnchor: 1,
            developmentAdvertisingTurns: 1,
          },
        },
        {
          kind,
          project: {
            id: "two",
            kindId: kind.id,
            stage: "growth",
            allocationShare: 0.6,
            qualityBonus: 10,
            productBrand: 10_000,
            startedTurn: 0,
            stageStartedTurn: 0,
            developmentPaidAnchor: 1,
            paidThresholdAnchor: 1,
            elapsedDevelopmentTurns: 1,
            elapsedThresholdTurns: 1,
            developmentAdvertisingAnchor: 1,
            developmentAdvertisingTurns: 1,
          },
        },
      ],
    });
    expect(result.allocatedShare).toBe(1);
    expect(result.quality).toBe(66.7);
    expect(result.loyaltyBonus).toBe(3.4);
  });

  it("keeps ephemeral editions out of catalog tails and bounds backlist and syndication", () => {
    expect(tailDemandFactor("decline", "none")).toBe(0);
    expect(tailDemandFactor("decline", "short")).toBe(0.15);
    expect(tailDemandFactor("decline", "backlist")).toBe(0.35);
    expect(tailDemandFactor("decline", "syndication")).toBe(0.45);
    expect(tailDemandFactor("retired", "backlist")).toBe(0);
  });

  it("starts deterministic bounded NPP slates only from active available media models", () => {
    const input = {
      enabled: true,
      isNpp: true,
      currentYear: 1991,
      hasActiveDevelopment: false,
      liveTitleCount: 0,
      sectors: [
        {
          sectorId: "lower-revenue",
          sectorType: "media",
          strategyId: "newspaper",
          capitalStock: 100,
          revenue: 10,
        },
        {
          sectorId: "higher-revenue",
          sectorType: "media",
          strategyId: "broadcast_tv",
          capitalStock: 100,
          revenue: 20,
        },
        {
          sectorId: "future",
          sectorType: "media",
          strategyId: "streaming_platform",
          capitalStock: 100,
          revenue: 100,
        },
      ],
      existingKindCounts: new Map<string, number>(),
    };
    expect(chooseNppMediaProduct(input)).toMatchObject({
      kind: { id: "television_series" },
      sectorId: "higher-revenue",
    });
    expect(chooseNppMediaProduct({ ...input, liveTitleCount: 4 })).toBeNull();
    expect(chooseNppMediaProduct({ ...input, hasActiveDevelopment: true })).toBeNull();
  });

  it("retires chronically unpaid development after four model cadences", () => {
    const kind = getMediaProductKind("radio_program")!;
    expect(
      shouldRetireChronicMediaDevelopment({
        stage: "development",
        elapsedDevelopmentTurns: 11,
        kind,
      })
    ).toBe(false);
    expect(
      shouldRetireChronicMediaDevelopment({
        stage: "development",
        elapsedDevelopmentTurns: 12,
        kind,
      })
    ).toBe(true);
    expect(
      shouldRetireChronicMediaDevelopment({ stage: "launch", elapsedDevelopmentTurns: 99, kind })
    ).toBe(false);
  });
});
