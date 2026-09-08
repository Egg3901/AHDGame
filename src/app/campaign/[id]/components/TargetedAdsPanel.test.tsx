/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en/elections.json";
import { TargetedAdsPanel } from "./TargetedAdsPanel";

vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({ formatFull: (value: number) => `₳${value.toLocaleString("en-US")}` }),
}));

const quote = {
  enabled: true,
  stateId: "PA",
  regions: [
    { id: "PA", name: "Pennsylvania" },
    { id: "CA", name: "California" },
  ],
  targets: [
    {
      dimension: "race",
      bucket: "white",
      eligibleAudience: 100_000,
      cohesion: 0.75,
      cost: 200,
      currentBonus: 0,
      afterBonus: 0.05,
      available: true,
      scheduledThrough: null,
    },
  ],
  actionCost: 5,
  currentTurn: 10,
  revision: 2,
  maxFlightTurns: 3,
};
const response = (body: unknown, ok = true) => ({ ok, json: async () => body });
const fetchMock = vi.fn();
const onSpent = vi.fn();
function mount() {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TargetedAdsPanel campaignId="campaign-1" onResourcesSpent={onSpent} />
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(response(quote));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("targeted ad campaign controls", () => {
  it("shows full prepaid costs and submits the exact displayed quote", async () => {
    mount();
    fireEvent.change(await screen.findByLabelText("Audience"), { target: { value: "race:white" } });
    fireEvent.change(screen.getByLabelText("Prepaid flight"), { target: { value: "3" } });
    expect(screen.getByText(/Personal cost: ₳600 campaign funds and 15 actions/)).toBeDefined();
    fetchMock.mockResolvedValueOnce(response({ scheduledThrough: 12 }));
    fireEvent.click(screen.getByRole("button", { name: "Buy ad flight" }));
    await waitFor(() => expect(onSpent).toHaveBeenCalledOnce());
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(post![1].body)).toEqual({
      stateId: "PA",
      dimension: "race",
      bucket: "white",
      turns: 3,
      quote: { turn: 10, cost: 600, revision: 2 },
    });
    expect(screen.getByText("Flight booked through turn 12.")).toBeDefined();
  });

  it("keeps purchases disabled while switching audiences between regions", async () => {
    mount();
    fireEvent.change(await screen.findByLabelText("Audience"), { target: { value: "race:white" } });
    fireEvent.change(screen.getByLabelText("Region"), { target: { value: "CA" } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(
      (screen.getByRole("button", { name: "Buy ad flight" }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect((screen.getByLabelText("Audience") as HTMLSelectElement).value).toBe("");
  });

  it("lets players retry a failed preview without an automatic request loop", async () => {
    fetchMock.mockResolvedValueOnce(response({ error: "Preview unavailable" }, false));
    mount();
    const retry = await screen.findByRole("button", { name: "Refresh preview" });
    expect(fetchMock).toHaveBeenCalledOnce();
    fireEvent.click(retry);
    await screen.findByLabelText("Audience");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onSpent).not.toHaveBeenCalled();
  });

  it("shows the frozen-rule explanation for an existing race", async () => {
    fetchMock.mockResolvedValue(
      response({ enabled: false, targets: [], message: "Original campaign rules apply." })
    );
    mount();
    await screen.findByText("Original campaign rules apply.");
    expect(screen.queryByRole("button", { name: "Buy ad flight" })).toBeNull();
  });
});
