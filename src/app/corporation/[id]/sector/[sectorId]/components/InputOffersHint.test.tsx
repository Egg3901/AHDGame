/**
 * @vitest-environment happy-dom
 */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import InputOffersHint from "./InputOffersHint";
import type { CommodityFlow } from "../types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const flow = { commodity: "energy", label: "Energy" } as CommodityFlow;
const respond = (body: unknown) =>
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => body }));

it("links to the offers view with the number of other corporations selling", async () => {
  respond({
    enabled: true,
    offers: [
      { side: "sell", own: false },
      { side: "sell", own: false },
      { side: "sell", own: true },
      { side: "buy", own: false },
    ],
  });
  render(<InputOffersHint flow={flow} />);
  const link = await waitFor(() => screen.getByText("2 sellers offering"));
  expect(link.getAttribute("href")).toBe("/commodity/energy/offers");
});

it("renders nothing when nobody is selling or the feature is off", async () => {
  respond({ enabled: false, offers: [] });
  const { container } = render(<InputOffersHint flow={flow} />);
  await Promise.resolve();
  expect(container.textContent).toBe("");
});
