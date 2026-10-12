// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/../messages/en/corporations.json";
import InternalSupplyPanel from "./InternalSupplyPanel";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const view = {
  policy: { priority: "market", discount: 0 },
  effectivePolicy: { priority: "market", discount: 0 },
  inherited: false,
  parentId: null,
  available: true,
  lastTurn: 12,
  received: { iron: 30 },
  reserved: {},
  discountCostAnchor: -20,
};
const fetcher = vi.fn();
beforeEach(() => {
  fetcher.mockReset();
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockResolvedValue({ ok: true, json: async () => view });
});
function show() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <InternalSupplyPanel corpId="12" />
    </NextIntlClientProvider>
  );
}
it("loads the saved policy, explains physical limits quietly and displays actual delivery", async () => {
  show();
  await screen.findByText("Reserved supply, turn 12");
  expect(screen.getByLabelText("Supply priority")).toHaveProperty("value", "market");
  expect(screen.getByText("iron")).toBeTruthy();
  expect(screen.getByText("Net internal discount credit: ₳20 per day.")).toBeTruthy();
  expect(screen.getByText("How priority and pricing work").closest("details")?.open).toBe(false);
  expect(screen.getByText("Save policy")).toHaveProperty("disabled", true);
});
it("sends the selected priority and discount then confirms next-turn timing", async () => {
  show();
  await screen.findByText("Reserved supply, turn 12");
  fireEvent.change(screen.getByLabelText("Supply priority"), { target: { value: "group" } });
  fireEvent.change(screen.getByLabelText("Internal discount"), { target: { value: "0.1" } });
  fetcher.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ policy: { priority: "group", discount: 0.1 } }),
  });
  fireEvent.click(screen.getByText("Save policy"));
  await screen.findByText("Policy saved. New reservations and discounts apply next turn.");
  expect(fetcher.mock.calls[1]?.[1].body).toBe(
    JSON.stringify({ priority: "group", discount: 0.1 })
  );
  expect(screen.getByText("Save policy")).toHaveProperty("disabled", true);
});
it("preserves the draft after an unsuccessful save and never claims success", async () => {
  show();
  await screen.findByText("Reserved supply, turn 12");
  fireEvent.change(screen.getByLabelText("Supply priority"), { target: { value: "own" } });
  fetcher.mockRejectedValueOnce(new Error("Connection lost"));
  fireEvent.click(screen.getByText("Save policy"));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("Supply priority")).toHaveProperty("value", "own");
  expect(
    screen.queryByText("Policy saved. New reservations and discounts apply next turn.")
  ).toBeNull();
});
it("reloads persisted selection on remount", async () => {
  fetcher.mockResolvedValue({
    ok: true,
    json: async () => ({ ...view, policy: { priority: "own", discount: 0.1 } }),
  });
  const first = show();
  await screen.findByText("Reserved supply, turn 12");
  first.unmount();
  show();
  await screen.findByText("Reserved supply, turn 12");
  expect(screen.getByLabelText("Supply priority")).toHaveProperty("value", "own");
  expect(screen.getByLabelText("Internal discount")).toHaveProperty("value", "0.1");
});
it("makes the inherited group policy read-only and links to its parent", async () => {
  fetcher.mockResolvedValue({
    ok: true,
    json: async () => ({
      ...view,
      inherited: true,
      parentId: "parent",
      effectivePolicy: { priority: "group", discount: 0.15 },
    }),
  });
  show();
  await screen.findByText("Open parent operations");
  expect(screen.getByLabelText("Supply priority")).toHaveProperty("disabled", true);
  expect(screen.getByLabelText("Internal discount")).toHaveProperty("value", "0.15");
});
it("can retry a failed load", async () => {
  fetcher.mockRejectedValueOnce(new Error("Offline"));
  show();
  await screen.findByRole("alert");
  fireEvent.click(screen.getByText("Retry"));
  await waitFor(() => expect(screen.getByText("Reserved supply, turn 12")).toBeTruthy());
});

it("explains why internal priority is disabled during Group coordination", async () => {
  fetcher.mockResolvedValue({
    ok: true,
    json: async () => ({ ...view, available: false, groupCoordinationActive: true }),
  });
  show();
  await screen.findByText(/Subsidiary Group coordination is active/);
  expect(screen.getByLabelText("Supply priority")).toHaveProperty("disabled", true);
});
