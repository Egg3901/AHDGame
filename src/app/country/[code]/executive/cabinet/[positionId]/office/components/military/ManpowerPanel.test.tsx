// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ManpowerPanel } from "./ManpowerPanel";
import type { ManpowerView } from "../../useCabinetOffice";

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const view = (over: Partial<ManpowerView> = {}): ManpowerView => ({
  pool: 45000,
  mode: "trained",
  regenPerTurn: 5000,
  poolCap: 200000,
  stanceLabel: "Selective Service",
  conscriptAllowed: true,
  ...over,
});

const renderPanel = (over: Partial<ManpowerView> = {}, canWrite = true) =>
  render(
    <ManpowerPanel
      manpower={view(over)}
      countryCode="us"
      positionId="secretary_of_defense"
      canWrite={canWrite}
    />
  );

describe("ManpowerPanel", () => {
  it("shows the pool, regeneration, ceiling and the stance in force", () => {
    renderPanel();
    expect(screen.getByText("45,000")).toBeTruthy();
    expect(screen.getByText("+5,000")).toBeTruthy();
    expect(screen.getByText("200,000")).toBeTruthy();
    expect(screen.getByText("Selective Service")).toBeTruthy();
  });

  it("saves a mode change to the manpower route", async () => {
    renderPanel();
    fireEvent.change(screen.getByRole("combobox", { name: /reinforcement mode/i }), {
      target: { value: "conscript" },
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("/api/country/us/executive/cabinet/secretary_of_defense/manpower");
    expect(JSON.parse(String(init.body))).toEqual({ mode: "conscript" });
  });

  // Conscription is legislated — the option must be visibly unavailable, not silently ignored.
  it("disables conscription and explains why when the law forbids it", () => {
    renderPanel({ conscriptAllowed: false, stanceLabel: "All-Volunteer Force" });
    const option = screen.getByRole("option", { name: /conscripts/i }) as HTMLOptionElement;
    expect(option.disabled).toBe(true);
    expect(screen.getByText(/requires a reserve law that permits it/i)).toBeTruthy();
  });

  it("rolls back and surfaces the reason when the server refuses", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "All-Volunteer Force does not permit conscription" }),
    });
    renderPanel();
    fireEvent.change(screen.getByRole("combobox", { name: /reinforcement mode/i }), {
      target: { value: "conscript" },
    });
    await waitFor(() => expect(screen.getByText(/does not permit conscription/i)).toBeTruthy());
    const select = screen.getByRole("combobox", {
      name: /reinforcement mode/i,
    }) as HTMLSelectElement;
    expect(select.value).toBe("trained"); // rolled back
  });

  it("is read-only without the seat", () => {
    renderPanel({}, false);
    expect(screen.queryByRole("combobox", { name: /reinforcement mode/i })).toBeNull();
    expect(screen.getByText("Trained replacements")).toBeTruthy();
  });
});
