/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import corporations from "@/../messages/en/corporations.json";
import CeoOperationsTable from "./CeoOperationsTable";

// The bulk wage control reads its copy through next-intl.
const render = (ui: React.ReactElement) =>
  rtlRender(
    <NextIntlClientProvider locale="en" messages={corporations}>
      {ui}
    </NextIntlClientProvider>
  );

vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({ formatAmount: (n: number) => `$${n}`, toInternalFrom: (n: number) => n }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/image", () => ({ default: () => null }));

const corporation = {
  _id: "c1",
  countryId: "US",
  liquidCurrencyCode: "USD",
  labourEnabled: true,
} as never;

function sector(overrides: Record<string, unknown> = {}) {
  return {
    _id: "s1",
    stateId: "CA",
    stateName: "California",
    countryId: "US",
    sectorType: "energy",
    sectorLabel: "Energy",
    revenue: 1000,
    financialRevenue: 1000,
    profit: 100,
    workers: 10,
    effectiveProfitMargin: 10,
    targetGrowthRate: 4,
    currentGrowthRate: 4,
    currentGrowthCost: 50,
    productionPolicy: 0,
    productionPolicyLevel: 0,
    // CEO payload: the levers only the CEO receives.
    pricingPosture: null,
    wageLevel: 1,
    ...overrides,
  };
}

function renderTable(props: Partial<Parameters<typeof CeoOperationsTable>[0]> = {}) {
  const handlers = {
    onSavePolicy: vi.fn().mockResolvedValue({ ok: true }),
    onSetPricing: vi.fn().mockResolvedValue({ ok: true }),
    onSetWage: vi.fn().mockResolvedValue({ ok: true }),
    onBulkOperations: vi.fn().mockResolvedValue({ ok: true, matchedCount: 1 }),
    onSectorGrowth: vi.fn().mockResolvedValue({ ok: true }),
  };
  render(
    <CeoOperationsTable
      corporation={corporation}
      sectors={[sector()] as never}
      corpId="c1"
      {...handlers}
      {...props}
    />
  );
  return { ...handlers, ...props };
}

function bulkBar() {
  return screen.getByLabelText("Bulk scope").closest("div")!.parentElement!;
}

describe("CeoOperationsTable: bulk bar", () => {
  it("bulk growth previews, then applies on confirm, for the chosen sector group", async () => {
    const onBulkOperations = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        matchedCount: 1,
        growth: {
          targetGrowthRate: 8,
          projectedTotalCostPerTurn: 2400,
          currentTotalCostPerTurn: 1200,
          costDeltaPerTurn: 1200,
        },
      })
      .mockResolvedValueOnce({ ok: true, matchedCount: 1 });
    renderTable({ onBulkOperations });

    fireEvent.change(screen.getByLabelText("Bulk scope"), { target: { value: "US::energy" } });
    fireEvent.change(screen.getByLabelText("Bulk growth target"), { target: { value: "8" } });
    fireEvent.click(within(bulkBar()).getByText("Set growth"));
    await waitFor(() =>
      expect(onBulkOperations).toHaveBeenCalledWith("US", "energy", {
        targetGrowthRate: 8,
        preview: true,
      })
    );

    // The preview quotes per-turn costs (the API reports daily figures).
    expect(await screen.findByText(/about \$100\/turn once ramped, now \$50/)).toBeTruthy();
    fireEvent.click(screen.getByText("Confirm"));
    await waitFor(() =>
      expect(onBulkOperations).toHaveBeenLastCalledWith("US", "energy", { targetGrowthRate: 8 })
    );
  });

  it("bulk output applies directly to every sector in the country by default", async () => {
    const { onBulkOperations } = renderTable();
    fireEvent.change(screen.getByLabelText("Bulk output target"), { target: { value: "12" } });
    fireEvent.click(screen.getByText("Set output"));
    await waitFor(() =>
      expect(onBulkOperations).toHaveBeenCalledWith("US", null, { productionPolicy: 12 })
    );
    expect(await screen.findByText("Output target +12% on 1 sectors")).toBeTruthy();
  });

  it("bulk pricing sends the posture, and Auto sends null", async () => {
    const { onBulkOperations } = renderTable();
    fireEvent.change(screen.getByLabelText("Bulk pricing"), { target: { value: "-0.1" } });
    fireEvent.click(screen.getByText("Set pricing"));
    await waitFor(() =>
      expect(onBulkOperations).toHaveBeenCalledWith("US", null, { pricingPosture: -0.1 })
    );
    fireEvent.change(screen.getByLabelText("Bulk pricing"), { target: { value: "auto" } });
    fireEvent.click(screen.getByText("Set pricing"));
    await waitFor(() =>
      expect(onBulkOperations).toHaveBeenLastCalledWith("US", null, { pricingPosture: null })
    );
  });

  it("offers a scope per country when the corporation spans several", () => {
    render(
      <CeoOperationsTable
        corporation={corporation}
        sectors={
          [
            sector(),
            sector({
              _id: "s2",
              stateId: "DB",
              stateName: "Dongbei",
              countryId: "CN",
              sectorType: "technology",
              sectorLabel: "Technology",
            }),
          ] as never
        }
        corpId="c1"
        onSavePolicy={vi.fn()}
        onSetPricing={vi.fn()}
        onSetWage={vi.fn()}
        onBulkOperations={vi.fn()}
        onSectorGrowth={vi.fn()}
      />
    );
    const options = within(screen.getByLabelText("Bulk scope"))
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(["US::*", "US::energy", "CN::*", "CN::technology"]);
  });
});

describe("CeoOperationsTable: per-sector levers", () => {
  it("commits an output target on Enter", async () => {
    const { onSavePolicy } = renderTable();
    const input = screen.getByLabelText("Output target, California Energy");
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    await waitFor(() => expect(onSavePolicy).toHaveBeenCalledWith("s1", 5));
    expect(await screen.findByText("Output target +5%")).toBeTruthy();
  });

  it("clamps an out-of-range output target to ±25", async () => {
    const { onSavePolicy } = renderTable();
    const input = screen.getByLabelText("Output target, California Energy");
    fireEvent.change(input, { target: { value: "90" } });
    fireEvent.blur(input);
    await waitFor(() => expect(onSavePolicy).toHaveBeenCalledWith("s1", 25));
  });

  it("sets pricing for one sector from its row", async () => {
    const { onSetPricing } = renderTable();
    fireEvent.change(screen.getByLabelText("Pricing, California Energy"), {
      target: { value: "0.05" },
    });
    await waitFor(() => expect(onSetPricing).toHaveBeenCalledWith("s1", 0.05));
  });

  it("shows the error from a rejected lever", async () => {
    renderTable({ onSetWage: vi.fn().mockResolvedValue({ ok: false, error: "Union floor" }) });
    const input = screen.getByLabelText("Wage level, California Energy");
    fireEvent.change(input, { target: { value: "0.9" } });
    fireEvent.blur(input);
    expect(await screen.findByText("Union floor")).toBeTruthy();
  });

  it("hides pricing and wage columns when the payload has no CEO levers", () => {
    render(
      <CeoOperationsTable
        corporation={corporation}
        sectors={[sector({ pricingPosture: undefined, wageLevel: undefined })] as never}
        corpId="c1"
        onSavePolicy={vi.fn()}
        onSetPricing={vi.fn()}
        onSetWage={vi.fn()}
        onBulkOperations={vi.fn()}
        onSectorGrowth={vi.fn()}
      />
    );
    expect(screen.queryByLabelText("Pricing, California Energy")).toBeNull();
    expect(screen.queryByLabelText("Bulk pricing")).toBeNull();
  });

  it("previews a sector's growth target, then applies it on confirm", async () => {
    const onSectorGrowth = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        projectedCostPerTurn: 4800,
        currentCostPerTurn: 1200,
        costDeltaPerTurn: 3600,
      })
      .mockResolvedValueOnce({ ok: true });
    renderTable({ onSectorGrowth });
    const row = screen.getByLabelText("Growth target, California Energy").closest("tr")!;
    fireEvent.change(screen.getByLabelText("Growth target, California Energy"), {
      target: { value: "6" },
    });
    fireEvent.click(within(row).getByText("Set growth"));
    await waitFor(() =>
      expect(onSectorGrowth).toHaveBeenCalledWith(
        "s1",
        6,
        expect.objectContaining({ preview: true })
      )
    );
    expect(
      await screen.findByText(/about \$200\/turn once ramped, now \$50\/turn \(\+\$150\)/)
    ).toBeTruthy();
    fireEvent.click(screen.getByText("Confirm"));
    await waitFor(() => expect(onSectorGrowth).toHaveBeenLastCalledWith("s1", 6));
  });
});
