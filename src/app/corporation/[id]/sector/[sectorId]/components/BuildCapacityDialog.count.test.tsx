/**
 * @vitest-environment happy-dom
 */
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../messages/en/corporations.json";
import { cleanup, fireEvent, render as renderView, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BuildCapacityDialog from "./BuildCapacityDialog";
import type { PlantsData } from "../types";
import { plantSizeUnits } from "@/lib/constants/facilityQuantum";

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
  measuredDemandGapUnits: 10_000_000,
  workers: 10,
  workersDesired: 10,
  producedUnits: 1_000,
  soldUnits: 1_000,
  activeCapacityPercent: 100,
  depreciationPerTurn: 0,
  investment: { overheadDailyAnchor: 0, taxRatePercent: 0, operatingReserveAnchor: 10 },
  pnl: {
    profitPerUnitAnchor: 5,
    revenueAnchor: 10_000,
    inputsAnchor: 0,
    labourAnchor: 0,
    complianceAnchor: 0,
    otherOperatingAnchor: 0,
    growthAndBuildAnchor: 0,
    upkeepAnchor: 0,
  },
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("BuildCapacityDialog count control", () => {
  it("does not mount finance controls or query lenders without the gated payload", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    renderDialog();
    expect(screen.queryByLabelText(/Finance this build/)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("matches measured buyer demand even when share headroom is larger", () => {
    const units = plantSizeUnits("manufacturing");
    const { input } = renderDialog(vi.fn(), {
      ...plants,
      headroomUnits: units * 20,
      demandGapUnits: units * 3.9,
      measuredDemandGapUnits: units * 3.9,
    });
    fireEvent.click(screen.getByRole("button", { name: "Match demand: 3" }));
    expect(input.value).toBe("3");
    expect(screen.getByText("This expansion fits current demand")).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/build one more/i));
    expect(screen.getByText("This expansion exceeds current demand")).toBeTruthy();
  });

  it("disables shortcuts when cash or buyer room cannot fund one whole facility", () => {
    const units = plantSizeUnits("manufacturing");
    const { input } = renderDialog(vi.fn(), {
      ...plants,
      headroomUnits: units,
      demandGapUnits: units / 2,
      measuredDemandGapUnits: units / 2,
      buildQuote: { ...plants.buildQuote, corpCapitalAnchor: 0, maxAffordableUnits: 0 },
    });
    const demand = screen.getByRole("button", { name: "Match demand" }) as HTMLButtonElement;
    expect(demand.disabled).toBe(true);
    fireEvent.click(demand);
    expect(input.value).toBe("1");
  });

  it("withholds automatic sizing without reliable operating history", () => {
    renderDialog(vi.fn(), { ...plants, investment: undefined });
    const demand = screen.getByRole("button", { name: "Match demand" }) as HTMLButtonElement;
    expect(demand.disabled).toBe(true);
    expect(
      screen.getByText(/Automatic sizing is unavailable without current operating figures/)
    ).toBeTruthy();
  });

  it("keeps a funded build disabled until the loan pledge is reviewed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            enabled: true,
            currency: "USD",
            lenders: [{ id: "bank", name: "Lender", ratePercent: 5, approvalRequired: false }],
          }),
          { status: 200 }
        )
      )
    );
    const { onSubmit } = renderDialog(vi.fn(), {
      ...plants,
      buildQuote: {
        ...plants.buildQuote,
        financing: { corporationId: "corp", currency: "USD", localPerAnchor: 1 },
      },
    });
    const submit = screen.getByRole("button", { name: /^Build 1 / }) as HTMLButtonElement;
    fireEvent.click(screen.getByLabelText(/Finance this build/));
    await screen.findByRole("option", { name: /Lender/ });
    expect(submit.disabled).toBe(true);
    expect(
      screen.getByText("Complete the loan details and pledge consent to continue.")
    ).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/I pledge this sector/));
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);
    expect(onSubmit.mock.lastCall?.[1]).toMatchObject({ bankId: "bank", pledgeConsent: true });
  });

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

function render(ui: ReactElement) {
  return renderView(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
      {ui}
    </NextIntlClientProvider>
  );
}
