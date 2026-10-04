/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ManufacturingProductStudio } from "./ManufacturingProductStudio";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ManufacturingProductStudio", () => {
  it("hides itself when the server gate is off", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ enabled: false, isCeo: true }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ManufacturingProductStudio corporationId="corp-1" />);

    await waitFor(() => expect(screen.queryByText("Loading Product Studio")).toBeNull());
    expect(screen.queryByLabelText("Manufacturing Product Studio")).toBeNull();
  });

  it("describes one project allocated across plants and starts with the selected shares", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          enabled: true,
          isCeo: true,
          activeProject: null,
          catalog: [
            {
              id: "cement",
              label: "Cement",
              outputCommodity: "building_materials",
              technologyRequirements: [
                {
                  strategyId: "standard",
                  strategyName: "Standard",
                  minDecade: null,
                  requiresTechUnlock: false,
                },
              ],
            },
          ],
          plants: [
            {
              sectorId: "plant-1",
              sectorType: "manufacturing",
              strategyId: "standard",
              capitalStock: 1000,
              developmentCapitalAnchor: 50_000,
              plantCount: 2,
              eligibleKindIds: ["cement"],
            },
          ],
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ activeProject: {} }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          enabled: true,
          isCeo: true,
          activeProject: {
            id: "project-1",
            kindId: "cement",
            kindLabel: "Cement",
            outputCommodity: "building_materials",
            stage: "development",
            allocations: [{ sectorId: "plant-1", share: 0.5 }],
            developmentPaidAnchor: 0,
            paidThresholdAnchor: 50,
            elapsedDevelopmentTurns: 0,
            elapsedThresholdTurns: 12,
          },
          catalog: [],
          plants: [],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    render(<ManufacturingProductStudio corporationId="corp-1" />);

    expect(
      await screen.findByText(/Develop one product project, allocated across owned plants/)
    ).toBeTruthy();
    fireEvent.change(await screen.findByLabelText("manufacturing allocation"), {
      target: { value: "50" },
    });
    expect(await screen.findByText(/Estimated development cost: 1,250 anchor units/)).toBeTruthy();
    expect(screen.getByText(/Standard/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Product advertising allocation"), {
      target: { value: "25" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start product project" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      kindId: "cement",
      advertisingAllocationShare: 0.25,
      allocations: [{ sectorId: "plant-1", share: 0.5 }],
    });
    expect(await screen.findByText("development · building_materials")).toBeTruthy();
  });

  it("shows settled product sales and the live quality inputs for an active project", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          enabled: true,
          isCeo: true,
          activeProject: {
            id: "project-1",
            kindId: "passenger_car",
            kindLabel: "Passenger car",
            outputCommodity: "vehicles",
            stage: "growth",
            allocations: [{ sectorId: "plant-1", share: 1 }],
            developmentPaidAnchor: 50,
            paidThresholdAnchor: 100,
            elapsedDevelopmentTurns: 12,
            elapsedThresholdTurns: 12,
          },
          catalog: [],
          plants: [
            {
              sectorId: "plant-1",
              sectorType: "automobiles",
              capitalStock: 1000,
              plantCount: 4,
              eligibleKindIds: ["passenger_car"],
            },
          ],
          productResults: [
            {
              sectorId: "plant-1",
              turn: 14,
              producedUnits: 80,
              soldUnits: 60,
              quality: 72,
            },
          ],
        }),
      })
    );
    render(<ManufacturingProductStudio corporationId="corp-1" />);

    expect(await screen.findByText(/Last settled product sales/)).toBeTruthy();
    expect(screen.getByText(/turn 14: 60 of 80 units sold · quality 72.0/)).toBeTruthy();
    expect(screen.getByText(/paid development adds up to 10 points/i)).toBeTruthy();
  });
});
