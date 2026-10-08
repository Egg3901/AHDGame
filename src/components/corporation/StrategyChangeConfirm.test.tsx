/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import StrategyChangeConfirm from "./StrategyChangeConfirm";

vi.mock("@/hooks/useWorldFlags", () => ({ useWorldFlags: () => ({ preset: "1991-default" }) }));
vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({
    formatAmount: (n: number) => `M${Math.round(n)}`,
    toInternalFrom: (n: number) => n,
  }),
}));
vi.mock("@/lib/observability/fetchJson", () => ({
  fetchJson: () => Promise.resolve({ commodities: [] }),
}));

afterEach(cleanup);

function renderConfirm(props: { industryModel?: string | null; targetStrategyId: string }) {
  return render(
    <StrategyChangeConfirm
      sectorType="manufacturing"
      industryModel={props.industryModel}
      currentStrategyId="standard"
      targetStrategyId={props.targetStrategyId}
      dailyRevenue={1000}
      onConfirm={() => {}}
      onCancel={() => {}}
    />
  );
}

describe("StrategyChangeConfirm operating model", () => {
  it("resolves vehicle plants to the vehicle strategy catalog", () => {
    renderConfirm({ industryModel: "vehicles", targetStrategyId: "ev" });
    expect(screen.getByText(/Switch to/)).toBeTruthy();
  });

  it("does not offer vehicle strategies to an ordinary manufacturing plant", () => {
    const { container } = renderConfirm({ industryModel: null, targetStrategyId: "ev" });
    expect(container.textContent).toBe("");
  });
});
