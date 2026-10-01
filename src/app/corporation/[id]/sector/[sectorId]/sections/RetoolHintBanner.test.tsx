// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { RetoolHint } from "@/lib/corporations/retoolHint";
import RetoolHintBanner from "./RetoolHintBanner";

const HINT: RetoolHint = {
  currentStrategyId: "software",
  currentMain: { commodity: "software", valueShare: 0.57, fill: 0.29 },
  currentValueFill: 0.6,
  suggestedStrategyId: "hardware",
  suggestedStrategyName: "Hardware",
  suggestedMain: { commodity: "electronics", valueShare: 0.92, unmetShare: 0.31 },
  suggestedValueFill: 0.93,
};

describe("RetoolHintBanner", () => {
  it("names the oversupplied product, the suggested strategy and the numbers", () => {
    render(<RetoolHintBanner hint={HINT} isCeo={false} onOpenStrategy={() => {}} />);
    const text = screen.getByRole("status", { name: "Strategy suggestion" }).textContent ?? "";
    expect(text).toContain("57% of this plant's output by value");
    expect(text).toContain("buyers took 29%");
    expect(text).toContain("The Hardware strategy makes mostly Electronics");
    expect(text).toContain("31% short");
    expect(text).toContain("about 93%");
    expect(text).not.toMatch(/[–—]/);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("gives the CEO a way to the strategy picker", () => {
    const open = vi.fn();
    render(<RetoolHintBanner hint={HINT} isCeo onOpenStrategy={open} />);
    fireEvent.click(screen.getByRole("button", { name: "Review strategy" }));
    expect(open).toHaveBeenCalledOnce();
  });
});
