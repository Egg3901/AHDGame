/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SectorsTab from "./SectorsTab";

vi.mock("./ExpandMarketModal", () => ({
  default: ({
    initialSectorType,
    initialStateId,
  }: {
    initialSectorType?: string;
    initialStateId?: string;
  }) => (
    <div
      data-testid="expand-modal"
      data-sector-type={initialSectorType ?? ""}
      data-state-id={initialStateId ?? ""}
    >
      Expand modal open
    </div>
  ),
}));

vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({
    formatAmount: (v: number) => `$${v}`,
    toInternalFrom: (v: number) => v,
  }),
}));

const baseProps = {
  sectors: [],
  corpId: "corp-1",
  corporationType: "defense" as const,
  liquidCapital: 40_000,
  logisticsStrength: 0,
  onAbandonSector: () => undefined,
  abandoningSectorId: null,
  sectorsMessage: null,
  currentTurn: 10,
  plantsMode: true,
};

describe("SectorsTab Build-here deep link", () => {
  afterEach(() => {
    cleanup();
  });

  it("opens the expand modal only after isCeo resolves (ticket #1004 race)", async () => {
    const onConsumed = vi.fn();
    const { rerender } = render(
      <SectorsTab
        {...baseProps}
        isCeo={false}
        expandOnMount
        expandSectorType="defense"
        expandStateId="MD"
        onExpandDeepLinkConsumed={onConsumed}
      />
    );

    expect(screen.queryByTestId("expand-modal")).toBeNull();
    expect(onConsumed).not.toHaveBeenCalled();

    rerender(
      <SectorsTab
        {...baseProps}
        isCeo
        expandOnMount
        expandSectorType="defense"
        expandStateId="MD"
        onExpandDeepLinkConsumed={onConsumed}
      />
    );

    await waitFor(() => expect(screen.getByTestId("expand-modal")).toBeTruthy());
    const modal = screen.getByTestId("expand-modal");
    expect(modal.getAttribute("data-sector-type")).toBe("defense");
    expect(modal.getAttribute("data-state-id")).toBe("MD");
    expect(onConsumed).toHaveBeenCalledTimes(1);
  });

  it("does not open the expand modal without the deep-link flag", () => {
    render(<SectorsTab {...baseProps} isCeo />);
    expect(screen.queryByTestId("expand-modal")).toBeNull();
  });
});
