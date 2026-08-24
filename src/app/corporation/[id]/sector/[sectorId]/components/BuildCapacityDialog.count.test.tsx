/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BuildCapacityDialog from "./BuildCapacityDialog";
import type { PlantsData } from "../types";

vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({
    formatAmount: (amount: number) => `$${Math.round(amount).toLocaleString("en-US")}`,
  }),
}));

/** Only the fields the dialog actually reads; the rest never render. */
const plants = {
  capacityUnits: 1_000,
  fillRate: 1,
  mothballed: false,
  buildTurns: 3,
  laborIntensity: 2,
  headroomUnits: 10_000_000,
  demandGapUnits: 10_000_000,
  pnl: { profitPerUnitAnchor: 5 },
  buildQuote: {
    unitPriceAnchor: 1,
    dominanceMultiplier: 1,
    rateMultiplier: 1,
    acumenMultiplier: 1,
    techMultiplier: 1,
    hostPriceMultiplier: 1,
    perUnitAnchor: 1,
    fxSpreadRate: 0,
    perUnitChargedAnchor: 1,
    corpCapitalAnchor: 1_000_000_000,
    maxAffordableUnits: 1_000_000_000,
  },
} as unknown as PlantsData;

function renderDialog(onSubmit = vi.fn(), plantData = plants) {
  render(
    <BuildCapacityDialog
      open
      onClose={vi.fn()}
      plants={plantData}
      sectorType="manufacturing"
      sectorLabel="Manufacturing"
      submitting={false}
      errorMessage=""
      onSubmit={onSubmit}
    />
  );
  return { input: screen.getByRole("textbox") as HTMLInputElement, onSubmit };
}

const NO_MODS = { shiftKey: false, ctrlKey: false, metaKey: false };

afterEach(cleanup);

describe("BuildCapacityDialog count control", () => {
  it("lets a player clear the field and type a whole number", () => {
    const { input } = renderDialog();
    expect(input.value).toBe("1");

    // The old handler clamped every keystroke to >= 1, so the field could never
    // be empty and the first digit of a typed number was swallowed.
    fireEvent.change(input, { target: { value: "" } });
    expect(input.value).toBe("");

    fireEvent.change(input, { target: { value: "250" } });
    expect(input.value).toBe("250");
  });

  it("submits the number that was typed, in units", () => {
    const { input, onSubmit } = renderDialog();
    fireEvent.change(input, { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: /^Build 250 /i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    // One facility is many units of capacity, so the API argument is a multiple.
    expect(onSubmit.mock.calls[0][0] % 250).toBe(0);
    expect(onSubmit.mock.calls[0][0]).toBeGreaterThan(0);
  });

  it("ignores non-digits rather than going NaN", () => {
    const { input } = renderDialog();
    fireEvent.change(input, { target: { value: "12abc3" } });
    expect(input.value).toBe("123");
  });

  it("falls back to 1 when the field is left empty", () => {
    const { input } = renderDialog();
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(input.value).toBe("1");
  });

  it("cannot submit while the field is empty", () => {
    const { input } = renderDialog();
    fireEvent.change(input, { target: { value: "" } });
    const submit = screen.getByRole("button", { name: /^Build 0 /i }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it("steps by 10 on the +10 and -10 buttons", () => {
    const { input } = renderDialog();
    fireEvent.click(screen.getByLabelText(/build 10 more/i), NO_MODS);
    expect(input.value).toBe("11");
    fireEvent.click(screen.getByLabelText(/build 10 fewer/i), NO_MODS);
    expect(input.value).toBe("1");
  });

  it("never steps below one", () => {
    const { input } = renderDialog();
    fireEvent.click(screen.getByLabelText(/build one fewer/i), NO_MODS);
    expect(input.value).toBe("1");
  });

  it("multiplies the step by 10 on shift and 100 on ctrl", () => {
    const { input } = renderDialog();
    const plusTen = screen.getByLabelText(/build 10 more/i);

    fireEvent.click(plusTen, { ...NO_MODS, shiftKey: true });
    expect(input.value).toBe("101");

    fireEvent.click(plusTen, { ...NO_MODS, ctrlKey: true });
    expect(input.value).toBe("1101");
  });

  it("treats cmd on a Mac like ctrl", () => {
    const { input } = renderDialog();
    fireEvent.click(screen.getByLabelText(/build one more/i), { ...NO_MODS, metaKey: true });
    expect(input.value).toBe("101");
  });

  it("warns that new capacity may remain vacant when the sector is understaffed", () => {
    renderDialog(vi.fn(), {
      ...plants,
      workers: 25,
      workersDesired: 100,
      labourStaffingFactor: 0.25,
    } as PlantsData);

    expect(screen.getByText(/currently fills 25% of its jobs/i)).toBeTruthy();
    expect(screen.getByText(/unless you raise pay or the local workforce grows/i)).toBeTruthy();
  });

  it("steps from the arrow keys, with the same modifiers", () => {
    const { input } = renderDialog();
    fireEvent.keyDown(input, { key: "ArrowUp", ...NO_MODS });
    expect(input.value).toBe("2");

    fireEvent.keyDown(input, { key: "ArrowUp", ...NO_MODS, shiftKey: true });
    expect(input.value).toBe("12");

    fireEvent.keyDown(input, { key: "ArrowDown", ...NO_MODS });
    expect(input.value).toBe("11");

    fireEvent.keyDown(input, { key: "PageUp", ...NO_MODS });
    expect(input.value).toBe("21");

    fireEvent.keyDown(input, { key: "PageDown", ...NO_MODS });
    expect(input.value).toBe("11");
  });
});
