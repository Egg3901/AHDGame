/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FxReserveTransferPanel } from "./FxReserveTransferPanel";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("FX reserve transfer panel", () => {
  it("explains the one-time transfer and reuses its identity after an ambiguous delivery failure", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("Connection interrupted"))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ transferred: 1000 }) });
    vi.stubGlobal("fetch", fetch);
    const onUpdate = vi.fn();
    render(<FxReserveTransferPanel countryCode="US" canAct onUpdate={onUpdate} />);
    expect(screen.getByText(/one-time transfer/)).toBeTruthy();
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "Transfer to FX Reserve" }));
    await screen.findByText("Connection interrupted");
    fireEvent.click(screen.getByRole("button", { name: "Transfer to FX Reserve" }));
    await screen.findByText(/Transferred \$1,000/);
    const first = JSON.parse(fetch.mock.calls[0][1].body),
      second = JSON.parse(fetch.mock.calls[1][1].body);
    expect(first.operationId).toBeTruthy();
    expect(second.operationId).toBe(first.operationId);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("")
    );
  });
  it("does not expose a command to an unauthorized viewer", () => {
    render(<FxReserveTransferPanel countryCode="US" canAct={false} onUpdate={() => {}} />);
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });
});
