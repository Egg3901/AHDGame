/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en/corporations.json";
import type { CorporationDetail } from "../CorporationPageTypes";
import OwnershipOverview from "./OwnershipOverview";
import OwnershipHistoryPanel from "./OwnershipHistoryPanel";

const corporation = {
  _id: "corp",
  totalShares: 1000,
  publicFloat: 500,
  superShareMultiplier: 10,
  shareholders: [{ characterId: "one", name: "Founder", shares: 500, superShares: 500 }],
} as CorporationDetail;
const history = {
  owners: [
    { key: "character:one", name: "Founder", kind: "character" },
    { key: "character:two", name: "Former holder", kind: "character" },
  ],
  snapshots: [
    {
      turn: 1,
      totalShares: 1000,
      publicFloat: 200,
      holders: [
        { key: "character:one", shares: 500 },
        { key: "character:two", shares: 300 },
      ],
    },
    {
      turn: 3,
      totalShares: 1000,
      publicFloat: 500,
      holders: [{ key: "character:one", shares: 500 }],
    },
  ],
};
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {children}
  </NextIntlClientProvider>
);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ownership insights", () => {
  it("shows economic ownership separately from supershare voting power", () => {
    render(<OwnershipOverview corporation={corporation} />, { wrapper });
    expect(screen.getByText("Founder")).toBeTruthy();
    expect(screen.getByText("90.9%")).toBeTruthy();
    expect(screen.getAllByText("50.0%")).toHaveLength(2);
    expect(screen.getByRole("img", { name: "Current ownership split" })).toBeTruthy();
  });

  it("does not label escrow or IPO inventory as public float", () => {
    render(
      <OwnershipOverview corporation={{ ...corporation, publicFloat: 0, pendingIpoShares: 500 }} />,
      { wrapper }
    );
    expect(screen.getByText("Unassigned / escrow")).toBeTruthy();
    expect(screen.queryByText("Public float")).toBeNull();
    expect(screen.getByText("100.0%")).toBeTruthy();
  });

  it("selects exited holders, inspects missing turns and requests the chosen range", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => history });
    vi.stubGlobal("fetch", fetchMock);
    render(<OwnershipHistoryPanel corpId="corp" corporation={corporation} />, { wrapper });
    await screen.findByRole("combobox", { name: "Track a holder" });
    fireEvent.change(screen.getByRole("combobox", { name: "Track a holder" }), {
      target: { value: "character:two" },
    });
    expect(
      within(screen.getByRole("status", { name: "Selected snapshot" })).getByText("0.0%")
    ).toBeTruthy();
    expect(screen.getByText("Exited")).toBeTruthy();
    fireEvent.change(screen.getByRole("slider", { name: "Inspect a turn" }), {
      target: { value: "1" },
    });
    expect(screen.getByText("No snapshot")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Range" }), { target: { value: "24" } });
    await waitFor(() => expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("turns=24"));
  });

  it("recovers from a failed request via retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false })
        .mockResolvedValue({ ok: true, json: async () => history })
    );
    render(<OwnershipHistoryPanel corpId="corp" corporation={corporation} />, { wrapper });
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("combobox", { name: "Track a holder" });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
