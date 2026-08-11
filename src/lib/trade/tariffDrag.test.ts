import { describe, it, expect } from "vitest";
import { importerTariffOnFlow } from "./tariffDrag";
import { ftaPairKey, type FtaPairSet } from "@/lib/tariffs/ftaOverrides";
import type { Tariff } from "@/lib/db/types/tariff";

const noFta: FtaPairSet = new Set();
const t = (over: Partial<Tariff>): Tariff =>
  ({ countryId: "US", scopeType: "economy_wide", rate: 0, ...over }) as Tariff;

describe("importerTariffOnFlow", () => {
  it("applies an economy-wide tariff to any flow", () => {
    const tariffs = [t({ countryId: "US", scopeType: "economy_wide", rate: 20 })];
    expect(importerTariffOnFlow(tariffs, noFta, "US", "CN", "manufacturing")).toBeCloseTo(0.2);
  });

  it("applies a sector tariff only to its sector", () => {
    const tariffs = [t({ scopeType: "sector", targetSectorType: "manufacturing", rate: 30 })];
    expect(importerTariffOnFlow(tariffs, noFta, "US", "CN", "manufacturing")).toBeCloseTo(0.3);
    expect(importerTariffOnFlow(tariffs, noFta, "US", "CN", "technology")).toBe(0);
  });

  it("applies an origin-country tariff only to that exporter", () => {
    const tariffs = [t({ scopeType: "origin_country", targetOriginCountryId: "CN", rate: 25 })];
    expect(importerTariffOnFlow(tariffs, noFta, "US", "CN", "manufacturing")).toBeCloseTo(0.25);
    expect(importerTariffOnFlow(tariffs, noFta, "US", "DE", "manufacturing")).toBe(0);
  });

  it("ignores tariffs imposed by a different country", () => {
    const tariffs = [t({ countryId: "DE", scopeType: "economy_wide", rate: 40 })];
    expect(importerTariffOnFlow(tariffs, noFta, "US", "CN", "manufacturing")).toBe(0);
  });

  it("neutralises the drag when the pair has an active FTA", () => {
    const tariffs = [t({ scopeType: "economy_wide", rate: 50 })];
    const fta: FtaPairSet = new Set([ftaPairKey("US", "CN")]);
    expect(importerTariffOnFlow(tariffs, fta, "US", "CN", "manufacturing")).toBe(0);
  });

  it("stacks scopes and clamps to 100%", () => {
    const tariffs = [
      t({ scopeType: "economy_wide", rate: 60 }),
      t({ scopeType: "sector", targetSectorType: "manufacturing", rate: 80 }),
    ];
    expect(importerTariffOnFlow(tariffs, noFta, "US", "CN", "manufacturing")).toBe(1);
  });
});
