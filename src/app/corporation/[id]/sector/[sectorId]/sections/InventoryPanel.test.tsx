// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import InventoryPanel from "./InventoryPanel";

const inventory = {
  stockpileUnsold: false,
  heldUnits: 12_500,
  heldValueAnchor: 48_000,
  byCommodity: [{ commodity: "steel", units: 12_500 }],
  drainedUnits: 1_000,
  spoiledUnits: 50,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("InventoryPanel", () => {
  it("shows the quantity, value, and last-turn movement", () => {
    render(
      <InventoryPanel corporationId="corp-1" sectorId="sector-1" isCeo inventory={inventory} />
    );

    expect(screen.getByText(/Holding/).textContent).toContain(
      "Holding 12.5k units worth ₳ 48.0k · sold 1.0k last turn · spoiled 50 last turn"
    );
    expect(screen.getByText(/Steel & Metals/).textContent).toBe("Steel & Metals: 12.5k");
  });

  it("exposes and updates the toggle state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    render(
      <InventoryPanel corporationId="corp-1" sectorId="sector-1" isCeo inventory={inventory} />
    );

    const toggle = screen.getByRole("button", { name: "Stockpiling off" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Stockpiling on" }).getAttribute("aria-pressed")
      ).toBe("true");
    });
  });

  it("announces a failed update without changing the toggle", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: vi.fn().mockResolvedValue({ error: "Not allowed" }),
      })
    );
    render(
      <InventoryPanel corporationId="corp-1" sectorId="sector-1" isCeo inventory={inventory} />
    );

    fireEvent.click(screen.getByRole("button", { name: "Stockpiling off" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Not allowed");
    expect(
      screen.getByRole("button", { name: "Stockpiling off" }).getAttribute("aria-pressed")
    ).toBe("false");
  });
});
