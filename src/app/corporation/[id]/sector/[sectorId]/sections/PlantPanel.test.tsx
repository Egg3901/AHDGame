/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PlantPanel from "./PlantPanel";
import type { PlantsData } from "../types";

vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({ formatAmount: (amount: number) => `${amount}` }),
}));

const plants = {
  capacityUnits: 2_000,
  producedUnits: 1_500,
  soldUnits: 1_400,
  unsoldUnits: 100,
  idleUnits: 500,
  fillRate: 1_400 / 1_500,
  idleCauses: [],
  mothballed: false,
  buildQueue: [],
  constructionInProgressAnchor: 0,
  depreciationPerTurn: 0.001,
  buildTurns: 72,
  workers: 1_867,
  unionizationPct: 31,
  laborIntensity: 0.93,
  governor: { active: false, startTurn: 1, rampTurns: 48, turnsRemaining: 0, cap: 0.15 },
  headroomUnits: 250,
  currentTurn: 100,
} as unknown as PlantsData;

function noop() {}

describe("PlantPanel workforce", () => {
  it("links the covering union with its emblem and shows the average wage level", () => {
    const { container } = render(
      <PlantPanel
        plants={plants}
        sectorType="manufacturing"
        unionId="union-1"
        unionName="United Steelworkers"
        averageWageLevel={1.15}
        isCeo={false}
        busy={false}
        message=""
        onOpenBuild={noop}
        onCancelOrder={noop}
        onMothball={noop}
        onReactivate={noop}
      />
    );

    expect(screen.getByText("1,867")).toBeTruthy();
    expect(screen.getByText("31% in a union")).toBeTruthy();
    expect(screen.getByText("Avg wage level 1.15×")).toBeTruthy();

    const unionLink = screen.getByRole("link", { name: "United Steelworkers" });
    expect(unionLink.getAttribute("href")).toBe("/unions/union-1");
    expect(
      [...container.querySelectorAll("img")].some((image) =>
        (image.getAttribute("src") ?? "").includes("United_Steelworkers")
      )
    ).toBe(true);
  });
});
