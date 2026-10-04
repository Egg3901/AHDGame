// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import StrategyPanel from "./StrategyPanel";
import type { StrategyData } from "../types";

vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({ formatAmount: (amount: number) => String(amount) }),
}));
vi.mock("@/components/corporation/StrategyChangeConfirm", () => ({
  default: ({
    targetStrategyId,
    onConfirm,
    onCancel,
  }: {
    targetStrategyId: string;
    onConfirm: () => void;
    onCancel: () => void;
  }) => (
    <div role="dialog" aria-label={`Confirm ${targetStrategyId}`}>
      <button onClick={onConfirm}>Confirm retool</button>
      <button onClick={onCancel}>Cancel review</button>
    </div>
  ),
}));
const strategy: StrategyData = {
  currentStrategyId: "software",
  currentStrategyName: "Software",
  isTransitioning: false,
  isReversing: false,
  transitionFromStrategyId: null,
  transitionStartTurn: null,
  transitionProgress: null,
  transitionMarginPenalty: -5,
  cancelCost: 0,
  reversalTurns: 0,
  cooldownUntilTurn: null,
  cooldownRemaining: 0,
  retoolCost: 100,
  availableStrategies: [
    { id: "software", name: "Software", description: "Current" },
    { id: "hardware", name: "Hardware", description: "Suggested" },
  ],
  currentTurn: 1,
};
function mount(overrides: Partial<StrategyData> = {}, isCeo = true) {
  const change = vi.fn();
  const complete = vi.fn();
  render(
    <StrategyPanel
      strategy={{ ...strategy, ...overrides }}
      sector={{ sectorType: "technology", revenue: 400 } as never}
      corporation={{ liquidCurrencyCode: "USD" } as never}
      isCeo={isCeo}
      strategyUpdating={false}
      cancelTransitionLoading={false}
      onStrategyChange={change}
      onCancelTransition={() => {}}
      initialReviewStrategyId="hardware"
      onReviewComplete={complete}
    />
  );
  return { change, complete };
}
describe("suggested retool review", () => {
  it("opens the suggested confirmation without a paid request and submits only on confirm", () => {
    const { change, complete } = mount();
    expect(screen.getByRole("dialog", { name: "Confirm hardware" })).toBeTruthy();
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm retool" }));
    expect(change).toHaveBeenCalledExactlyOnceWith("hardware");
    expect(complete).toHaveBeenCalledOnce();
  });
  it("cancels the review without changing strategy", () => {
    const { change, complete } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Cancel review" }));
    expect(change).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it.each([
    { cooldownRemaining: 3 },
    { isTransitioning: true },
    {
      availableStrategies: strategy.availableStrategies.map((option) => ({
        ...option,
        locked: option.id === "hardware",
      })),
    },
    {
      availableStrategies: strategy.availableStrategies.filter(
        (option) => option.id !== "hardware"
      ),
    },
  ])("does not open an unavailable suggestion: %j", (overrides) => {
    const { change } = mount(overrides);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(change).not.toHaveBeenCalled();
  });
  it("does not offer a paid confirmation to a viewer", () => {
    const { change } = mount({}, false);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(change).not.toHaveBeenCalled();
  });
});
