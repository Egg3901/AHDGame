// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import corporations from "@/../messages/en/corporations.json";
import { BulkWageControl } from "./BulkWageControl";
afterEach(cleanup);
it("requires a fresh preview after editing wages and applies the previewed level", async () => {
  const action = vi
    .fn()
    .mockResolvedValue({
      ok: true,
      matchedCount: 2,
      wages: {
        wageLevel: 1.2,
        currentTotalCostPerTurn: 100,
        projectedTotalCostPerTurn: 120,
        costDeltaPerTurn: 20,
        missingCostCount: 0,
        protectedCount: 0,
      },
    });
  render(
    <NextIntlClientProvider locale="en" messages={{ corporations }}>
      <BulkWageControl country="US" sectorType={null} onBulkOperations={action} fmtMoney={String} />
    </NextIntlClientProvider>
  );
  fireEvent.change(screen.getByLabelText("Wage multiplier"), { target: { value: "1.2" } });
  fireEvent.click(screen.getByText("Preview wages"));
  await waitFor(() => expect(screen.getByText("Apply wages")).toBeTruthy());
  expect(action).toHaveBeenLastCalledWith("US", null, { wageLevel: 1.2, preview: true });
  fireEvent.change(screen.getByLabelText("Wage multiplier"), { target: { value: "1.1" } });
  expect(screen.queryByText("Apply wages")).toBeNull();
  fireEvent.change(screen.getByLabelText("Wage multiplier"), { target: { value: "1.2" } });
  fireEvent.click(screen.getByText("Preview wages"));
  await waitFor(() => expect(screen.getByText("Apply wages")).toBeTruthy());
  fireEvent.click(screen.getByText("Apply wages"));
  await waitFor(() =>
    expect(action).toHaveBeenLastCalledWith("US", null, { wageLevel: 1.2, preview: false })
  );
});
