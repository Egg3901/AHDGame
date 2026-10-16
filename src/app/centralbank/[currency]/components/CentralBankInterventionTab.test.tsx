/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CentralBankInterventionTab, type InterventionData } from "./CentralBankInterventionTab";
afterEach(cleanup);
const data = {
  currencyCode: "USD",
  baseRate: 1,
  currentRate: 1,
  fxRegime: "peg",
  policy: {
    floor: 0.5,
    ceiling: 0.5,
    setByCharacterName: null,
    setAtTurn: null,
    lastAdjustedAtTurn: null,
    recentInterventions: [],
  },
  forexRevenue: 0,
  reserveBalance: 0,
} satisfies InterventionData;
it("identifies peg defence and withholds independent band controls even from admin", () => {
  render(
    <CentralBankInterventionTab
      countryId="US"
      data={data}
      isChair
      isAdmin
      chairControlsLocked={false}
      currentTurn={50}
      onChanged={vi.fn()}
    />
  );
  expect(screen.getByText("Peg target:")).toBeTruthy();
  expect(screen.getByText(/Currency regime/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /band/i })).toBeNull();
  expect(screen.queryByLabelText("Floor")).toBeNull();
  expect(screen.getByText(/Unknown/)).toBeTruthy();
});
it("retains independent band controls for an ordinary band", () => {
  render(
    <CentralBankInterventionTab
      countryId="US"
      data={{ ...data, fxRegime: "band", policy: { ...data.policy, floor: 0.9, ceiling: 1.1 } }}
      isChair
      isAdmin={false}
      chairControlsLocked={false}
      currentTurn={50}
      onChanged={vi.fn()}
    />
  );
  expect(screen.getByRole("button", { name: "Cancel band" })).toBeTruthy();
  expect(screen.getByLabelText("Floor")).toBeTruthy();
});
