/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import ProductStudio, { type StudioState } from "./ProductStudio";

afterEach(cleanup);

function studio(over: Partial<StudioState> = {}): StudioState {
  return {
    enabled: true,
    isCeo: true,
    operatingModels: [],
    activeProduct: null,
    catalog: [
      {
        id: "truck",
        family: "industrial_manufacturing",
        label: "Truck",
        outputCommodity: "vehicles",
      },
      {
        id: "news_story",
        family: "media_entertainment",
        label: "News Story",
        outputCommodity: "advertising",
        operatingModels: ["newspaper", "television_network", "radio_network"],
      },
      {
        id: "radio_program",
        family: "media_entertainment",
        label: "Radio Program",
        outputCommodity: "advertising",
        operatingModels: ["radio_network"],
      },
    ],
    ...over,
  };
}

function mockGet(payload: unknown) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (!init?.method || init.method === "GET") {
      return { ok: true, json: async () => payload };
    }
    return { ok: true, json: async () => ({ success: true }) };
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockGet(studio()));
});

afterEach(() => vi.unstubAllGlobals());

describe("ProductStudio", () => {
  it("shows a loading state before the studio loads", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {}))
    );
    render(<ProductStudio corpId="corp1" />);
    expect(screen.getByLabelText("Loading Product Studio")).toBeTruthy();
  });

  it("shows an error with a retry control when loading fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ error: "World unavailable" }),
      }))
    );
    render(<ProductStudio corpId="corp1" />);

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("World unavailable")).toBeTruthy();

    vi.stubGlobal("fetch", mockGet(studio()));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("Operating models")).toBeTruthy());
  });

  it("shows the not-launched state while the flag is off", async () => {
    vi.stubGlobal("fetch", mockGet(studio({ enabled: false })));
    render(<ProductStudio corpId="corp1" />);

    expect(await screen.findByText("Product Studio is not launched yet")).toBeTruthy();
    expect(screen.queryByText("Operating models")).toBeNull();
    expect(screen.queryByRole("button", { name: /start/i })).toBeNull();
  });

  it("lists every owned operating model", async () => {
    vi.stubGlobal(
      "fetch",
      mockGet(studio({ operatingModels: ["newspaper", "television_network", "radio_network"] }))
    );
    render(<ProductStudio corpId="corp1" />);

    const list = await screen.findByRole("list", { name: "Owned operating models" });
    expect(list.textContent).toContain("Newspaper");
    expect(list.textContent).toContain("Television Network");
    expect(list.textContent).toContain("Radio Network");
  });

  it("groups legal product cards by output", async () => {
    render(<ProductStudio corpId="corp1" />);

    expect(await screen.findByRole("region", { name: "vehicles products" })).toBeTruthy();
    expect(await screen.findByRole("region", { name: "advertising products" })).toBeTruthy();
    expect(screen.getByRole("listitem", { name: "Truck" })).toBeTruthy();
    expect(screen.getByRole("listitem", { name: "News Story" })).toBeTruthy();
  });

  it("filters the catalog to what the API reports as legal", async () => {
    vi.stubGlobal(
      "fetch",
      mockGet(
        studio({
          operatingModels: ["radio_network"],
          catalog: [
            {
              id: "news_story",
              family: "media_entertainment",
              label: "News Story",
              outputCommodity: "advertising",
              operatingModels: ["newspaper", "television_network", "radio_network"],
            },
            {
              id: "radio_program",
              family: "media_entertainment",
              label: "Radio Program",
              outputCommodity: "advertising",
              operatingModels: ["radio_network"],
            },
          ],
        })
      )
    );
    render(<ProductStudio corpId="corp1" />);

    await screen.findByRole("listitem", { name: "News Story" });
    expect(screen.queryByRole("listitem", { name: "Truck" })).toBeNull();
  });

  it("summarises the active product and blocks a second start", async () => {
    vi.stubGlobal(
      "fetch",
      mockGet(
        studio({
          operatingModels: ["newspaper"],
          activeProduct: {
            id: "product-1",
            kindId: "news_story",
            kindLabel: "News Story",
            name: "Evening Edition",
            stage: "development",
            startedTurn: 100,
          },
        })
      )
    );
    render(<ProductStudio corpId="corp1" />);

    expect(await screen.findByText("Evening Edition")).toBeTruthy();
    expect(screen.getByText("development")).toBeTruthy();
    expect(screen.getByText("Started on turn 100")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /start truck/i })).toBeNull();
    expect(screen.getAllByText(/one active product at a time/i).length).toBeGreaterThan(0);
  });

  it("validates the product name before starting", async () => {
    const fetchMock = mockGet(studio());
    vi.stubGlobal("fetch", fetchMock);
    render(<ProductStudio corpId="corp1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Start Truck" }));

    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.getByText(/at least 2 characters/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("starts a legal product through the corporation route", async () => {
    const fetchMock = mockGet(studio({ operatingModels: ["newspaper"] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ProductStudio corpId="corp1" />);

    fireEvent.change(await screen.findByLabelText("Product name for News Story"), {
      target: { value: "Morning Edition" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start News Story" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/corporations/corp1/products",
        expect.objectContaining({ method: "POST" })
      )
    );
    const [, init] = fetchMock.mock.calls.find(
      ([, callInit]) => (callInit as RequestInit | undefined)?.method === "POST"
    )!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      kindId: "news_story",
      name: "Morning Edition",
    });
  });

  it("retires the active product in two steps", async () => {
    const fetchMock = mockGet(
      studio({
        activeProduct: {
          id: "product-1",
          kindId: "truck",
          kindLabel: "Truck",
          name: "Hauler",
          stage: "development",
          startedTurn: 100,
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ProductStudio corpId="corp1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Retire product" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm retirement of Hauler" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/corporations/corp1/products/product-1/retire",
        expect.objectContaining({ method: "POST" })
      )
    );
  });

  it("adds an operating model from the labeled selector", async () => {
    const fetchMock = mockGet(studio());
    vi.stubGlobal("fetch", fetchMock);
    render(<ProductStudio corpId="corp1" />);

    fireEvent.change(await screen.findByLabelText("Add an operating model"), {
      target: { value: "film_studio" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add model" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/corporations/corp1/operating-models",
        expect.objectContaining({ method: "POST" })
      )
    );
    const [, init] = fetchMock.mock.calls.find(
      ([, callInit]) => (callInit as RequestInit | undefined)?.method === "POST"
    )!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      operatingModel: "film_studio",
    });
  });

  it("hides every mutation control from a non-CEO viewer", async () => {
    vi.stubGlobal("fetch", mockGet(studio({ isCeo: false })));
    render(<ProductStudio corpId="corp1" />);

    await screen.findByText("Product catalog");
    expect(screen.queryByLabelText("Add an operating model")).toBeNull();
    expect(screen.queryByRole("button", { name: /start/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /retire/i })).toBeNull();
    expect(screen.getByText(/only the ceo can/i)).toBeTruthy();
  });
});
